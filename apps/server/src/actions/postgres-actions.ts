import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ActionDecision, ActionRecord } from '../../../../packages/contracts/src/actions.js';
import type { RunRecord } from '../../../../packages/contracts/src/runs.js';
import type { Snapshot } from '../../../../packages/contracts/src/index.js';
import type { Clock } from '../drafts/domain/ports.js';
import { AppError } from '../shared/errors.js';
import { digest, normalizeAction } from './action-input.js';
import { assertValidationClaim, type ValidationClaim } from '../shared/validation-claim.js';
import {assertRunClaim,type RunClaim} from '../shared/run-claim.js';

type Attempt = { seq: number; type: string; data: unknown };
const problem = (code: string) => new AppError(code, '待确认动作状态或授权不匹配', 409);
export class PostgresActions {
  constructor(private readonly pool: Pool, private readonly clock: Clock = { now: () => new Date().toISOString() }) {}
  private async tx<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await body(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async run(client: PoolClient, id: string) {
    const run = (await client.query<{ record: RunRecord }>('SELECT record FROM runs WHERE id=$1 FOR UPDATE', [id])).rows[0]?.record;
    if (!run) throw problem('ACTION_FORBIDDEN'); return run;
  }
  private async save(client: PoolClient, action: ActionRecord) {
    action.updatedAt = this.clock.now(); await client.query('UPDATE pending_actions SET record=$2 WHERE id=$1', [action.id, action]);
  }
  private async event(client: PoolClient, action: ActionRecord, suffix: string, type: string, data: unknown) {
    await client.query("INSERT INTO run_events(run_id,source,source_key,type,data) VALUES ($1,'platform',$2,$3,$4) ON CONFLICT DO NOTHING", [action.runId, `action-${action.id}-${suffix}`, type, data]);
  }
  private async attempt(client: PoolClient, action: ActionRecord, type: string) {
    await client.query('INSERT INTO action_attempts(action_id,type,data) VALUES ($1,$2,$3)', [action.id, type, { idempotencyKey: action.id }]);
  }
  async get(id: string): Promise<ActionRecord> {
    const action = (await this.pool.query<{ record: ActionRecord }>('SELECT record FROM pending_actions WHERE id=$1', [id])).rows[0]?.record;
    if (!action) throw new AppError('ACTION_NOT_FOUND', '待确认动作不存在', 404); return action;
  }
  async list(runId: string): Promise<ActionRecord[]> {
    return (await this.pool.query<{ record: ActionRecord }>('SELECT record FROM pending_actions WHERE run_id=$1 ORDER BY record->>\'createdAt\',id', [runId])).rows.map(row => row.record);
  }
  async attempts(id: string): Promise<Attempt[]> {
    return (await this.pool.query<Attempt>('SELECT seq::integer,type,data FROM action_attempts WHERE action_id=$1 ORDER BY seq', [id])).rows;
  }
  async expireDue(runId: string,claim?:RunClaim) {
    await this.tx(async client => {
      if(claim){if(claim.runId!==runId)throw problem('RUN_CLAIM_LOST');await assertRunClaim(client,claim);}
      const run = await this.run(client, runId);
      if (!['running','waiting_confirmation'].includes(run.status) || run.cancelRequested) return;
      const rows = await client.query<{ record: ActionRecord }>("SELECT record FROM pending_actions WHERE run_id=$1 AND record->>'status' IN ('pending','approved') FOR UPDATE", [runId]);
      for (const { record } of rows.rows) if (Date.parse(record.expiresAt) <= Date.parse(this.clock.now())) await this.expire(client, record);
    });
  }
  async prepare(runId: string, toolCallId: string, operation: string, input: unknown, ttl = 300_000,claim?:RunClaim): Promise<ActionRecord> {
    const args = normalizeAction(operation, input); const paramsHash = digest({ operation, args });
    if (!toolCallId || toolCallId.length > 200 || !Number.isInteger(ttl) || ttl < 1000 || ttl > 900_000) throw problem('INVALID_ACTION_INPUT');
    return this.tx(async client => {
      if(claim){if(claim.runId!==runId)throw problem('RUN_CLAIM_LOST');await assertRunClaim(client,claim);}
      const run = await this.run(client, runId);
      const old = (await client.query<{ record: ActionRecord }>('SELECT record FROM pending_actions WHERE run_id=$1 AND tool_call_id=$2', [runId, toolCallId])).rows[0]?.record;
      if (old) { if (old.paramsHash !== paramsHash) throw problem('ACTION_INPUT_CONFLICT'); return old; }
      if (run.cancelRequested || !['running','waiting_confirmation'].includes(run.status)) throw problem('RUN_NOT_ACTIVE');
      const snapshot = (await client.query<{ content: Snapshot['content']; digest: string }>('SELECT content,digest FROM snapshots WHERE id=$1', [run.snapshotId])).rows[0];
      const runtimeSpec=run.runtimeSpec??snapshot?.content.runtimeSpec;
      if (!snapshot || snapshot.digest !== run.snapshotDigest || digest(snapshot.content) !== run.snapshotDigest
          || !runtimeSpec?.agent.rails.includes('write-confirm') || !runtimeSpec.tools.some(tool => tool.operationId === operation)) throw problem('ACTION_NOT_BOUND');
      const createdAt = this.clock.now();
      const target = { id: randomUUID(), runId, actorId: run.actorId, environmentId: run.environmentId, snapshotDigest: run.snapshotDigest, artifactDigest: run.artifactDigest,
        toolCallId, operation, args, paramsHash, createdAt, expiresAt: new Date(Date.parse(createdAt) + ttl).toISOString() };
      const action: ActionRecord = { ...target, actionHash: digest(target), status: 'pending', updatedAt: createdAt };
      await client.query('INSERT INTO pending_actions(id,run_id,tool_call_id,record) VALUES ($1,$2,$3,$4)', [action.id, runId, toolCallId, action]);
      await client.query('UPDATE runs SET record=record || $2::jsonb WHERE id=$1', [runId, { status: 'waiting_confirmation', updatedAt: createdAt }]);
      await this.event(client, action, 'prepared', 'action.prepared', { actionId: action.id, actionHash: action.actionHash }); return action;
    });
  }
  private async expire(client: PoolClient, action: ActionRecord) {
    action.status = 'expired'; await this.save(client, action);
    await client.query('UPDATE runs SET record=record || $2::jsonb WHERE id=$1', [action.runId, { status: 'cancelling', cancelRequested: true, updatedAt: this.clock.now() }]);
    await this.event(client, action, 'expired', 'action.expired', { actionId: action.id });
  }
  async decide(id: string, runId: string, actorId: string, decision: ActionDecision, claim?: ValidationClaim): Promise<ActionRecord> {
    const result = await this.tx(async client => {
      if (claim) await assertValidationClaim(client, claim, runId);
      const run = await this.run(client, runId);
      const action = (await client.query<{ record: ActionRecord }>('SELECT record FROM pending_actions WHERE id=$1 FOR UPDATE', [id])).rows[0]?.record;
      if (!action || action.runId !== runId || action.actorId !== actorId || run.actorId !== actorId) throw problem('ACTION_FORBIDDEN');
      if (action.actionHash !== decision.actionHash) throw problem('ACTION_HASH_MISMATCH');
      if (action.status === 'expired') return 'expired' as const;
      if (action.decision) { if (action.decision !== decision.decision) throw problem('DECISION_CONFLICT'); return action; }
      if (action.status !== 'pending' || run.cancelRequested || run.status !== 'waiting_confirmation') throw problem('RUN_NOT_ACTIVE');
      if (Date.parse(action.expiresAt) <= Date.parse(this.clock.now())) { await this.expire(client, action); return 'expired' as const; }
      action.decisionId = decision.decisionId; action.decision = decision.decision; action.decidedAt = this.clock.now(); action.status = decision.decision === 'approve' ? 'approved' : 'rejected';
      await this.save(client, action);
      await client.query('UPDATE runs SET record=record || $2::jsonb WHERE id=$1', [runId, { status: decision.decision === 'approve' ? 'running' : 'cancelling', cancelRequested: decision.decision === 'reject', updatedAt: this.clock.now() }]);
      await this.event(client, action, 'decided', 'action.decided', { actionId: id, decisionId: action.decisionId, decision: action.decision }); return action;
    });
    if (result === 'expired') throw problem('ACTION_EXPIRED'); return result;
  }
  async claim(runId: string, actorId: string, toolCallId: string, operation: string, input: unknown): Promise<{ action: ActionRecord; write: boolean }> {
    const paramsHash = digest({ operation, args: normalizeAction(operation, input) });
    const result = await this.tx(async client => {
      const run = await this.run(client, runId);
      const action = (await client.query<{ record: ActionRecord }>('SELECT record FROM pending_actions WHERE run_id=$1 AND tool_call_id=$2 FOR UPDATE', [runId, toolCallId])).rows[0]?.record;
      if (!action) throw problem('APPROVAL_REQUIRED');
      if (action.actorId !== actorId || run.actorId !== actorId) throw problem('ACTION_FORBIDDEN');
      if (action.paramsHash !== paramsHash) {
        // Commit revocation and its evidence before returning the rejection to the caller.
        if(action.status==='approved'&&run.status==='running'&&!run.cancelRequested){
          action.status='invalidated';await this.save(client,action);await this.attempt(client,action,'input_rejected');
          await client.query('UPDATE runs SET record=record || $2::jsonb WHERE id=$1',[runId,{status:'cancelling',cancelRequested:true,updatedAt:this.clock.now()}]);
          await this.event(client,action,'input-rejected','action.input_rejected',{actionId:action.id,toolCallId,approvedParamsHash:action.paramsHash,receivedParamsHash:paramsHash});
        }
        return 'input_conflict' as const;
      }
      if (action.status === 'succeeded' || action.status === 'failed' || action.status === 'executing' || action.status === 'unknown') return { action, write: false };
      if (action.status !== 'approved' || action.decision !== 'approve') throw problem('APPROVAL_REQUIRED');
      if (run.cancelRequested || run.status !== 'running') throw problem('RUN_NOT_ACTIVE');
      if (Date.parse(action.expiresAt) <= Date.parse(this.clock.now())) { await this.expire(client, action); return 'expired' as const; }
      action.status = 'executing'; await this.save(client, action); await this.attempt(client, action, 'write_started'); return { action, write: true };
    });
    if (result === 'expired') throw problem('ACTION_EXPIRED');
    if (result === 'input_conflict') throw problem('ACTION_INPUT_CONFLICT');
    return result;
  }
  async settle(id: string, type: 'write_succeeded' | 'write_failed' | 'write_unknown' | 'reconcile_found' | 'reconcile_missing', response?: ActionRecord['response']): Promise<ActionRecord> {
    return this.tx(async client => {
      const action = (await client.query<{ record: ActionRecord }>('SELECT record FROM pending_actions WHERE id=$1 FOR UPDATE', [id])).rows[0]?.record;
      if (!action) throw problem('ACTION_NOT_FOUND');
      if (action.status === 'succeeded' || action.status === 'failed') return action;
      if (!['executing','unknown'].includes(action.status)) throw problem('ACTION_NOT_EXECUTING');
      action.status = type === 'write_failed' ? 'failed' : response ? 'succeeded' : 'unknown';
      if (response) action.response = response;
      await this.save(client, action); await this.attempt(client, action, type);
      await this.event(client, action, type, `action.${type}`, { actionId: id, status: action.status }); return action;
    });
  }
}
