import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { RunService, type RunRuntime } from '../../apps/server/src/runs/run-service.js';
import { ReleaseService, type ReleaseGate } from '../../apps/server/src/releases/release-service.js';
import { InvocationService } from '../../apps/server/src/invocations/invocation-service.js';
import { PostgresActions } from '../../apps/server/src/actions/postgres-actions.js';
import { runtimeModelProfile } from '../../apps/runner/src/runtime/model-profile.js';
import { workOrderAssembly } from '../../packages/contracts/src/equipment-template.js';
import { contentDigest } from '../../apps/server/src/snapshots/domain/assembly.js';
import { draftInput } from '../support/fixtures.js';
const schema=`it_invocations_${randomUUID().replaceAll('-','')}`;
const url=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const clock={now:()=>new Date().toISOString()};const ids={next:randomUUID};
const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids);const snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids);
const profile=runtimeModelProfile('http://127.0.0.1:1/v1');const artifactDigest='a'.repeat(64);
beforeAll(async()=>{await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
async function setup(){
  const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'设备与工单',source:'user',confirmed:true}}});
  const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:workOrderAssembly()});
  let ready=true;let restartPending=false;let mockDigest='b'.repeat(64);let probe:()=>Promise<void>=async()=>{};let redeploys=0;const executions=new Map<string,string>();
  const runtime:RunRuntime={claim:async()=>{},retire:async()=>({status:'stopped'}),capabilities:async()=>({artifactDigest,modelConfigured:true,executionMode:'trusted-local',bootId:'fixture',modelProfile:profile}),
    deploy:async()=>({status:ready?'ready':'stopped'}),begin:async id=>{executions.set(id,'running');return{id,status:'running',events:[]};},
    execution:async id=>executions.has(id)?{id,status:executions.get(id)!,events:[],result:{output:'fixture'}}:null,
    cancel:async id=>{executions.set(id,'cancelled');return{id,status:'cancelled',events:[]};},events:async()=>[],stop:async()=>({status:'stopped'})};
  const actions=new PostgresActions(pool);const runs=new RunService(pool,snapshots,runtime,{ready:async()=>true,prepare:async()=>{},release:async()=>{},calls:async()=>[]},actions);
  const gate:ReleaseGate={check:async(id,validationId)=>({agentId:draft.id,snapshotId:id,validationId,binding:{snapshotDigest:snapshot.digest,artifactDigest,modelProfile:profile,mockDigest:'b'.repeat(64),baselineDigest:'c'.repeat(64),testSetDigest:'d'.repeat(64),compatibilityKey:'e'.repeat(64)}})};
  const releases=new ReleaseService(pool,gate,{prepare:async()=>({ready:true,artifactDigest,snapshotDigest:snapshot.digest}),smoke:async()=>({status:'passed',evidence:{fixture:true}}),stop:async()=>{}});
  async function publish(revision=0,rollbackVersionId?:string){const op=await releases.start(draft.id,{snapshotId:snapshot.id,validationId:randomUUID(),clientRequestId:randomUUID(),expectedRevision:revision,...(rollbackVersionId?{rollbackVersionId}:{})});await releases.tick();await releases.tick();return op;}
  const v1=await publish();
  const makeEntry=()=>new InvocationService(pool,snapshots,runs,{deployment:async()=>{await probe();return{status:restartPending?'interrupted':ready?'ready':'stopped',artifactDigest,specDigest:contentDigest(snapshot.content.runtimeSpec),modelProfile:profile};},deploy:async()=>{redeploys++;ready=true;restartPending=false;return{status:'ready'};}},actions,{identity:async()=>({implementationDigest:mockDigest})});
  const entry=makeEntry();
  const identity=await entry.identity(draft.id,'U1001');
  return{draft,snapshot,runs,entry,makeEntry,identity,publish,v1,actions,executions,redeploys:()=>redeploys,setReady:(value:boolean)=>{ready=value;},setRestartPending:(value:boolean)=>{restartPending=value;},setMockDigest:(value:string)=>{mockDigest=value;},setProbe:(value:()=>Promise<void>)=>{probe=value;}};
}
const input=()=>({clientRequestId:randomUUID(),input:'查询 PUMP-001'});
it('blocks a published target when the actual business service changes after validation',async()=>{
  const h=await setup();h.setMockDigest('f'.repeat(64));const request=await h.entry.send(h.identity,input());await h.entry.tick();
  expect((await h.entry.get(h.identity,request.requestId)).request).toMatchObject({status:'blocked',diagnostic:'PUBLISHED_DEPENDENCY_CHANGED'});
  expect(await h.runs.list(h.snapshot.id)).toHaveLength(0);await h.entry.cancel(h.identity,request.requestId);
});
it('restarts the exact non-retired published target before admitting a request after Runner recovery',async()=>{
  const h=await setup();h.setReady(false);h.setRestartPending(true);const request=await h.entry.send(h.identity,input());await h.entry.tick();
  expect(h.redeploys()).toBe(1);
  expect(await h.entry.get(h.identity,request.requestId)).toMatchObject({request:{status:'admitted',agentVersion:h.v1.versionId},run:{status:'queued',artifactDigest}});
  await h.entry.cancel(h.identity,request.requestId);await h.runs.tick();
});
it('deduplicates before resolving the pointer, pins conversations and routes new conversations after publish/rollback',async()=>{
  const h=await setup();const body=input();const first=await h.entry.send(h.identity,body);await h.entry.tick();
  const v2=await h.publish(1);const repeated=await h.entry.send(h.identity,body);
  expect(repeated.requestId).toBe(first.requestId);expect(repeated.run?.sharedTarget).toEqual({kind:'published',versionId:h.v1.versionId});
  await expect(h.entry.send(h.identity,{...body,input:'changed'})).rejects.toMatchObject({code:'REQUEST_INPUT_CONFLICT'});
  await expect(h.entry.send(h.identity,{...input(),conversationId:first.conversationId})).rejects.toMatchObject({code:'CONVERSATION_BUSY'});
  const fresh=await h.entry.send(h.identity,input());expect(fresh.agentVersion).toBe(v2.versionId);await h.entry.cancel(h.identity,fresh.requestId);
  await h.entry.cancel(h.identity,first.requestId);await h.runs.tick();
  const continued=await h.entry.send(h.identity,{...input(),conversationId:first.conversationId});expect(continued.agentVersion).toBe(h.v1.versionId);await h.entry.cancel(h.identity,continued.requestId);
  const rolled=await h.publish(2,h.v1.versionId);const last=await h.entry.send(h.identity,input());expect(last.agentVersion).toBe(rolled.versionId);await h.entry.cancel(h.identity,last.requestId);
  expect((await h.entry.send(h.identity,body)).requestId).toBe(first.requestId);
});
it('concurrent retries admit exactly one Run; identity, environment and agent cannot reuse another conversation or request',async()=>{
  const h=await setup();const body=input();const requests=await Promise.all(Array.from({length:8},()=>h.entry.send(h.identity,body)));
  expect(new Set(requests.map(r=>r.requestId)).size).toBe(1);await Promise.all([h.entry.tick(),h.makeEntry().tick()]);
  expect(await h.runs.list(h.snapshot.id)).toHaveLength(1);
  for(const bad of [{...h.identity,actorId:'U1002' as const},{...h.identity,environmentId:randomUUID()},{...h.identity,agentId:randomUUID()}]){
    await expect(h.entry.get(bad,requests[0]!.requestId)).rejects.toMatchObject({code:'REQUEST_NOT_FOUND'});
    await expect(h.entry.cancel(bad,requests[0]!.requestId)).rejects.toMatchObject({code:'REQUEST_NOT_FOUND'});
    await expect(h.entry.send(bad,{...input(),conversationId:requests[0]!.conversationId})).rejects.toMatchObject({code:'CONVERSATION_NOT_FOUND'});
  }
  await h.entry.cancel(h.identity,requests[0]!.requestId);await h.runs.tick();
});
it('cancellation fences a delayed admission, survives service reconstruction, and never starts a Run',async()=>{
  const h=await setup();let release!:()=>void;let entered!:()=>void;const reached=new Promise<void>(r=>{entered=r;});
  h.setProbe(async()=>{entered();await new Promise<void>(r=>{release=r;});});
  const request=await h.entry.send(h.identity,input());const pending=h.entry.tick();await reached;
  expect((await h.entry.cancel(h.identity,request.requestId)).request.status).toBe('cancelled');release();await pending;
  expect((await h.entry.get(h.identity,request.requestId)).run).toBeNull();expect(await h.runs.list(h.snapshot.id)).toHaveLength(0);
  const reconstructed=h.makeEntry();await reconstructed.tick();expect((await reconstructed.get(h.identity,request.requestId)).request.status).toBe('cancelled');
});
it('stopped targets remain blocked on their original version across pointer changes and can be cancelled without execution',async()=>{
  const h=await setup();const body=input();const first=await h.entry.send(h.identity,body);h.setReady(false);await h.entry.tick();
  expect((await h.entry.get(h.identity,first.requestId)).request).toMatchObject({status:'blocked',diagnostic:'DEPLOYMENT_NOT_READY'});
  await h.publish(1);expect((await h.entry.send(h.identity,body)).agentVersion).toBe(h.v1.versionId);
  expect(await h.runs.list(h.snapshot.id)).toHaveLength(0);await h.entry.cancel(h.identity,first.requestId);
});
it('reserved requests survive service reconstruction and enforce database target immutability',async()=>{
  const h=await setup();const message=input();const first=await h.entry.send(h.identity,message);const restarted=h.makeEntry();await restarted.tick();
  const admitted=await restarted.get(h.identity,first.requestId);expect(admitted.run?.invocationId).toBe(first.requestId);
  expect(admitted.run?.conversationId).toBe(first.conversationId);expect(await restarted.send(h.identity,message)).toEqual(admitted);
  await expect(pool.query("UPDATE invocations SET record=jsonb_set(record,'{agentVersion}',to_jsonb($2::text)) WHERE id=$1",[first.requestId,randomUUID()])).rejects.toThrow('immutable');
  await expect(pool.query("UPDATE conversations SET version_id=$2 WHERE id=$1",[first.conversationId,randomUUID()])).rejects.toThrow('immutable');
  await restarted.cancel(h.identity,first.requestId);await h.runs.tick();
  const next=await Promise.allSettled([restarted.send(h.identity,{...input(),conversationId:first.conversationId}),h.entry.send(h.identity,{...input(),conversationId:first.conversationId})]);
  expect(next.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(next.filter(r=>r.status==='rejected')).toHaveLength(1);
  for(const value of next)if(value.status==='fulfilled')await restarted.cancel(h.identity,value.value.requestId);
});
it('business action decisions and event reads use the owned request identity and reject foreign actions',async()=>{
  const h=await setup();const first=await h.entry.send(h.identity,input());await h.entry.tick();await h.runs.tick();
  const action=await h.actions.prepare(first.runId,'call-write','work-order-create',{equipmentId:'PUMP-001',description:'检查',priority:'normal'});
  const decision={decisionId:randomUUID(),decision:'approve' as const,actionHash:action.actionHash};
  await expect(h.entry.decide({...h.identity,actorId:'U1002'},first.requestId,action.id,decision)).rejects.toMatchObject({code:'REQUEST_NOT_FOUND'});
  await expect(h.entry.events({...h.identity,actorId:'U1002'},first.requestId,0)).rejects.toMatchObject({code:'REQUEST_NOT_FOUND'});
  await expect(h.entry.decide(h.identity,first.requestId,randomUUID(),decision)).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});
  expect((await h.entry.decide(h.identity,first.requestId,action.id,decision)).status).toBe('approved');
  expect((await h.entry.decide(h.identity,first.requestId,action.id,decision)).id).toBe(action.id);
  expect(await h.entry.events(h.identity,first.requestId,0)).not.toHaveLength(0);await h.entry.cancel(h.identity,first.requestId);await h.runs.tick();
});
