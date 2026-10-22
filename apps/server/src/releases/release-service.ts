import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { ReleaseInput, ReleaseOperation, ReleaseReference, ReleasePointer, ReleaseVersion, ReleaseOverview } from '../../../../packages/contracts/src/releases.js';
import { contentDigest } from '../snapshots/domain/assembly.js';
import { AppError } from '../shared/errors.js';
import type { ReleaseClaim } from '../shared/release-claim.js';
export interface ReleaseGate { check(snapshotId: string, validationId: string): Promise<ReleaseReference> }
export interface ReleaseDriver {
  prepare(operation: ReleaseOperation, claim: ReleaseClaim): Promise<{ ready: boolean; artifactDigest: string; snapshotDigest: string }>;
  smoke(operation: ReleaseOperation, claim: ReleaseClaim): Promise<{ status: 'pending' } | { status: 'passed' | 'failed'; evidence: unknown }>;
  stop(operation: ReleaseOperation): Promise<void>;
}
export class ReleaseService {
  private readonly owner = randomUUID(); private working = false;
  constructor(private readonly pool: Pool, private readonly gate: ReleaseGate, private readonly driver: ReleaseDriver) {}
  async start(agentId: string, input: ReleaseInput): Promise<ReleaseOperation> {
    const inputDigest = contentDigest(input);
    const existing = (await this.pool.query<{ record: ReleaseOperation }>('SELECT record FROM release_operations WHERE agent_id=$1 AND client_request_id=$2', [agentId,input.clientRequestId])).rows[0]?.record;
    if (existing) { if (existing.inputDigest !== inputDigest) throw new AppError('REQUEST_INPUT_CONFLICT','同一发布请求不能更改目标',409); return existing; }
    const reference = await this.gate.check(input.snapshotId,input.validationId);
    if (reference.agentId !== agentId || reference.snapshotId !== input.snapshotId || reference.validationId !== input.validationId) throw new AppError('RELEASE_TARGET_MISMATCH','报告与发布目标不一致',409);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,103))',[agentId]);
      const duplicate = (await client.query<{ record: ReleaseOperation }>('SELECT record FROM release_operations WHERE agent_id=$1 AND client_request_id=$2',[agentId,input.clientRequestId])).rows[0]?.record;
      if (duplicate) { if (duplicate.inputDigest !== inputDigest) throw new AppError('REQUEST_INPUT_CONFLICT','同一发布请求不能更改目标',409); await client.query('COMMIT'); return duplicate; }
      const active = await client.query("SELECT id FROM release_operations WHERE agent_id=$1 AND record->>'status' IN ('queued','preparing','smoking')",[agentId]);
      if (active.rowCount) throw new AppError('RELEASE_BUSY','同一 Agent 的发布或回滚正在进行',409);
      await client.query('INSERT INTO release_pointers(agent_id,record) VALUES ($1,$2) ON CONFLICT DO NOTHING',[agentId,{agentId,revision:0,environmentId:randomUUID()}]);
      const pointer = (await client.query<{record:ReleasePointer}>('SELECT record FROM release_pointers WHERE agent_id=$1 FOR UPDATE',[agentId])).rows[0]!.record;
      if (pointer.revision !== input.expectedRevision) throw new AppError('RELEASE_REVISION_CONFLICT','现行版本已变更，请刷新后再发布',409);
      if (input.rollbackVersionId) {
        const previous = (await client.query<{record:ReleaseVersion}>('SELECT record FROM release_versions WHERE id=$1 AND agent_id=$2',[input.rollbackVersionId,agentId])).rows[0]?.record;
        if (!previous || previous.snapshotId !== input.snapshotId||previous.reference.binding.artifactDigest!==reference.binding.artifactDigest
          ||contentDigest(previous.reference.binding.candidate??null)!==contentDigest(reference.binding.candidate??null)) throw new AppError('ROLLBACK_TARGET_MISMATCH','回滚目标必须是该 Agent 历史版本的同一候选与制品',409);
      }
      const now = new Date().toISOString(); const operation: ReleaseOperation = { id:randomUUID(), agentId, versionId:randomUUID(), deploymentId:randomUUID(), environmentId:pointer.environmentId, smokeRunId:randomUUID(), request:input,inputDigest,reference,status:'queued',createdAt:now,updatedAt:now };
      await client.query('INSERT INTO release_operations(id,agent_id,client_request_id,record) VALUES ($1,$2,$3,$4)',[operation.id,agentId,input.clientRequestId,operation]);
      await client.query('COMMIT'); return operation;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async tick(): Promise<void> {
    if (this.working) return; this.working = true;
    let claim: {record:ReleaseOperation;fencing_token:string} | undefined;
    try {
      claim = (await this.pool.query<{record:ReleaseOperation;fencing_token:string}>(`UPDATE release_operations SET lease_owner=$1,lease_until=now()+interval '120 seconds',fencing_token=fencing_token+1,last_polled_at=clock_timestamp()
        WHERE id=(SELECT id FROM release_operations WHERE (record->>'status' IN ('queued','preparing','smoking') OR (record->>'status'='failed' AND cleanup_pending)) AND (lease_until IS NULL OR lease_until<now()) ORDER BY last_polled_at,record->>'createdAt' FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING record,fencing_token`,[this.owner])).rows[0];
      if (!claim) return;
      const operation = claim.record; let smokeEvidence: unknown;
      const authority: ReleaseClaim = { kind: 'release', operationId: operation.id, owner: this.owner, token: claim.fencing_token };
      if (operation.status === 'failed') { await this.cleanup(operation); return; }
      try {
        const current = await this.gate.check(operation.request.snapshotId,operation.request.validationId);
        if (contentDigest(current) !== contentDigest(operation.reference)) throw new AppError('VALIDATION_BINDING_CHANGED','验证环境发生变化，不能复用报告',409);
        if (operation.status === 'queued' || operation.status === 'preparing') {
          operation.status = 'preparing'; const deployment = await this.driver.prepare(operation, authority);
          if (!deployment.ready || deployment.artifactDigest !== current.binding.artifactDigest || deployment.snapshotDigest !== current.binding.snapshotDigest) throw new AppError('DEPLOYMENT_NOT_READY','目标实例未就绪或摘要不匹配',409);
          operation.status = 'smoking';
        } else {
          const smoke = await this.driver.smoke(operation, authority);
          if (smoke.status === 'pending') return;
          if (smoke.status !== 'passed') throw new AppError('SMOKE_FAILED','目标实例只读冒烟失败，保留原入口',409);
          smokeEvidence = smoke.evidence;
          if (contentDigest(await this.gate.check(operation.request.snapshotId,operation.request.validationId)) !== contentDigest(operation.reference)) throw new AppError('VALIDATION_BINDING_CHANGED','切换前验证绑定已变化',409);
          operation.status = 'succeeded';
        }
      } catch (error) {
        // Commit failure under the lease fence before any destructive cleanup. A stale
        // worker must never stop a deployment that its successor may have published.
        operation.status = 'failed'; operation.diagnostic = error instanceof AppError ? error.code : 'RELEASE_EXECUTION_FAILED';
      }
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const own = await client.query('SELECT id FROM release_operations WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3 AND lease_until>clock_timestamp() FOR UPDATE',[operation.id,this.owner,claim.fencing_token]);
        if (!own.rowCount) { await client.query('ROLLBACK'); return; }
        if (operation.status === 'succeeded') {
          const pointer = (await client.query<{record:ReleasePointer}>('SELECT record FROM release_pointers WHERE agent_id=$1 FOR UPDATE',[operation.agentId])).rows[0]!.record;
          if (pointer.revision !== operation.request.expectedRevision) throw new AppError('RELEASE_REVISION_CONFLICT','切换时发布版本已改变',409);
          const version:ReleaseVersion = {id:operation.versionId,agentId:operation.agentId,operationId:operation.id,snapshotId:operation.reference.snapshotId,validationId:operation.reference.validationId,deploymentId:operation.deploymentId,environmentId:operation.environmentId,reference:operation.reference,smokeEvidence,createdAt:new Date().toISOString()};
          await client.query('INSERT INTO release_versions(id,agent_id,operation_id,record) VALUES ($1,$2,$3,$4)',[version.id,version.agentId,operation.id,version]);
          await client.query('UPDATE release_pointers SET record=$2 WHERE agent_id=$1',[operation.agentId,{...pointer,revision:pointer.revision+1,versionId:version.id,deploymentId:version.deploymentId}]);
        }
        operation.updatedAt = new Date().toISOString(); await client.query('UPDATE release_operations SET record=$2,cleanup_pending=$3 WHERE id=$1',[operation.id,operation,operation.status === 'failed']); await client.query('COMMIT');
      } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      if (operation.status === 'failed') await this.cleanup(operation);
    } finally {
      try { if(claim) await this.pool.query('UPDATE release_operations SET lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3',[claim.record.id,this.owner,claim.fencing_token]); } finally { this.working=false; }
    }
  }
  private async cleanup(operation: ReleaseOperation) {
    // Failed operations are immutable and can never become published versions. A new
    // operation receives a different deployment ID; cleanup is therefore safe to retry.
    try {
      await this.driver.stop(operation);
      await this.pool.query("UPDATE release_operations SET cleanup_pending=false WHERE id=$1 AND record->>'status'='failed'",[operation.id]);
    } catch { /* Durable cleanup_pending is retried after lease release. */ }
  }
  async get(id:string):Promise<ReleaseOperation> { const record=(await this.pool.query<{record:ReleaseOperation}>('SELECT record FROM release_operations WHERE id=$1',[id])).rows[0]?.record; if(!record) throw new AppError('RELEASE_NOT_FOUND','发布操作不存在',404); return record; }
  async overview(agentId:string):Promise<ReleaseOverview> {
    const [pointer,operations,versions]=await Promise.all([
      this.pool.query<{record:ReleasePointer}>('SELECT record FROM release_pointers WHERE agent_id=$1',[agentId]),
      this.pool.query<{record:ReleaseOperation;cleanup_pending:boolean}>("SELECT record,cleanup_pending FROM release_operations WHERE agent_id=$1 ORDER BY record->>'createdAt' DESC LIMIT 100",[agentId]),
      this.versions(agentId)
    ]);
    return {pointer:pointer.rows[0]?.record??null,operations:operations.rows.map(r=>r.record),versions,cleanupPending:operations.rows.filter(r=>r.cleanup_pending).map(r=>r.record.id)};
  }
  async pointer(agentId:string):Promise<ReleasePointer> { const record=(await this.pool.query<{record:ReleasePointer}>('SELECT record FROM release_pointers WHERE agent_id=$1',[agentId])).rows[0]?.record; if(!record) throw new AppError('RELEASE_NOT_FOUND','尚无发布记录',404); return record; }
  async versions(agentId:string):Promise<ReleaseVersion[]> { return (await this.pool.query<{record:ReleaseVersion}>("SELECT record FROM release_versions WHERE agent_id=$1 ORDER BY record->>'createdAt' DESC",[agentId])).rows.map(r=>r.record); }
}
