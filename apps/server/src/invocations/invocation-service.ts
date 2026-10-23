import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { RuntimeSpec } from '../../../../packages/contracts/src/index.js';
import type { SnapshotService } from '../snapshots/application/snapshot-service.js';
import type { RunService } from '../runs/run-service.js';
import type { PostgresActions } from '../actions/postgres-actions.js';
import type { DemoIdentity, InvocationIdentity, MessageInput, InvocationView, Invocation, Conversation } from '../../../../packages/contracts/src/invocations.js';
import type { RuntimeModelProfile } from '../../../../packages/contracts/src/model-profile.js';
import type { ReleasePointer, ReleaseVersion } from '../../../../packages/contracts/src/releases.js';
import type { ActionDecision } from '../../../../packages/contracts/src/actions.js';
import type { RunRecord } from '../../../../packages/contracts/src/runs.js';
import { contentDigest } from '../snapshots/domain/assembly.js';
import { AppError } from '../shared/errors.js';
import {requireTestTarget} from '../candidates/test-deployment-service.js';
import {assertTestAuthority,type ValidationTestAuthority} from '../shared/validation-claim.js';
import type {TestDeployment} from '../../../../packages/contracts/src/candidates.js';
export interface PublishedRuntime {
  deployment(id: string): Promise<{status:string;artifactDigest:string;specDigest:string;error?:string;modelProfile?:RuntimeModelProfile|null}>;
  deploy?(id:string,artifactDigest:string,spec:RuntimeSpec):Promise<{status:string}>;
}
export class InvocationService {
  private working=false;
  constructor(private readonly pool: Pool, private readonly snapshots: SnapshotService, private readonly runs: RunService, private readonly runtime: PublishedRuntime, private readonly actions: PostgresActions,
    private readonly mock:{identity():Promise<{implementationDigest:string}>}) {}
  private async tx<T>(body:(client:PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();try{await client.query('BEGIN');const value=await body(client);await client.query('COMMIT');return value;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async identity(agentId:string,actorId:DemoIdentity['actorId']):Promise<DemoIdentity>{
    if(!['U1001','U1002'].includes(actorId))throw new AppError('INVALID_DEMO_IDENTITY','模拟身份无效',400);
    const pointer=(await this.pool.query<{record:ReleasePointer}>('SELECT record FROM release_pointers WHERE agent_id=$1',[agentId])).rows[0]?.record;
    if(!pointer?.versionId)throw new AppError('AGENT_NOT_PUBLISHED','此 Agent 尚未发布',409);
    return{agentId,actorId,environmentId:pointer.environmentId};
  }
  private async owned(identity:InvocationIdentity,id:string,client:Pool|PoolClient=this.pool,lock=false):Promise<Invocation>{
    const record=(await client.query<{record:Invocation}>(`SELECT record FROM invocations WHERE id=$1 AND agent_id=$2 AND actor_id=$3 AND environment_id=$4 AND test_deployment_id IS NOT DISTINCT FROM $5::uuid${lock?' FOR UPDATE':''}`,[id,identity.agentId,identity.actorId,identity.environmentId,identity.testDeploymentId??null])).rows[0]?.record;
    if(!record)throw new AppError('REQUEST_NOT_FOUND','业务请求不存在或不属于当前模拟身份',404);return record;
  }
  private async authority(client:PoolClient,identity:InvocationIdentity,authority?:ValidationTestAuthority,cancelling=false){
    if(!identity.testDeploymentId)return;
    const target=(await client.query<{record:TestDeployment}>('SELECT record FROM test_deployments WHERE id=$1',[identity.testDeploymentId])).rows[0]?.record;
    if(target)await assertTestAuthority(client,target,authority,cancelling);
  }
  async send(identity:InvocationIdentity,input:MessageInput,authority?:ValidationTestAuthority):Promise<InvocationView>{
    const inputDigest=contentDigest(input);
    const request=await this.tx(async client=>{
      await this.authority(client,identity,authority);
      // A short DB-only admission lock serializes duplicate keys and conversation use. No network I/O under it.
      await client.query('SELECT pg_advisory_xact_lock(183421058)');
      const test=identity.testDeploymentId?await requireTestTarget(client,identity.testDeploymentId,true):undefined;
      if(test&&(test.agentId!==identity.agentId||test.environmentId!==identity.environmentId))throw new AppError('TEST_IDENTITY_MISMATCH','身份与测试部署不匹配',403);
      if(test?.validation&&(input.clientRequestId!==test.validation.runId||input.input!==test.validation.input||input.conversationId||identity.actorId!==test.validation.actorId))throw new AppError('VALIDATION_CASE_MISMATCH','业务输入与固定验收用例不匹配',409);
      const old=(await client.query<{record:Invocation}>('SELECT record FROM invocations WHERE agent_id=$1 AND environment_id=$2 AND actor_id=$3 AND client_request_id=$4 AND test_deployment_id IS NOT DISTINCT FROM $5::uuid',[identity.agentId,identity.environmentId,identity.actorId,input.clientRequestId,identity.testDeploymentId??null])).rows[0]?.record;
      if(old){if(old.inputDigest!==inputDigest)throw new AppError('REQUEST_INPUT_CONFLICT','同一请求编号不能更改输入或会话',409);return old;}
      let conversation:Conversation|undefined;
      if(input.conversationId){
        conversation=(await client.query<{record:Conversation}>('SELECT record FROM conversations WHERE id=$1 AND agent_id=$2 AND actor_id=$3 AND environment_id=$4 AND test_deployment_id IS NOT DISTINCT FROM $5::uuid',[input.conversationId,identity.agentId,identity.actorId,identity.environmentId,identity.testDeploymentId??null])).rows[0]?.record;
        if(!conversation)throw new AppError('CONVERSATION_NOT_FOUND','会话不存在或与当前入口身份不匹配',404);
        const active=await client.query(`SELECT i.id FROM invocations i LEFT JOIN runs r ON r.id=i.run_id WHERE i.conversation_id=$1 AND
          (i.record->>'status' IN ('reserved','blocked') OR i.record->>'status'='admitted' AND r.record->>'status' NOT IN ('succeeded','failed','cancelled','interrupted')) LIMIT 1`,[conversation.id]);
        if(active.rowCount)throw new AppError('CONVERSATION_BUSY','当前会话仍有未结束的请求',409);
      }
      const count=(await client.query<{count:number}>("SELECT count(*)::integer FROM invocations WHERE record->>'status' IN ('reserved','blocked')")).rows[0]!.count;
      if(count>=64)throw new AppError('REQUEST_LIMIT','待启动请求已达上限，请完成或取消已有请求',429);
      const now=new Date().toISOString();
      if(!conversation){
        if(test)conversation={...identity,id:randomUUID(),agentVersion:null,candidateId:test.candidateId,artifactDigest:test.binding.artifactDigest,createdAt:now};
        else{
          const pointer=(await client.query<{record:ReleasePointer}>('SELECT record FROM release_pointers WHERE agent_id=$1',[identity.agentId])).rows[0]?.record;
          if(!pointer?.versionId||pointer.environmentId!==identity.environmentId)throw new AppError('AGENT_NOT_PUBLISHED','当前身份没有可用的发布目标',409);
          conversation={...identity,id:randomUUID(),agentVersion:pointer.versionId,createdAt:now};
        }
        await client.query('INSERT INTO conversations(id,agent_id,actor_id,environment_id,version_id,record,test_deployment_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[conversation.id,identity.agentId,identity.actorId,identity.environmentId,conversation.agentVersion,conversation,identity.testDeploymentId??null]);
      }
      const value:Invocation={...identity,id:randomUUID(),clientRequestId:input.clientRequestId,input:input.input,inputDigest,conversationId:conversation.id,agentVersion:conversation.agentVersion,
        ...(test?{candidateId:test.candidateId,artifactDigest:test.binding.artifactDigest}:{}),runId:test?.validation?.runId??randomUUID(),status:'reserved',createdAt:now,updatedAt:now};
      await client.query('INSERT INTO invocations(id,agent_id,actor_id,environment_id,client_request_id,conversation_id,version_id,run_id,record,test_deployment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[value.id,identity.agentId,identity.actorId,identity.environmentId,input.clientRequestId,conversation.id,value.agentVersion,value.runId,value,identity.testDeploymentId??null]);
      return value;
    });
    return this.get(identity,request.id);
  }
  async get(identity:InvocationIdentity,id:string):Promise<InvocationView>{
    const request=await this.owned(identity,id);
    const run=(await this.pool.query<{record:RunRecord}>('SELECT record FROM runs WHERE id=$1',[request.runId])).rows[0]?.record??null;
    return{requestId:request.id,runId:request.runId,conversationId:request.conversationId,agentVersion:request.agentVersion,
      ...(request.testDeploymentId?{testDeploymentId:request.testDeploymentId,candidateId:request.candidateId,artifactDigest:request.artifactDigest}:{}),request,run,actions:run?await this.actions.list(run.id):[]};
  }
  async cancel(identity:InvocationIdentity,id:string,authority?:ValidationTestAuthority):Promise<InvocationView>{
    await this.tx(async client=>{
      await this.authority(client,identity,authority,true);
      const request=await this.owned(identity,id,client,true);
      if(request.status==='admitted')await this.runs.cancelWithin(client,request.runId);
      else if(request.status!=='cancelled')await client.query("UPDATE invocations SET record=record || $2::jsonb WHERE id=$1",[id,{status:'cancelled',updatedAt:new Date().toISOString()}]);
    });
    return this.get(identity,id);
  }
  async decide(identity:InvocationIdentity,id:string,actionId:string,decision:ActionDecision,authority?:ValidationTestAuthority){
    await this.tx(async client=>{await this.authority(client,identity,authority);});
    const request=await this.owned(identity,id);
    if(request.status!=='admitted')throw new AppError('REQUEST_NOT_RUNNING','业务请求尚未启动',409);
    return this.actions.decide(actionId,request.runId,identity.actorId,decision,authority);
  }
  async events(identity:InvocationIdentity,id:string,after:number){const request=await this.owned(identity,id);return request.status==='admitted'?this.runs.events(request.runId,after):[];}
  async tick(){
    if(this.working)return;this.working=true;let request:Invocation|undefined;
    try{
      request=(await this.pool.query<{record:Invocation}>(`UPDATE invocations SET last_polled_at=clock_timestamp() WHERE id=(SELECT id FROM invocations
        WHERE record->>'status' IN ('reserved','blocked') AND next_attempt_at<=now() ORDER BY last_polled_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING record`)).rows[0]?.record;
      if(!request)return;
      if(request.testDeploymentId){
        const test=await requireTestTarget(this.pool,request.testDeploymentId);
        const [loaded,snapshot,mock]=await Promise.all([this.runtime.deployment(test.deploymentId),this.snapshots.get(test.snapshotId),this.mock.identity()]);
        if(test.agentId!==request.agentId||test.environmentId!==request.environmentId||test.candidateId!==request.candidateId||test.binding.artifactDigest!==request.artifactDigest)
          throw new AppError('TEST_TARGET_MISMATCH','测试目标不匹配',409);
        if(mock.implementationDigest!==test.binding.mockDigest)throw new AppError('TEST_BINDING_CHANGED','测试业务服务已变化',409);
        const runtimeSpec=test.runtimeSpec??snapshot.content.runtimeSpec;
        if(loaded.status!=='ready'||loaded.artifactDigest!==test.binding.artifactDigest||loaded.specDigest!==contentDigest(runtimeSpec)||(test.binding.candidate?.specDigest??contentDigest(runtimeSpec))!==loaded.specDigest||loaded.modelProfile?.digest!==test.binding.modelProfile.digest||snapshot.digest!==test.binding.snapshotDigest)
          throw new AppError('TEST_MANIFEST_MISMATCH','测试部署不可用或实际装载不匹配',409);
        await this.runs.createShared(test.snapshotId,{clientRequestId:request.runId,input:request.input},{runId:request.runId,actorId:request.actorId,environmentId:test.environmentId,deploymentId:test.deploymentId,
          artifactDigest:test.binding.artifactDigest,modelDigest:test.binding.modelProfile.digest,runtimeSpec,invocationId:request.id,conversationId:request.conversationId,target:{kind:'test',testDeploymentId:test.id,candidateId:test.candidateId}});
        return;
      }
      const version=(await this.pool.query<{record:ReleaseVersion}>('SELECT record FROM release_versions WHERE id=$1',[request.agentVersion])).rows[0]?.record;
      if(!version||version.agentId!==request.agentId||version.environmentId!==request.environmentId)throw new AppError('PUBLISHED_TARGET_MISMATCH','发布目标不匹配',409);
      let [loaded,snapshot,mock]=await Promise.all([this.runtime.deployment(version.deploymentId),this.snapshots.get(version.snapshotId),this.mock.identity()]);
      const runtimeSpec=version.reference.runtimeSpec??snapshot.content.runtimeSpec;
      if(mock.implementationDigest!==version.reference.binding.mockDigest)throw new AppError('PUBLISHED_DEPENDENCY_CHANGED','业务服务已变化，请重新验收并发布',409);
      const recoverable=loaded.status==='interrupted'||loaded.status==='failed'&&loaded.error==='DEPLOYMENT_RESTORE_FAILED';
      if(recoverable&&this.runtime.deploy){
        await this.runtime.deploy(version.deploymentId,version.reference.binding.artifactDigest,runtimeSpec);
        loaded=await this.runtime.deployment(version.deploymentId);
      }
      if(loaded.status!=='ready')throw new AppError('DEPLOYMENT_NOT_READY','原版本不可执行，请取消此请求并新建会话',409);
      const binding=version.reference.binding;
      if(loaded.artifactDigest!==binding.artifactDigest||loaded.modelProfile?.digest!==binding.modelProfile.digest||loaded.specDigest!==contentDigest(runtimeSpec)||(binding.candidate?.specDigest??contentDigest(runtimeSpec))!==loaded.specDigest||snapshot.digest!==binding.snapshotDigest)
        throw new AppError('DEPLOYMENT_MANIFEST_MISMATCH','实际部署与发布版本不一致',409);
      await this.runs.createShared(version.snapshotId,{clientRequestId:request.runId,input:request.input},{runId:request.runId,actorId:request.actorId,environmentId:version.environmentId,deploymentId:version.deploymentId,artifactDigest:binding.artifactDigest,modelDigest:binding.modelProfile.digest,
        runtimeSpec,invocationId:request.id,conversationId:request.conversationId,target:{kind:'published',versionId:version.id}});
    }catch(error){
      if(request)await this.pool.query("UPDATE invocations SET record=record || $2::jsonb,next_attempt_at=now()+interval '5 seconds' WHERE id=$1 AND record->>'status' IN ('reserved','blocked')",[request.id,{status:'blocked',diagnostic:error instanceof AppError?error.code:'INVOCATION_DEPENDENCY_UNAVAILABLE',updatedAt:new Date().toISOString()}]);
    }finally{this.working=false;}
  }
}
