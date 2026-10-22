import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Snapshot } from '../../../../../packages/contracts/src/index.js';
import type { BusinessCase } from '../../../../../packages/contracts/src/baselines.js';
import type { RuntimeModelProfile } from '../../../../../packages/contracts/src/model-profile.js';
import type { ValidationExecution, ValidationInput, ValidationBinding, CaseProgress, ProjectCaseResult, ValidationReport } from '../../../../../packages/contracts/src/validations.js';
import type { Clock } from '../../drafts/domain/ports.js';
import type { SnapshotService } from '../../snapshots/application/snapshot-service.js';
import { contentDigest } from '../../snapshots/domain/assembly.js';
import { AppError } from '../../shared/errors.js';
import type { BaselineService } from './baseline-service.js';
import { evaluateProjectCase, combineVerdicts, type CaseObservation } from './case-assertions.js';
import type { ValidationClaim } from '../../shared/validation-claim.js';
import { validationBinding } from './validation-binding.js';
import type {CandidateService} from '../../candidates/candidate-service.js';
import {candidateEvidenceComplete} from './candidate-evidence.js';
export interface ValidationTarget { snapshot: Snapshot; binding: ValidationBinding; claim: ValidationClaim;baselineId?:string }
export interface ValidationDriver {
  candidateValidation?:true;
  identity(candidateId?:string): Promise<{ artifactDigest: string; modelProfile: RuntimeModelProfile; mockDigest: string }>;
  advance(target: ValidationTarget, item: BusinessCase, progress: CaseProgress): Promise<CaseObservation | { pending: true; progress: CaseProgress } | { unsupported: true; reason: string }>;
  cancel(runId: string, claim: ValidationClaim): Promise<boolean>;
}
export class ValidationService {
  private readonly worker = randomUUID(); private working = false;
  constructor(private readonly pool: Pool, private readonly baselines: BaselineService, private readonly snapshots: SnapshotService, private readonly driver: ValidationDriver, private readonly clock: Clock,private readonly candidates?:Pick<CandidateService,'get'|'validationReference'>) {}
  async start(snapshotId: string, input: ValidationInput): Promise<ValidationExecution> {
    const inputDigest = contentDigest(input);
    const existing = (await this.pool.query<{ record: ValidationExecution }>('SELECT record FROM validation_executions WHERE snapshot_id=$1 AND client_request_id=$2', [snapshotId, input.clientRequestId])).rows[0]?.record;
    if (existing) { if (existing.inputDigest !== inputDigest) throw new AppError('REQUEST_INPUT_CONFLICT', '相同请求不能更改验收目标', 409); return existing; }
    const snapshot = await this.snapshots.get(snapshotId); const baseline = await this.baselines.assertTarget(input.baselineId, snapshot);
    if (baseline.content.cases.some(c => c.scenario.startsWith('workorder-')) && !input.allowMockWrites) throw new AppError('MOCK_WRITES_CONFIRMATION_REQUIRED', '该测试集包含模拟写入，请确认后执行', 422);
    if(input.candidateId&&(!this.candidates||!this.driver.candidateValidation))throw new AppError('CANDIDATE_VALIDATION_UNAVAILABLE','候选验收执行器不可用',409);
    const candidate=input.candidateId?await this.candidates!.get(input.candidateId):undefined;
    if(candidate&&(candidate.snapshotId!==snapshotId||candidate.snapshotDigest!==snapshot.digest||candidate.generated&&(candidate.generated.baselineId!==baseline.id||candidate.generated.baselineDigest!==baseline.digest)))throw new AppError('CANDIDATE_TARGET_MISMATCH','候选与需求快照或确认基线不匹配',409);
    const identity = await this.driver.identity(input.candidateId);
    if(candidate&&identity.artifactDigest!==candidate.artifactDigest)throw new AppError('CANDIDATE_RUNTIME_CHANGED','执行器未指向此候选制品',409);
    if (![identity.artifactDigest, identity.mockDigest, identity.modelProfile.digest].every(value => /^[a-f0-9]{64}$/.test(value))) throw new AppError('VALIDATION_ENVIRONMENT_BLOCKED', '验证依赖的版本信息不完整', 409);
    const binding = validationBinding(snapshot,baseline,identity);
    if(candidate)binding.candidate=await this.candidates!.validationReference(candidate.id);
    const now = this.clock.now();
    const record: ValidationExecution = { id: randomUUID(), snapshotId, baselineId: baseline.id, clientRequestId: input.clientRequestId, inputDigest,
      allowMockWrites: input.allowMockWrites, binding, status: 'queued', cases: baseline.content.cases.map(item => ({ caseId: item.id, runId: randomUUID(), state: 'queued' })), results: [], createdAt: now, updatedAt: now };
    const inserted = await this.pool.query<{ record: ValidationExecution }>('INSERT INTO validation_executions(id,snapshot_id,baseline_id,client_request_id,record) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING record', [record.id, snapshotId, baseline.id, input.clientRequestId, record]);
    if (inserted.rows[0]) return record;
    return this.start(snapshotId, input);
  }
  async get(id: string): Promise<ValidationExecution> {
    const record = (await this.pool.query<{ record: ValidationExecution }>('SELECT record FROM validation_executions WHERE id=$1', [id])).rows[0]?.record;
    if (!record) throw new AppError('VALIDATION_NOT_FOUND', '验证任务不存在', 404); return record;
  }
  async list(snapshotId: string): Promise<ValidationExecution[]> { return (await this.pool.query<{ record: ValidationExecution }>("SELECT record FROM validation_executions WHERE snapshot_id=$1 ORDER BY record->>'createdAt' DESC LIMIT 100", [snapshotId])).rows.map(row => row.record); }
  async report(id: string): Promise<ValidationReport> {
    const row = (await this.pool.query<{ record: ValidationReport; digest: string }>('SELECT record,digest FROM validation_reports WHERE execution_id=$1', [id])).rows[0];
    if (!row) throw new AppError('REPORT_NOT_READY', '验证报告尚未形成', 409);
    if (contentDigest(row.record) !== row.digest) throw new AppError('REPORT_INTEGRITY_ERROR', '报告摘要校验失败', 409);
    for (const item of row.record.cases) if (item.evidenceId) {
      const proof = await this.evidence(id, item.evidenceId);
      if (contentDigest(proof) !== item.evidenceDigest) throw new AppError('EVIDENCE_INTEGRITY_ERROR', '证据摘要校验失败', 409);
    }
    return row.record;
  }
  async evidence(executionId: string, id: string) {
    const row = (await this.pool.query<{ content: CaseObservation; digest: string }>('SELECT content,digest FROM validation_evidence WHERE execution_id=$1 AND id=$2', [executionId, id])).rows[0];
    if (!row || contentDigest(row.content) !== row.digest) throw new AppError('EVIDENCE_UNAVAILABLE', '证据不存在或摘要不匹配', 409); return row.content;
  }
  async cancel(id: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const record = (await client.query<{ record: ValidationExecution }>('SELECT record FROM validation_executions WHERE id=$1 FOR UPDATE', [id])).rows[0]?.record;
      if (!record) throw new AppError('VALIDATION_NOT_FOUND', '验证任务不存在', 404);
      if (record.status !== 'completed') {
        await client.query('UPDATE validation_executions SET record=record || $2::jsonb WHERE id=$1', [id, { status: 'cancelling', updatedAt: this.clock.now() }]);
        const cancelled = await client.query<{ id: string }>("UPDATE runs SET record=record || $2::jsonb WHERE id=ANY($1::uuid[]) AND record->>'status' IN ('queued','running','waiting_confirmation','reconciling','cancelling') RETURNING id", [record.cases.map(c => c.runId), { status: 'cancelling', cancelRequested: true, updatedAt: this.clock.now() }]);
        for (const run of cancelled.rows) await client.query("INSERT INTO run_events(run_id,source,source_key,type,data) VALUES ($1,'platform','cancel-requested','run.cancel_requested',$2) ON CONFLICT DO NOTHING", [run.id, { validationId: id }]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return this.get(id);
  }
  async tick() {
    if (this.working) return; this.working = true;
    let claim: { record: ValidationExecution; fencing_token: string } | undefined;
    try {
      claim = (await this.pool.query<{ record: ValidationExecution; fencing_token: string }>(`UPDATE validation_executions SET lease_owner=$1,lease_until=now()+interval '120 seconds',fencing_token=fencing_token+1
        WHERE id=(SELECT id FROM validation_executions WHERE record->>'status' IN ('queued','running','cancelling') AND (lease_until IS NULL OR lease_until<now())
          ORDER BY record->>'updatedAt' FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING record,fencing_token`, [this.worker])).rows[0];
      if (!claim) return;
      const authority: ValidationClaim = { executionId: claim.record.id, owner: this.worker, token: claim.fencing_token };
      const record = claim.record; const baseline = await this.baselines.get(record.baselineId); const snapshot = await this.snapshots.get(record.snapshotId);
      const progress = record.cases.find(c => c.state !== 'completed'); if (!progress) return;
      const item = baseline.content.cases.find(c => c.id === progress.caseId); if (!item) throw new Error('CASE_MISSING');
      let result: ProjectCaseResult | undefined; let observation: CaseObservation | undefined;
      if (record.status === 'cancelling') {
        if (!await this.driver.cancel(progress.runId, authority)) return;
        result = { caseId: item.id, status: 'unverified', assertions: [], reasons: ['VALIDATION_CANCELLED'] };
      } else {
        record.status = 'running'; progress.startedAt ??= this.clock.now(); progress.state = 'running';
        try {
          const current = await this.driver.identity(record.binding.candidate?.id);
          if (current.artifactDigest !== record.binding.artifactDigest || current.modelProfile.digest !== record.binding.modelProfile.digest || current.mockDigest !== record.binding.mockDigest) throw new Error('VALIDATION_BINDING_CHANGED');
          if (Date.parse(this.clock.now()) - Date.parse(progress.startedAt) > 480_000) {
            if (!await this.driver.cancel(progress.runId, authority)) return;
            result = { caseId: item.id, status: 'blocked', assertions: [], reasons: ['CASE_DEADLINE_EXCEEDED'] };
          } else {
            const advanced = await this.driver.advance({ snapshot, binding: record.binding, claim: authority,baselineId:record.baselineId }, item, progress);
            if ('pending' in advanced) Object.assign(progress, advanced.progress);
            else if ('unsupported' in advanced) result = { caseId: item.id, status: 'unverified', assertions: [], reasons: [advanced.reason] };
            else {
              // PostgreSQL timestamps arrive as Date instances. Hash the exact JSON representation
              // that will be stored, so reading JSONB cannot change the evidence digest.
              observation = JSON.parse(JSON.stringify(advanced)) as CaseObservation;
              if(record.binding.candidate){
                if(!this.candidates||!candidateEvidenceComplete(observation,await this.candidates.get(record.binding.candidate.id),record.binding,record.id,progress))observation.complete=false;
              }
              result = evaluateProjectCase(item, observation);
            }
          }
        } catch (error) {
          if (error instanceof AppError && error.code === 'VALIDATION_CLAIM_LOST') throw error;
          // A failed observation is a blocked case, never proof of zero downstream effects.
          if (progress.state === 'running' && !await this.driver.cancel(progress.runId, authority)) return;
          result = { caseId: item.id, status: 'blocked', assertions: [], reasons: ['EXECUTION_OR_EVIDENCE_UNAVAILABLE'] };
        }
      }
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const locked = (await client.query<{ record: ValidationExecution }>('SELECT record FROM validation_executions WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3 AND lease_until>clock_timestamp() FOR UPDATE', [record.id, this.worker, claim.fencing_token])).rows[0]?.record;
        if (!locked) { await client.query('ROLLBACK'); return; }
        if (locked.status === 'cancelling'&&record.status!=='cancelling') {
          // Accepted cancellation wins even when the final passing observation arrived late.
          record.status='cancelling';result=undefined;observation=undefined;
        }
        if (result) {
          if (observation) {
            const evidenceId = randomUUID(); const digest = contentDigest(observation);
            await client.query('INSERT INTO validation_evidence(id,execution_id,case_id,digest,content) VALUES ($1,$2,$3,$4,$5)', [evidenceId, record.id, item.id, digest, observation]);
            result.evidenceId = evidenceId; result.evidenceDigest = digest;
          }
          progress.state = 'completed'; record.results.push(result);
        }
        if (record.cases.every(c => c.state === 'completed')) {
          const cases = baseline.content.cases.map(item => record.results.find(result => result.caseId === item.id) ?? { caseId: item.id, status: 'unverified' as const, assertions: [], reasons: ['RESULT_MISSING'] });
          const reasons: string[] = []; if (record.binding.modelProfile.executionMode !== 'live-mock') reasons.push('REAL_MODEL_REQUIRED');
          const verdict = combineVerdicts([...cases.map(c => c.status), ...(reasons.length ? ['unverified' as const] : [])]);
          const report: ValidationReport = { executionId: record.id, baselineId: record.baselineId, snapshotId: record.snapshotId, binding: record.binding, verdict, reasons, cases, createdAt: this.clock.now() };
          await client.query('INSERT INTO validation_reports(execution_id,digest,record) VALUES ($1,$2,$3)', [record.id, contentDigest(report), report]); record.status = 'completed'; record.verdict = verdict;
        }
        record.updatedAt = this.clock.now(); await client.query('UPDATE validation_executions SET record=$2 WHERE id=$1', [record.id, record]); await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'VALIDATION_CLAIM_LOST')) throw error;
    } finally {
      try { if (claim) await this.pool.query('UPDATE validation_executions SET lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3', [claim.record.id, this.worker, claim.fencing_token]); }
      finally { this.working = false; }
    }
  }
}
