import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {CandidateService} from './candidate-service.js';
import type {BaselineService} from '../acceptance/application/baseline-service.js';
import type {SnapshotService} from '../snapshots/application/snapshot-service.js';
import type {RunService,RunRuntime,MockControl} from '../runs/run-service.js';
import type {PublishedRuntime} from '../invocations/invocation-service.js';
import type {TestDeployment,TestDeploymentInput} from '../../../../packages/contracts/src/candidates.js';
import type {Invocation} from '../../../../packages/contracts/src/invocations.js';
import {validationBinding} from '../acceptance/application/validation-binding.js';
import {contentDigest} from '../snapshots/domain/assembly.js';
import {AppError} from '../shared/errors.js';
import {runtimeArtifactMatches} from '../runs/artifact-binding.js';
import {assertValidationClaim,assertTestAuthority,type ValidationTestAuthority} from '../shared/validation-claim.js';
export async function requireTestTarget(db:Pool|PoolClient,id:string,lock=false):Promise<TestDeployment>{
  const row=(await db.query<{record:TestDeployment;unexpired:boolean}>(`SELECT record,(record->>'expiresAt')::timestamptz>clock_timestamp() AS unexpired FROM test_deployments WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];
  if(!row)throw new AppError('TEST_DEPLOYMENT_NOT_FOUND','测试部署不存在',404);
  if(row.record.status!=='ready')throw new AppError('TEST_DEPLOYMENT_NOT_READY','测试部署未就绪或已停止',409);
  if(!row.unexpired)throw new AppError('TEST_DEPLOYMENT_EXPIRED','测试部署已过期',410);
  return row.record;
}
export class TestDeploymentService {
  private readonly owner=randomUUID();private working=false;
  constructor(private readonly pool:Pool,private readonly candidates:CandidateService,private readonly baselines:BaselineService,
    private readonly snapshots:SnapshotService,private readonly runs:RunService,private readonly runtime:RunRuntime&PublishedRuntime,
    private readonly mock:MockControl&{identity():Promise<{implementationDigest:string}>}){}
  private async tx<T>(body:(client:PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();try{await client.query('BEGIN');const result=await body(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async create(input:TestDeploymentInput,authority?:ValidationTestAuthority):Promise<TestDeployment>{
    const digest=contentDigest(authority?{input,validationId:authority.executionId,runId:authority.runId}:input);
    const existing=(await this.pool.query<{record:TestDeployment}>('SELECT record FROM test_deployments WHERE client_request_id=$1',[input.clientRequestId])).rows[0]?.record;
    if(existing){await this.tx(async client=>{await assertTestAuthority(client,existing,authority);});if(existing.inputDigest!==digest)throw new AppError('REQUEST_INPUT_CONFLICT','同一请求编号不能更改测试目标',409);return existing;}
    if(!Number.isInteger(input.ttlSeconds)||input.ttlSeconds<1||input.ttlSeconds>3600||!['test','preview'].includes(input.purpose))throw new AppError('INVALID_TEST_DEPLOYMENT','测试部署配置无效',422);
    const candidate=await this.candidates.get(input.candidateId);const snapshot=await this.snapshots.get(candidate.snapshotId);
    const baseline=await this.baselines.assertTarget(input.requirementBaselineId,snapshot);
    if(contentDigest(baseline.content.cases)!==input.suiteDigest)throw new AppError('TEST_SUITE_MISMATCH','测试集与确认的基线不匹配',409);
    const [runtime,mock]=await Promise.all([this.runtime.capabilities(),this.mock.identity()]);
    if(!runtime.modelProfile||!runtime.modelConfigured||runtime.executionMode!=='trusted-local'||!await runtimeArtifactMatches(this.runtime,candidate.artifactDigest,runtime.artifactDigest,candidate.specDigest,candidate.snapshotId,candidate.generated?.runtimeArtifact))throw new AppError('CANDIDATE_RUNTIME_CHANGED','候选制品或模型环境不可执行',409);
    if(candidate.generated&&(candidate.generated.baselineId!==baseline.id||candidate.generated.baselineDigest!==baseline.digest))throw new AppError('CANDIDATE_BASELINE_MISMATCH','生成候选必须使用构建时确认的验收基线',409);
    const binding=validationBinding(snapshot,baseline,{artifactDigest:candidate.artifactDigest,mockDigest:mock.implementationDigest,modelProfile:runtime.modelProfile});
    return this.tx(async client=>{
      const validation=authority?await assertValidationClaim(client,authority,authority.runId):undefined;
      const item=validation?baseline.content.cases.find(c=>c.id===validation.cases.find(p=>p.runId===authority!.runId)?.caseId):undefined;
      if(validation&&(!item||validation.binding.candidate?.id!==candidate.id||validation.binding.candidate.bundleDigest!==candidate.bundleDigest
        ||validation.snapshotId!==candidate.snapshotId||validation.baselineId!==baseline.id||input.clientRequestId!==authority!.runId||input.purpose!=='test'
        ||contentDigest({...binding,candidate:validation.binding.candidate})!==contentDigest(validation.binding)))throw new AppError('VALIDATION_CASE_MISMATCH','测试部署与验收用例不匹配',409);
      await client.query('SELECT pg_advisory_xact_lock(183421059)');
      const old=(await client.query<{record:TestDeployment}>('SELECT record FROM test_deployments WHERE client_request_id=$1',[input.clientRequestId])).rows[0]?.record;
      if(old){if(old.inputDigest!==digest)throw new AppError('REQUEST_INPUT_CONFLICT','同一请求编号不能更改测试目标',409);return old;}
      const active=(await client.query<{count:number}>("SELECT count(*)::integer FROM test_deployments WHERE record->>'status' IN ('preparing','ready','stopping')")).rows[0]!.count;
      if(active>=4)throw new AppError('TEST_DEPLOYMENT_LIMIT','活动测试部署已达上限 4',429);
      const now=new Date().toISOString();
      const record:TestDeployment={id:randomUUID(),clientRequestId:input.clientRequestId,inputDigest:digest,agentId:candidate.agentId,candidateId:candidate.id,
        snapshotId:candidate.snapshotId,deploymentId:randomUUID(),environmentId:randomUUID(),environmentConfig:{seed:baseline.content.seed,fault:item?.fault??'normal',clock:'2026-10-21T08:00:00.000Z'},
        ...(validation&&item?{validation:{executionId:validation.id,caseId:item.id,runId:authority!.runId,input:item.input,actorId:'U1001' as const}}:{}),
        requirementBaselineId:baseline.id,purpose:input.purpose,binding:validation?.binding??binding,status:'preparing',failure:false,createdAt:now,updatedAt:now,expiresAt:new Date(Date.parse(now)+input.ttlSeconds*1000).toISOString()};
      await client.query('INSERT INTO test_deployments(id,candidate_id,baseline_id,client_request_id,record) VALUES($1,$2,$3,$4,$5)',[record.id,candidate.id,baseline.id,input.clientRequestId,record]);return record;
    });
  }
  async get(id:string):Promise<TestDeployment>{
    const record=(await this.pool.query<{record:TestDeployment}>('SELECT record FROM test_deployments WHERE id=$1',[id])).rows[0]?.record;
    if(!record)throw new AppError('TEST_DEPLOYMENT_NOT_FOUND','测试部署不存在',404);return record;
  }
  async identity(id:string,actorId:'U1001'|'U1002',authority?:ValidationTestAuthority){
    if(!['U1001','U1002'].includes(actorId))throw new AppError('INVALID_DEMO_IDENTITY','模拟身份无效',400);
    const target=await requireTestTarget(this.pool,id);await this.tx(async client=>{await assertTestAuthority(client,target,authority);});
    if(target.validation&&actorId!==target.validation.actorId)throw new AppError('VALIDATION_CASE_MISMATCH','模拟身份与验收用例不匹配',409);
    return{testDeploymentId:id,agentId:target.agentId,environmentId:target.environmentId,actorId};
  }
  async list(candidateId:string){return(await this.pool.query<{record:TestDeployment}>("SELECT record FROM test_deployments WHERE candidate_id=$1 ORDER BY record->>'createdAt' DESC LIMIT 100",[candidateId])).rows.map(row=>row.record);}
  async requestIdentity(id:string,requestId:string){
    const record=(await this.pool.query<{record:Invocation}>('SELECT record FROM invocations WHERE id=$1 AND test_deployment_id=$2',[requestId,id])).rows[0]?.record;
    if(!record)throw new AppError('REQUEST_NOT_FOUND','此测试部署没有该请求',404);
    return{testDeploymentId:id,agentId:record.agentId,environmentId:record.environmentId,actorId:record.actorId};
  }
  private async cancelRequests(client:PoolClient,id:string){
    const requests=(await client.query<{record:Invocation}>('SELECT record FROM invocations WHERE test_deployment_id=$1 ORDER BY id FOR UPDATE',[id])).rows.map(row=>row.record);
    for(const request of requests){
      if(request.status==='admitted')await this.runs.cancelWithin(client,request.runId);
      else if(request.status!=='cancelled')await client.query("UPDATE invocations SET record=record || $2::jsonb WHERE id=$1",[request.id,{status:'cancelled',updatedAt:new Date().toISOString()}]);
    }
  }
  async stop(id:string,authority?:ValidationTestAuthority):Promise<TestDeployment>{
    await this.tx(async client=>{
      // An authenticated operator may stop any deployment. Automated cleanup is fenced.
      if(authority)await assertTestAuthority(client,await this.get(id),authority,true);
      const record=(await client.query<{record:TestDeployment}>('SELECT record FROM test_deployments WHERE id=$1 FOR UPDATE',[id])).rows[0]?.record;
      if(!record)throw new AppError('TEST_DEPLOYMENT_NOT_FOUND','测试部署不存在',404);
      if(['stopped','failed'].includes(record.status))return;
      await client.query("UPDATE test_deployments SET record=record || $2::jsonb,lease_owner=NULL,lease_until=NULL,next_poll_at=now() WHERE id=$1",[id,{status:'stopping',updatedAt:new Date().toISOString()}]);
      await this.cancelRequests(client,id);
    });return this.get(id);
  }
  async findValidation(runId:string){return(await this.pool.query<{record:TestDeployment}>("SELECT record FROM test_deployments WHERE client_request_id=$1::uuid AND record->'validation'->>'runId'=$1::text",[runId])).rows[0]?.record??null;}
  private async update(id:string,expected:string,patch:Partial<TestDeployment>){
    await this.pool.query(`UPDATE test_deployments SET record=record || $4::jsonb WHERE id=$1 AND lease_owner=$2 AND lease_until>clock_timestamp() AND record->>'status'=$3`,
      [id,this.owner,expected,{...patch,updatedAt:new Date().toISOString()}]);
  }
  async tick():Promise<void>{
    if(this.working)return;this.working=true;let target:TestDeployment|undefined;
    try{
      const claimed=(await this.pool.query<{record:TestDeployment;expired:boolean}>(`UPDATE test_deployments SET lease_owner=$1,lease_until=clock_timestamp()+interval '180 seconds' WHERE id=(
        SELECT id FROM test_deployments WHERE (record->>'status' IN ('preparing','stopping') OR record->>'status'='ready' AND (record->>'expiresAt')::timestamptz<=clock_timestamp())
        AND next_poll_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY next_poll_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING record,(record->>'expiresAt')::timestamptz<=clock_timestamp() AS expired`,[this.owner])).rows[0];
      target=claimed?.record;
      if(!target)return;
      if(claimed!.expired&&target.status!=='stopping'){await this.stop(target.id);return;}
      if(target.status==='preparing'){
        const candidate=await this.candidates.get(target.candidateId);const snapshot=await this.snapshots.get(target.snapshotId);
        const [capabilities,mock]=await Promise.all([this.runtime.capabilities(),this.mock.identity()]);
        if(!await runtimeArtifactMatches(this.runtime,candidate.artifactDigest,capabilities.artifactDigest,candidate.specDigest,candidate.snapshotId,candidate.generated?.runtimeArtifact)||capabilities.modelProfile?.digest!==target.binding.modelProfile.digest||mock.implementationDigest!==target.binding.mockDigest)
          throw new AppError('TEST_BINDING_CHANGED','测试依赖已变化',409);
        await this.mock.prepare(target.environmentId,target.id,target.environmentConfig);
        const deployed=await this.runtime.deploy(target.deploymentId,candidate.artifactDigest,snapshot.content.runtimeSpec);
        const loaded=await this.runtime.deployment(target.deploymentId);
        if(deployed.status!=='ready'||loaded.status!=='ready'||loaded.artifactDigest!==candidate.artifactDigest||loaded.specDigest!==candidate.specDigest||loaded.modelProfile?.digest!==target.binding.modelProfile.digest)
          throw new AppError('TEST_MANIFEST_MISMATCH','测试部署实际装载不匹配',409);
        await this.update(target.id,'preparing',{status:'ready'});
      }else if(target.status==='stopping'){
        await this.tx(async client=>{await client.query('SELECT id FROM test_deployments WHERE id=$1 FOR UPDATE',[target!.id]);await this.cancelRequests(client,target!.id);});
        const active=await this.pool.query(`SELECT r.id FROM runs r JOIN invocations i ON i.run_id=r.id WHERE i.test_deployment_id=$1 AND r.record->>'status' NOT IN ('succeeded','failed','cancelled','interrupted') LIMIT 1`,[target.id]);
        if(active.rowCount)return;
        const stopped=await this.runtime.retire(target.deploymentId);if(stopped.status!=='stopped')throw new Error('STOP_UNCONFIRMED');
        await this.mock.release(target.environmentId,target.id);
        await this.update(target.id,'stopping',{status:target.failure?'failed':'stopped'});
      }
    }catch(error){
      if(target?.status==='preparing')await this.update(target.id,'preparing',{status:'stopping',failure:true,diagnostic:error instanceof AppError?error.code:'TEST_PREPARATION_FAILED'});
      else if(target?.status==='stopping')await this.update(target.id,'stopping',{diagnostic:'TEST_STOP_UNCONFIRMED'});
    }finally{
      if(target)await this.pool.query("UPDATE test_deployments SET lease_owner=NULL,lease_until=NULL,next_poll_at=clock_timestamp() WHERE id=$1 AND lease_owner=$2",[target.id,this.owner]);
      this.working=false;
    }
  }
}
