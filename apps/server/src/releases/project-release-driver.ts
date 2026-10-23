import type {Pool} from 'pg';
import type {ReleaseDriver} from './release-service.js';
import type {ReleaseOperation} from '../../../../packages/contracts/src/releases.js';
import {assertReleaseClaim,type ReleaseClaim} from '../shared/release-claim.js';
import type {SnapshotService} from '../snapshots/application/snapshot-service.js';
import type {BaselineService} from '../acceptance/application/baseline-service.js';
import type {RunService, RunRuntime} from '../runs/run-service.js';
import type {HttpMock, HttpRunner} from '../runs/http-ports.js';
import type {PostgresActions} from '../actions/postgres-actions.js';
import {AppError} from '../shared/errors.js';
import {contentDigest} from '../snapshots/domain/assembly.js';
import {evaluateProjectCase} from '../acceptance/application/case-assertions.js';
export type ReleaseRuntime = RunRuntime & Pick<HttpRunner,'deployment'|'retire'>;
export class ProjectReleaseDriver implements ReleaseDriver {
  constructor(private readonly pool:Pool,private readonly snapshots:Pick<SnapshotService,'get'>,
    private readonly baselines:Pick<BaselineService,'assertTarget'>,private readonly reports:{report(id:string):Promise<{baselineId:string}>},
    private readonly runs:RunService,private readonly runtime:ReleaseRuntime,private readonly mock:Pick<HttpMock,'prepare'|'release'|'calls'|'inspect'>,
    private readonly actions:Pick<PostgresActions,'list'>) {}
  private async own(operation:ReleaseOperation,claim:ReleaseClaim) {
    const client=await this.pool.connect();
    try {await client.query('BEGIN');await assertReleaseClaim(client,claim,operation.smokeRunId);await client.query('COMMIT');}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  private async loaded(operation:ReleaseOperation) {
    const snapshot=await this.snapshots.get(operation.reference.snapshotId);const actual=await this.runtime.deployment(operation.deploymentId);
    const runtimeSpec=operation.reference.runtimeSpec??snapshot.content.runtimeSpec;
    if(actual.status!=='ready'||snapshot.digest!==operation.reference.binding.snapshotDigest||actual.artifactDigest!==operation.reference.binding.artifactDigest
      ||actual.specDigest!==contentDigest(runtimeSpec)||(operation.reference.binding.candidate?.specDigest??contentDigest(runtimeSpec))!==actual.specDigest||actual.modelProfile?.digest!==operation.reference.binding.modelProfile.digest)
      throw new AppError('DEPLOYMENT_MANIFEST_MISMATCH','部署未就绪或实际装载摘要与验证目标不一致',409);
    return {snapshot,actual};
  }
  async prepare(operation:ReleaseOperation,claim:ReleaseClaim):ReturnType<ReleaseDriver['prepare']>{
    await this.own(operation,claim);const snapshot=await this.snapshots.get(operation.reference.snapshotId);
    await this.runtime.deploy(operation.deploymentId,operation.reference.binding.artifactDigest,operation.reference.runtimeSpec??snapshot.content.runtimeSpec);
    const {actual}=await this.loaded(operation);await this.own(operation,claim);
    await this.mock.prepare(operation.environmentId,operation.smokeRunId);
    return {ready:true,artifactDigest:actual.artifactDigest,snapshotDigest:snapshot.digest};
  }
  async smoke(operation:ReleaseOperation,claim:ReleaseClaim):ReturnType<ReleaseDriver['smoke']>{
    await this.own(operation,claim);const {snapshot,actual}=await this.loaded(operation);
    const report=await this.reports.report(operation.reference.validationId);const baseline=await this.baselines.assertTarget(report.baselineId,snapshot);
    const smokeTarget=baseline.content.cases.map(item=>({item,operation:item.scenario==='equipment-normal'?'equipment-status':item.scenario==='balance-normal'?'getAccountBalance':undefined}))
      .find(target=>target.operation);
    if(!smokeTarget)throw new AppError('SMOKE_SCENARIO_UNAVAILABLE','该基线没有已实现的只读冒烟场景',409);
    const {item,operation:expectedOperation}=smokeTarget;
    const run=await this.runs.createShared(snapshot.id,{clientRequestId:operation.smokeRunId,input:item.input},{runId:operation.smokeRunId,
      environmentId:operation.environmentId,deploymentId:operation.deploymentId,artifactDigest:operation.reference.binding.artifactDigest,
      modelDigest:operation.reference.binding.modelProfile.digest,runtimeSpec:operation.reference.runtimeSpec??snapshot.content.runtimeSpec,actorId:'U1001',target:{kind:'release-smoke',claim}});
    if(run.status==='waiting_confirmation'||Date.now()-Date.parse(run.createdAt)>180000)
      return {status:'failed',evidence:{runId:run.id,reason:run.status==='waiting_confirmation'?'SMOKE_REQUESTED_CONFIRMATION':'SMOKE_TIMEOUT'}};
    if(!['succeeded','failed','cancelled','interrupted'].includes(run.status))return{status:'pending'};
    const [environment,calls,actions]=await Promise.all([this.mock.inspect(run.environmentId),this.mock.calls(run.environmentId,run.id),this.actions.list(run.id)]);
    const events=[];let after=0;
    for(let page=0;;page++){if(page===20)throw new Error('EVIDENCE_LIMIT_REACHED');const part=await this.runs.events(run.id,after);events.push(...part);if(part.length<500)break;after=part.at(-1)!.seq;}
    const expectedConfig={seed:'enterprise-default@1',fault:'normal',clock:'2026-10-21T08:00:00.000Z'};
    const observation={run,calls:calls as Record<string,unknown>[],actions,attempts:[],events,businessState:environment.state,
      complete:environment.id===run.environmentId&&contentDigest(environment.config)===contentDigest(expectedConfig)};
    const result=evaluateProjectCase(item,observation);
    const readOnly=calls.length===1&&calls.every(call=>(call as {operation?:string}).operation===expectedOperation)&&actions.length===0;
    await this.own(operation,claim);
    return {status:result.status==='passed'&&readOnly?'passed':'failed',evidence:{case:result,readOnly,observation,loaded:actual}};
  }
  async stop(operation:ReleaseOperation):Promise<void>{
    // Cleanup is allowed only after an immutable failed operation was committed.
    const row=(await this.pool.query<{record:ReleaseOperation}>('SELECT record FROM release_operations WHERE id=$1',[operation.id])).rows[0]?.record;
    if(!row||row.status!=='failed'||row.deploymentId!==operation.deploymentId)throw new AppError('RELEASE_CLEANUP_REJECTED','不能清理尚未失败的发布目标',409);
    try {
      const run=await this.runs.get(operation.smokeRunId);
      if(!['succeeded','failed','cancelled','interrupted'].includes(run.status)){
        await this.runs.cancel(run.id);throw new AppError('RELEASE_CLEANUP_PENDING','等待冒烟运行停止',409);
      }
    } catch(error){if(!(error instanceof AppError&&error.code==='RUN_NOT_FOUND'))throw error;}
    const stopped=await this.runtime.retire(operation.deploymentId);
    if(stopped.status!=='stopped')throw new AppError('STOP_UNCONFIRMED','尚未确认部署停止',409);
    await this.mock.release(operation.environmentId,operation.smokeRunId);
  }
}
