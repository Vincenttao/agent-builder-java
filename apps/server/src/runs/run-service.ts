import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { RuntimeSpec } from '../../../../packages/contracts/src/index.js';
import type { RunEvent, RunInput, RunRecord, RunEnvironment } from '../../../../packages/contracts/src/runs.js';
import { canonicalJson } from '../../../../packages/contracts/src/canonical.js';
import type { SnapshotService } from '../snapshots/application/snapshot-service.js';
import { AppError } from '../shared/errors.js';
import { PostgresActions } from '../actions/postgres-actions.js';
import type { ActionService } from '../actions/action-service.js';
import type { RuntimeModelProfile } from '../../../../packages/contracts/src/model-profile.js';
import { assertValidationClaim, type ValidationClaim } from '../shared/validation-claim.js';
import { assertReleaseClaim, type ReleaseClaim } from '../shared/release-claim.js';
import type { ReleaseVersion } from '../../../../packages/contracts/src/releases.js';
import type { Invocation } from '../../../../packages/contracts/src/invocations.js';
import {assertRunClaim,type RunClaim} from '../shared/run-claim.js';
import {requireTestTarget} from '../candidates/test-deployment-service.js';
import type {RuntimeArtifact} from '../../../../packages/contracts/src/artifacts.js';
import {runtimeArtifactMatches} from './artifact-binding.js';
import {contentDigest} from '../snapshots/domain/assembly.js';
import type {TestDeployment} from '../../../../packages/contracts/src/candidates.js';
import type {ValidationExecution} from '../../../../packages/contracts/src/validations.js';
export interface RuntimeExecution { id: string; status: string; result?: unknown; events: unknown[]; error?: string }
export interface RunRuntime {
  artifact?(digest:string):Promise<RuntimeArtifact>;
  packageGenerated?(jobId:string,input:{bundleDigest:string;specDigest:string}):Promise<RuntimeArtifact>;
  capabilities(): Promise<{ artifactDigest: string; modelConfigured: boolean; executionMode: string; bootId: string; modelProfile?: RuntimeModelProfile | null }>;
  deploy(id: string, artifactDigest: string, spec: RuntimeSpec): Promise<{ status: string }>;
  claim(id:string,fencingToken:string):Promise<unknown>;
  begin(id: string, request: { deploymentId: string; sessionId: string; message: string },fencingToken:string): Promise<RuntimeExecution>;
  execution(id: string): Promise<RuntimeExecution | null>;
  cancel(id: string,fencingToken:string): Promise<RuntimeExecution>;
  resume?(id: string, resumeId: string, toolCallId: string, approved: boolean,fencingToken:string): Promise<RuntimeExecution>;
  events(id: string): Promise<unknown[]>;
  stop(id: string): Promise<{ status: string }>;
  retire(id:string):Promise<{status:string}>;
}
export interface MockControl { ready(): Promise<boolean>; prepare(environmentId: string, runId: string, config?: RunEnvironment): Promise<void>; release(environmentId: string, runId: string): Promise<void>; calls(environmentId: string, runId: string): Promise<unknown[]> }
export interface ValidationRunSetup { runId: string; environmentConfig: RunEnvironment; artifactDigest: string; modelDigest: string; claim: ValidationClaim }
export interface SharedRunSetup {
  runId: string; environmentId: string; deploymentId: string; artifactDigest: string; modelDigest: string; runtimeSpec?:RuntimeSpec;
  actorId: 'U1001' | 'U1002';
  invocationId?: string; conversationId?: string;
  target: { kind: 'release-smoke'; claim: ReleaseClaim } | { kind: 'published'; versionId: string } | {kind:'test';testDeploymentId:string;candidateId:string};
}
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
export class RunService {
  private readonly workerId = randomUUID();
  private working = false;
  private claim:RunClaim|undefined;
  private claimLost=false;
  constructor(private readonly pool: Pool, private readonly snapshots: SnapshotService, private readonly runtime: RunRuntime, private readonly mock: MockControl,
    private readonly actions = new PostgresActions(pool), private readonly writes?: ActionService,
    private readonly workerOptions={leaseMs:120000,heartbeatMs:20000}) {
    if(!Number.isInteger(workerOptions.leaseMs)||!Number.isInteger(workerOptions.heartbeatMs)||workerOptions.leaseMs<100||workerOptions.heartbeatMs<10||workerOptions.heartbeatMs>=workerOptions.leaseMs/2)throw new Error('Invalid Run worker lease configuration');
  }
  async readiness() {
    const [runtime, mock] = await Promise.all([this.runtime.capabilities().catch(() => null), this.mock.ready().catch(() => false)]);
    return { runtime, mock, canRun: Boolean(runtime?.modelConfigured && /^[a-f0-9]{64}$/.test(runtime.artifactDigest) && runtime.executionMode === 'trusted-local' && mock) };
  }
  async createShared(snapshotId: string, input: RunInput, setup: SharedRunSetup): Promise<RunRecord> {
    return this.admit(snapshotId, input, undefined, setup);
  }
  async create(snapshotId: string, input: RunInput, setup?: ValidationRunSetup) {
    return this.admit(snapshotId, input, setup);
  }
  private async admit(snapshotId: string, input: RunInput, setup?: ValidationRunSetup, shared?: SharedRunSetup) {
    const sharedTarget: RunRecord['sharedTarget'] = shared?.target.kind === 'published' ? { kind: 'published', versionId: shared.target.versionId }
      : shared?.target.kind === 'release-smoke' ? { kind: 'release-smoke', operationId: shared.target.claim.operationId }
      : shared?.target.kind === 'test' ? {...shared.target} : undefined;
    const stableSetup = setup ? { runId: setup.runId, environmentConfig: setup.environmentConfig, artifactDigest: setup.artifactDigest, modelDigest: setup.modelDigest, validationId: setup.claim.executionId }
      : shared ? { runId: shared.runId, environmentId: shared.environmentId, deploymentId: shared.deploymentId, artifactDigest: shared.artifactDigest, modelDigest: shared.modelDigest, ...(shared.runtimeSpec?{specDigest:contentDigest(shared.runtimeSpec)}:{}), actorId: shared.actorId, sharedTarget, ...(shared.invocationId?{invocationId:shared.invocationId,conversationId:shared.conversationId}:{}) } : undefined;
    const inputDigest = createHash('sha256').update(canonicalJson(stableSetup ? { input, setup: stableSetup } : input)).digest('hex');
    const old = await this.findRequest(snapshotId, input.clientRequestId);
    if (old) { if (old.inputDigest !== inputDigest) throw new AppError('REQUEST_INPUT_CONFLICT', '同一请求编号不能更改输入', 409); return old; }
    const target = await this.snapshots.get(snapshotId); const readiness = await this.readiness();
    if (!readiness.canRun) throw new AppError('ENVIRONMENT_BLOCKED', 'Runner、模型配置或 Mock 服务未就绪', 409);
    const pinned = setup ?? shared;
    const runtimeSpec=shared?.runtimeSpec??target.content.runtimeSpec;
    if (pinned && (!await runtimeArtifactMatches(this.runtime,pinned.artifactDigest,readiness.runtime!.artifactDigest,contentDigest(runtimeSpec),snapshotId) || readiness.runtime!.modelProfile?.digest !== pinned.modelDigest)) throw new AppError('VALIDATION_BINDING_CHANGED', '验收依赖版本已改变，请重新发起验证', 409);
    const now = new Date().toISOString(); const id = pinned?.runId ?? randomUUID();
    const record: RunRecord = { id, snapshotId, snapshotDigest: target.digest, artifactDigest: pinned?.artifactDigest ?? readiness.runtime!.artifactDigest, environmentId: shared?.environmentId ?? randomUUID(), actorId: shared?.actorId ?? 'U1001',
      ...input, ...(sharedTarget ? { sharedTarget } : {}), ...(shared?.runtimeSpec?{runtimeSpec:structuredClone(shared.runtimeSpec)}:{}), ...(setup ? { environmentConfig: setup.environmentConfig, validationId: setup.claim.executionId } : {}), ...(readiness.runtime?.modelProfile ? { modelProfile: readiness.runtime.modelProfile } : {}), inputDigest, deploymentId: shared?.deploymentId ?? id, status: 'queued', cancelRequested: false, started: false, createdAt: now, updatedAt: now, externalEvidence: [], dependencyFailures: 0 };
    if(shared?.invocationId){record.invocationId=shared.invocationId;if(shared.conversationId)record.conversationId=shared.conversationId;}
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Preserve lock order: validation -> test deployment -> invocation -> Run.
      if(shared?.target.kind==='test'){
        const target=(await client.query<{record:TestDeployment}>('SELECT record FROM test_deployments WHERE id=$1',[shared.target.testDeploymentId])).rows[0]?.record;
        if(target?.validation){
          const validation=(await client.query<{record:ValidationExecution}>('SELECT record FROM validation_executions WHERE id=$1 FOR UPDATE',[target.validation.executionId])).rows[0]?.record;
          if(!validation||!['queued','running'].includes(validation.status)||!validation.cases.some(c=>c.runId===id&&c.caseId===target.validation!.caseId&&c.state!=='completed')
            ||target.validation.runId!==id||target.validation.input!==input.input||target.validation.actorId!==shared.actorId||validation.binding.candidate?.id!==target.candidateId)
            throw new AppError('VALIDATION_CLAIM_LOST','验收已取消或测试目标不匹配',409);
          record.validationId=validation.id;
        }
      }
      // All candidate admission and stop transactions lock deployment before request and Run.
      const test=shared?.target.kind==='test'?await requireTestTarget(client,shared.target.testDeploymentId,true):undefined;
      if(test&&(!shared?.invocationId||shared.target.kind!=='test'||test.candidateId!==shared.target.candidateId))throw new AppError('SHARED_TARGET_MISMATCH','测试运行必须由固定候选请求准入',409);
      if(test&&(!shared?.runtimeSpec||contentDigest(shared.runtimeSpec)!==contentDigest(test.runtimeSpec??target.content.runtimeSpec)||(test.binding.candidate?.specDigest??contentDigest(test.runtimeSpec??target.content.runtimeSpec))!==contentDigest(shared.runtimeSpec)))throw new AppError('SHARED_TARGET_MISMATCH','测试运行规格与候选不匹配',409);
      if(shared?.invocationId){
        const request=(await client.query<{record:Invocation}>('SELECT record FROM invocations WHERE id=$1 FOR UPDATE',[shared.invocationId])).rows[0]?.record;
        if(!request||!['reserved','blocked'].includes(request.status)||request.runId!==id||request.conversationId!==shared.conversationId||request.input!==input.input
          ||input.clientRequestId!==id||request.actorId!==shared.actorId||request.environmentId!==shared.environmentId||request.agentId!==target.draftId
          ||!(shared.target.kind==='published'&&request.agentVersion===shared.target.versionId&&!request.testDeploymentId
            ||shared.target.kind==='test'&&request.testDeploymentId===shared.target.testDeploymentId&&request.candidateId===shared.target.candidateId&&request.agentVersion===null))
          throw new AppError('INVOCATION_NOT_ADMISSIBLE','业务请求已取消或运行目标不匹配',409);
      }
      if (setup) {
        const validation = await assertValidationClaim(client, setup.claim, id);
        if (validation.snapshotId !== snapshotId) throw new AppError('VALIDATION_TARGET_MISMATCH', '验证任务与运行目标不一致', 409);
      }
      if (shared) {
        let bound: { snapshotId: string; deploymentId: string; environmentId: string; artifactDigest: string; modelDigest: string; snapshotDigest: string } | undefined;
        if (shared.target.kind === 'release-smoke') {
          const operation = await assertReleaseClaim(client, shared.target.claim, id);
          bound = { snapshotId: operation.reference.snapshotId, deploymentId: operation.deploymentId, environmentId: operation.environmentId,
            artifactDigest: operation.reference.binding.artifactDigest, modelDigest: operation.reference.binding.modelProfile.digest, snapshotDigest: operation.reference.binding.snapshotDigest };
        } else if(shared.target.kind==='published') {
          const version = (await client.query<{record: ReleaseVersion}>('SELECT record FROM release_versions WHERE id=$1', [shared.target.versionId])).rows[0]?.record;
          if (version) bound = { snapshotId: version.snapshotId, deploymentId: version.deploymentId, environmentId: version.environmentId,
            artifactDigest: version.reference.binding.artifactDigest, modelDigest: version.reference.binding.modelProfile.digest, snapshotDigest: version.reference.binding.snapshotDigest };
        } else if(test){
          bound={snapshotId:test.snapshotId,deploymentId:test.deploymentId,environmentId:test.environmentId,artifactDigest:test.binding.artifactDigest,modelDigest:test.binding.modelProfile.digest,snapshotDigest:test.binding.snapshotDigest};
          record.environmentConfig=test.environmentConfig;
        }
        if (!bound || bound.snapshotId !== snapshotId || bound.deploymentId !== shared.deploymentId || bound.environmentId !== shared.environmentId
          || bound.artifactDigest !== shared.artifactDigest || bound.modelDigest !== shared.modelDigest || bound.snapshotDigest !== target.digest
          || !['U1001','U1002'].includes(shared.actorId) || shared.target.kind === 'release-smoke' && shared.actorId !== 'U1001')
          throw new AppError('SHARED_TARGET_MISMATCH', '共享部署运行必须绑定已发布版本或当前发布冒烟目标', 409);
      }
      await client.query('SELECT pg_advisory_xact_lock(183421054)');
      const existing = (await client.query<{ record: RunRecord }>('SELECT record FROM runs WHERE snapshot_id=$1 AND client_request_id=$2', [snapshotId, input.clientRequestId])).rows[0]?.record;
      if (existing) {
        if (existing.inputDigest !== inputDigest) throw new AppError('REQUEST_INPUT_CONFLICT', '同一请求编号不能更改输入', 409);
        await client.query('COMMIT'); return existing;
      }
      const active = await client.query<{ count: number }>("SELECT count(*)::integer FROM runs WHERE record->>'status' IN ('queued','running','waiting_confirmation','reconciling','cancelling')");
      if (active.rows[0]!.count >= 8) throw new AppError('RUN_LIMIT', '本地活动运行已达上限 8', 429);
      await client.query('INSERT INTO runs(id,snapshot_id,client_request_id,input_digest,record) VALUES ($1,$2,$3,$4,$5)', [id, snapshotId, input.clientRequestId, inputDigest, record]);
      await client.query("INSERT INTO run_events(run_id,source,source_key,type,data) VALUES ($1,'platform','created','run.queued',$2)", [id, { snapshotId, snapshotDigest: target.digest, artifactDigest: record.artifactDigest }]);
      if(shared?.invocationId)await client.query("UPDATE invocations SET record=(record-'diagnostic') || $2::jsonb WHERE id=$1",[shared.invocationId,{status:'admitted',updatedAt:now}]);
      await client.query('COMMIT'); return record;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async findRequest(snapshotId: string, requestId: string) { return (await this.pool.query<{ record: RunRecord }>('SELECT record FROM runs WHERE snapshot_id=$1 AND client_request_id=$2', [snapshotId, requestId])).rows[0]?.record; }
  async get(id: string): Promise<RunRecord> {
    const row = (await this.pool.query<{ record: RunRecord }>('SELECT record FROM runs WHERE id=$1', [id])).rows[0];
    if (!row) throw new AppError('RUN_NOT_FOUND', '运行不存在', 404); return row.record;
  }
  async list(snapshotId: string) { return (await this.pool.query<{ record: RunRecord }>('SELECT record FROM runs WHERE snapshot_id=$1 ORDER BY created_at DESC LIMIT 100', [snapshotId])).rows.map(r => r.record); }
  async context(sessionId: string) {
    const run = await this.get(sessionId);
    if(run.sharedTarget?.kind==='test')await requireTestTarget(this.pool,run.sharedTarget.testDeploymentId);
    if (run.status !== 'running' || run.cancelRequested) throw new AppError('RUN_NOT_ACTIVE', '运行已停止或尚未开始', 409);
    const snapshot = await this.snapshots.get(run.snapshotId);
    const operations = (run.runtimeSpec??snapshot.content.runtimeSpec).tools.map(tool => tool.operationId)
      .filter(id => run.sharedTarget?.kind !== 'release-smoke' || id === 'equipment-status');
    return { runId: run.id, environmentId: run.environmentId, actorId: run.actorId, operations };
  }
  async events(id: string, after: number): Promise<RunEvent[]> {
    await this.get(id);
    return (await this.pool.query<RunEvent>('SELECT seq::integer,run_id AS "runId",source,type,data,created_at AS at FROM run_events WHERE run_id=$1 AND seq>$2 ORDER BY seq LIMIT 500', [id, after])).rows;
  }
  private async event(id: string, source: string, key: string, type: string, data: unknown) {
    await this.owned(id,async client=>{await client.query('INSERT INTO run_events(run_id,source,source_key,type,data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,source,key,type,JSON.stringify(data)]);});
  }
  private async owned<T>(id:string,body:(client:PoolClient,record:RunRecord)=>Promise<T>):Promise<T>{
    if(!this.claim||this.claim.runId!==id||this.claimLost)throw new AppError('RUN_CLAIM_LOST','运行 worker 租约已失效',409);
    const client=await this.pool.connect();try{await client.query('BEGIN');const record=await assertRunClaim(client,this.claim);const result=await body(client,record);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  private async effect<T>(id:string,body:()=>Promise<T>):Promise<T>{
    await this.owned(id,async()=>{});const result=await body();await this.owned(id,async()=>{});return result;
  }
  private async patch(id: string, values: Partial<RunRecord>) {
    const next = { ...values, updatedAt: new Date().toISOString() };
    // A worker progress update must not overwrite a cancellation accepted by the API.
    await this.owned(id,async client=>{await client.query("UPDATE runs SET record=record || $2::jsonb || CASE WHEN record->>'cancelRequested'='true' AND $2::jsonb->>'status' IN ('queued','running','waiting_confirmation') THEN '{\"status\":\"cancelling\"}'::jsonb ELSE '{}'::jsonb END WHERE id=$1", [id, next]);});
  }
  private async finish(id: string, status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted', values: Partial<RunRecord>, data: unknown) {
    await this.owned(id,async(client,current)=>{
      const finalStatus=current.cancelRequested&&status!=='interrupted'?'cancelled':status;
      const settled=finalStatus==='cancelled'?{...values,result:current.result??values.result}:values;
      await client.query('UPDATE runs SET record=record || $2::jsonb WHERE id=$1', [id, { ...settled, status:finalStatus, updatedAt: new Date().toISOString() }]);
      await client.query("INSERT INTO run_events(run_id,source,source_key,type,data) VALUES ($1,'platform','terminal',$2,$3) ON CONFLICT DO NOTHING", [id, `run.${finalStatus}`, JSON.stringify(data)]);
    });
  }
  async cancel(id: string, claim?: ValidationClaim) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); if (claim) await assertValidationClaim(client, claim, id, true);
      await this.cancelWithin(client,id);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return this.get(id);
  }
  async cancelWithin(client:PoolClient,id:string){
    const current=(await client.query<{record:RunRecord}>('SELECT record FROM runs WHERE id=$1 FOR UPDATE',[id])).rows[0]?.record;
    if(!current)throw new AppError('RUN_NOT_FOUND','运行不存在',404);
    if(!terminal.has(current.status)){
      await client.query('UPDATE runs SET record=record || $2::jsonb WHERE id=$1',[id,{cancelRequested:true,status:'cancelling',updatedAt:new Date().toISOString()}]);
      await client.query("INSERT INTO run_events(run_id,source,source_key,type,data) VALUES ($1,'platform','cancel-requested','run.cancel_requested','{}') ON CONFLICT DO NOTHING",[id]);
    }
  }
  async tick() {
    if (this.working) return; this.working = true;
    let run: RunRecord | undefined;let timer:ReturnType<typeof setInterval>|undefined;let renewing:Promise<void>|undefined;
    try {
      const claimed = await this.pool.query<{record:RunRecord;token:string}>(`UPDATE runs SET lease_owner=$1,lease_until=clock_timestamp()+$2*interval '1 millisecond',worker_fencing_token=worker_fencing_token+1 WHERE id=(
        SELECT id FROM runs WHERE record->>'status' IN ('queued','running','waiting_confirmation','reconciling','cancelling') AND (lease_until IS NULL OR lease_until<clock_timestamp())
        ORDER BY COALESCE(record->>'updatedAt',''),created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING record,worker_fencing_token::text AS token`, [this.workerId,this.workerOptions.leaseMs]);
      run = claimed.rows[0]?.record; if (!run) return;
      this.claim={runId:run.id,owner:this.workerId,token:claimed.rows[0]!.token};this.claimLost=false;
      const claim=this.claim;
      timer=setInterval(()=>{
        if(renewing||this.claimLost)return;
        renewing=this.pool.query(`UPDATE runs SET lease_until=clock_timestamp()+$4*interval '1 millisecond' WHERE id=$1 AND lease_owner=$2 AND worker_fencing_token=$3
          AND lease_until>clock_timestamp() AND record->>'status' NOT IN ('succeeded','failed','cancelled','interrupted')`,[claim.runId,claim.owner,claim.token,this.workerOptions.leaseMs])
          .then(result=>{if(!result.rowCount)this.claimLost=true;}).catch(()=>{this.claimLost=true;}).finally(()=>{renewing=undefined;});
      },this.workerOptions.heartbeatMs);timer.unref();
      await this.advance(run);
    } catch(error) {
      if(error instanceof AppError&&error.code==='RUN_CLAIM_LOST')return;
      if (run) {
        try{
          const failures=run.dependencyFailures+1;
          // Dependency loss is not evidence that the remote execution stopped.
          await this.patch(run.id,{dependencyFailures:failures,diagnostic:'DEPENDENCY_UNAVAILABLE',...(failures>=20?{status:'reconciling' as const}:{})});
          await this.event(run.id,'platform',`dependency-${failures}`,'dependency.unavailable',{attempt:failures});
        }catch(failure){if(!(failure instanceof AppError&&failure.code==='RUN_CLAIM_LOST'))throw failure;}
      }
    } finally {
      if(timer)clearInterval(timer);await renewing;
      try{if(this.claim)await this.pool.query('UPDATE runs SET lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND worker_fencing_token=$3',[this.claim.runId,this.claim.owner,this.claim.token]);}
      finally{this.claim=undefined;this.working=false;}
    }
  }
  private async advance(run: RunRecord) {
    if(run.sharedTarget?.kind==='test'&&!run.cancelRequested){
      try{await requireTestTarget(this.pool,run.sharedTarget.testDeploymentId);}
      catch(error){
        if(!(error instanceof AppError)||!['TEST_DEPLOYMENT_NOT_READY','TEST_DEPLOYMENT_EXPIRED'].includes(error.code))throw error;
        await this.cancel(run.id);run=await this.get(run.id);
      }
    }
    const token=this.claim!.token;
    await this.effect(run.id,()=>this.runtime.claim(run.id,token));
    await this.actions.expireDue(run.id,this.claim); run = await this.get(run.id);
    let execution = run.started ? await this.effect(run.id,()=>this.runtime.execution(run.id)) : null;
    if (run.cancelRequested && !execution) {
      await this.cancelUnstarted(run,token);return;
    }
    if (!execution) {
      if (run.modelProfile && (await this.runtime.capabilities()).modelProfile?.digest !== run.modelProfile.digest) {
        await this.finish(run.id, 'interrupted', { diagnostic: 'MODEL_PROFILE_CHANGED' }, { reason: 'MODEL_PROFILE_CHANGED' }); return;
      }
      await this.effect(run.id,()=>this.mock.prepare(run.environmentId, run.id, run.environmentConfig));
      if((await this.get(run.id)).cancelRequested){await this.cancelUnstarted(run,token);return;}
      // Persist intent before starting the JVM; recovery reuses the same deployment/execution IDs.
      await this.patch(run.id, { started: true }); run.started = true;
      const snapshot = await this.snapshots.get(run.snapshotId);
      const deployment = await this.effect(run.id,()=>this.runtime.deploy(run.deploymentId, run.artifactDigest, run.runtimeSpec??snapshot.content.runtimeSpec));
      if (deployment.status !== 'ready') {
        await this.finish(run.id, 'interrupted', { diagnostic: 'DEPLOYMENT_NOT_READY' }, { deploymentStatus: deployment.status }); return;
      }
      const latest = await this.get(run.id);
      if (latest.cancelRequested) {
        await this.cancelUnstarted(run,token);return;
      }
      await this.patch(run.id, { status: 'running' }); await this.event(run.id, 'platform', 'started', 'run.running', { deploymentId: run.deploymentId });
      execution = await this.effect(run.id,()=>this.runtime.begin(run.id, { deploymentId: run.deploymentId, sessionId: run.id, message: run.input },token));
    }
    if ((await this.get(run.id)).cancelRequested && !terminal.has(execution.status)) execution = await this.effect(run.id,()=>this.runtime.cancel(run.id,token));
    const events = await this.effect(run.id,()=>this.runtime.events(run.deploymentId));
    for (let i = 0; i < events.length; i++) {
      const session = (events[i] as { event?: { sessionId?: string } } | null)?.event?.sessionId;
      if (session === run.id || !session && !run.sharedTarget) await this.event(run.id, 'runtime', String(i), 'runtime.event', events[i]);
    }
    const unsettled = (await this.actions.list(run.id)).filter(action => ['executing','unknown'].includes(action.status));
    if(run.diagnostic==='DEPENDENCY_UNAVAILABLE'&&!unsettled.length&&['running','waiting_confirmation'].includes(execution.status))
      await this.patch(run.id,{status:'running',diagnostic:'',dependencyFailures:0});
    if (unsettled.length && execution.status !== 'running') {
      await this.patch(run.id, { status: 'reconciling', diagnostic: 'ACTION_RESULT_UNKNOWN' });
      for (const action of unsettled) {
        if (!this.writes) return;
        try { await this.writes.invoke(action.runId, action.actorId, action.toolCallId, action.operation, action.args); }
        catch (error) { if (error instanceof AppError && error.code === 'ACTION_RESULT_UNKNOWN') return; throw error; }
      }
      await this.patch(run.id, { status: 'running', diagnostic: '' });
    }
    if (execution.status === 'waiting_confirmation') {
      const pending = (execution.result as { result?: { _interrupt?: { toolCallId?: unknown; toolName?: unknown; payload?: { value?: { tool_args?: unknown } } } } } | undefined)?.result?._interrupt;
      const spec = (await this.snapshots.get(run.snapshotId)).content.runtimeSpec;
      const tool = spec.tools.find(tool => tool.name === pending?.toolName);
      if (!pending || typeof pending.toolCallId !== 'string' || !tool || !this.runtime.resume) throw new AppError('INVALID_RUNTIME_INTERRUPT', '运行时中断格式不受支持', 409);
      const rawArgs = pending.payload?.value?.tool_args;
      const args: unknown = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      const action = await this.actions.prepare(run.id, pending.toolCallId, tool.operationId, args,300000,this.claim);
      const publicOutput = events.map(item => (item as { event?: { sessionId?: string; event?: string; content?: string } }).event).filter(event => event?.event === 'assistant_output' && event.sessionId === run.id).at(-1)?.content;
      const original = execution.result as { result: Record<string, unknown> };
      await this.patch(run.id, { result: { ...original, result: { ...original.result, ...(publicOutput ? { content: publicOutput } : {}) } }, externalEvidence: await this.mock.calls(run.environmentId, run.id), dependencyFailures: 0 });
      if (action.status === 'approved') execution = await this.effect(run.id,()=>this.runtime.resume!(run.id, action.id, action.toolCallId, true,token));
      else if (['rejected','expired'].includes(action.status) || (await this.get(run.id)).cancelRequested) execution = await this.effect(run.id,()=>this.runtime.cancel(run.id,token));
    }
    if (!terminal.has(execution.status)) { await this.patch(run.id, { dependencyFailures: 0 }); return; }
    if (execution.status === 'interrupted') {
      await this.finish(run.id, 'interrupted', { diagnostic: execution.error ?? 'EXECUTION_INTERRUPTED' }, { reason: execution.error ?? 'EXECUTION_INTERRUPTED' }); return;
    }
    const externalEvidence = await this.effect(run.id,()=>this.mock.calls(run.environmentId, run.id));
    if (!run.sharedTarget) {
      const stop = await this.effect(run.id,()=>this.runtime.retire(run.deploymentId));
      if (!['stopped', 'failed'].includes(stop.status)) throw new Error('STOP_UNCONFIRMED');
    }
    await this.effect(run.id,()=>this.mock.release(run.environmentId, run.id));
    const status = execution.status as 'succeeded' | 'failed' | 'cancelled';
    const result = status === 'cancelled' ? (await this.get(run.id)).result ?? execution.result : execution.result;
    const iterationLimitReported=events.some(item=>{
      const event=(item as {event?:{event?:string;sessionId?:string}}|null)?.event;
      return event?.event==='iteration_limit_reached'&&event.sessionId===run.id;
    });
    const diagnostic=status==='failed'&&execution.error==='JVM_QUERY_FAILED'&&iterationLimitReported?'ITERATION_LIMIT_REACHED':execution.error??'';
    await this.finish(run.id, status, { result: result ?? null, externalEvidence, dependencyFailures: 0, diagnostic },
      { externalCallCount: externalEvidence.length, ...(diagnostic!==execution.error?{runtimeError:execution.error}:{}) });
  }
  private async cancelUnstarted(run:RunRecord,token:string){
    const execution=await this.effect(run.id,()=>this.runtime.cancel(run.id,token));
    if(execution.status!=='cancelled')return;
    if(!run.sharedTarget){const retired=await this.effect(run.id,()=>this.runtime.retire(run.deploymentId));if(retired.status!=='stopped')throw new Error('STOP_UNCONFIRMED');}
    await this.effect(run.id,()=>this.mock.release(run.environmentId,run.id));
    await this.finish(run.id,'cancelled',{}, {executionRetired:true,processStarted:run.started});
  }
}
