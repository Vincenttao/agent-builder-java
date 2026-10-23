import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {Pool} from '../../apps/server/src/db/pool.js';
import {migrate} from '../../apps/server/src/db/migrations.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {PostgresDraftRepository} from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import {SnapshotService} from '../../apps/server/src/snapshots/application/snapshot-service.js';
import {PostgresSnapshotRepository} from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import {CandidateService} from '../../apps/server/src/candidates/candidate-service.js';
import {TestDeploymentService} from '../../apps/server/src/candidates/test-deployment-service.js';
import {BaselineService} from '../../apps/server/src/acceptance/application/baseline-service.js';
import {InvocationService} from '../../apps/server/src/invocations/invocation-service.js';
import {RunService,type RunRuntime} from '../../apps/server/src/runs/run-service.js';
import {PostgresActions} from '../../apps/server/src/actions/postgres-actions.js';
import {runtimeModelProfile} from '../../apps/runner/src/runtime/model-profile.js';
import {contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
import {equipmentAssembly} from '../../packages/contracts/src/equipment-template.js';
import {draftInput} from '../support/fixtures.js';
import {builtDevelopmentFixture} from '../support/built-development.js';
import {validationBinding} from '../../apps/server/src/acceptance/application/validation-binding.js';
import {createApp} from '../../apps/server/src/app.js';
import {ValidationLeaseTokens} from '../../apps/server/src/shared/validation-lease-tokens.js';
const schema=`it_test_targets_${randomUUID().replaceAll('-','')}`;
const url=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const clock={now:()=>new Date().toISOString()};const ids={next:randomUUID};
const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids);
const snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids);
const baselines=new BaselineService(pool,clock,ids);const profile=runtimeModelProfile('http://127.0.0.1:1/v1');
beforeAll(async()=>{await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
async function setup(generated=false){
  const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'设备报告',source:'user',confirmed:true}}});
  const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});
  const preview=await baselines.preview(draft.id,'equipment-read@1');
  const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});
  const build=generated?await builtDevelopmentFixture(pool,snapshot,baseline,'a'.repeat(64)):undefined;
  const deployments=new Map<string,string>();const executions=new Map<string,string>();const deployedSpecs:unknown[]=[];let deployHook=async()=>{};let loadHook=async()=>{};let loadedDigest=build?.artifact.artifactDigest??'a'.repeat(64);let artifactAvailable=true;let failRetire=false;
  const runtime:RunRuntime&{deployment:()=>Promise<{status:string;artifactDigest:string;specDigest:string;modelProfile:typeof profile}>}={
    capabilities:async()=>({artifactDigest:'a'.repeat(64),modelConfigured:true,executionMode:'trusted-local',bootId:'fixture',modelProfile:profile}),
    artifact:async()=>{if(!artifactAvailable||!build)throw new Error('missing');return build.artifact;},packageGenerated:async()=>build!.artifact,
    deploy:async(id,_artifact,spec)=>{deployedSpecs.push(structuredClone(spec));await deployHook();if(deployments.get(id)!=='stopped')deployments.set(id,'ready');return{status:deployments.get(id)!};},
    deployment:async()=>{await loadHook();return{status:'ready',artifactDigest:loadedDigest,specDigest:contentDigest(snapshot.content.runtimeSpec),modelProfile:profile};},
    claim:async()=>{},begin:async id=>{executions.set(id,'running');return{id,status:'running',events:[]};},
    execution:async id=>executions.has(id)?{id,status:executions.get(id)!,events:[]}:null,
    cancel:async id=>{executions.set(id,'cancelled');return{id,status:'cancelled',events:[]};},events:async()=>[],
    stop:async()=>({status:'stopped'}),retire:async id=>{if(failRetire)throw new Error('STOP_UNCONFIRMED');deployments.set(id,'stopped');return{status:'stopped'};}
  };
  const mock={ready:async()=>true,identity:async()=>({implementationDigest:'b'.repeat(64)}),prepare:async()=>{},release:async()=>{},calls:async()=>[]};
  const actions=new PostgresActions(pool);const runs=new RunService(pool,snapshots,runtime,mock,actions);
  const candidates=new CandidateService(pool,snapshots,runtime,baselines);const candidate=await candidates.create(snapshot.id,build?.job.id);
  const makeService=()=>new TestDeploymentService(pool,candidates,baselines,snapshots,runs,runtime,mock);
  const service=makeService();const entry=new InvocationService(pool,snapshots,runs,runtime,actions,mock);
  const input={clientRequestId:randomUUID(),candidateId:candidate.id,requirementBaselineId:baseline.id,suiteDigest:contentDigest(baseline.content.cases),purpose:'test' as const,ttlSeconds:3600};
  return{draft,snapshot,baseline,candidate,candidates,service,makeService,input,entry,runs,actions,deployments,deployedSpecs,setArtifactAvailable:(value:boolean)=>{artifactAvailable=value;},setDigest:(value:string)=>{loadedDigest=value;},setDeployHook:(hook:()=>Promise<void>)=>{deployHook=hook;},setLoadHook:(hook:()=>Promise<void>)=>{loadHook=hook;},setRetireFailure:(value:boolean)=>{failRetire=value;}};
}
const message=()=>({clientRequestId:randomUUID(),input:'查询 PUMP-001'});
async function validationCase(h:Awaited<ReturnType<typeof setup>>,index=2){
  const id=randomUUID();const runId=randomUUID();const owner=randomUUID();const now=clock.now();const item=h.baseline.content.cases[index]!;
  const binding={...validationBinding(h.snapshot,h.baseline,{artifactDigest:h.candidate.artifactDigest,modelProfile:profile,mockDigest:'b'.repeat(64)}),candidate:{id:h.candidate.id,bundleDigest:h.candidate.bundleDigest,provenance:h.candidate.provenance}};
  const record={id,snapshotId:h.snapshot.id,baselineId:h.baseline.id,clientRequestId:randomUUID(),inputDigest:'d'.repeat(64),allowMockWrites:false,binding,status:'running',cases:[{caseId:item.id,runId,state:'running'}],results:[],createdAt:now,updatedAt:now};
  await pool.query("INSERT INTO validation_executions(id,snapshot_id,baseline_id,client_request_id,record,lease_owner,lease_until,fencing_token) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '120 seconds',1)",[id,h.snapshot.id,h.baseline.id,record.clientRequestId,record,owner]);
  return{record,item,authority:{executionId:id,owner,token:'1',runId},input:{...h.input,clientRequestId:runId}};
}
it('pins an automatic case to its validation fault, exact request and preallocated Run; rejects stale or missing execution authority',async()=>{
  const h=await setup(true);const v=await validationCase(h);
  const target=await h.service.create(v.input,v.authority);
  expect(target.environmentConfig.fault).toBe('read-timeout');
  expect(target.validation).toEqual({executionId:v.record.id,caseId:v.item.id,runId:v.authority.runId,input:v.item.input,actorId:'U1001'});
  await h.service.tick();const identity=await h.service.identity(target.id,'U1001',v.authority);
  await expect(h.entry.send(identity,{clientRequestId:v.authority.runId,input:v.item.input})).rejects.toMatchObject({code:'VALIDATION_AUTHORITY_REQUIRED'});
  await expect(h.entry.send(identity,{clientRequestId:v.authority.runId,input:'changed'},v.authority)).rejects.toMatchObject({code:'VALIDATION_CASE_MISMATCH'});
  const request=await h.entry.send(identity,{clientRequestId:v.authority.runId,input:v.item.input},v.authority);expect(request.runId).toBe(v.authority.runId);
  await h.entry.tick();expect((await h.runs.get(request.runId)).validationId).toBe(v.record.id);
  await pool.query('UPDATE validation_executions SET fencing_token=2 WHERE id=$1',[v.record.id]);
  await expect(h.service.create(v.input,v.authority)).rejects.toMatchObject({code:'VALIDATION_CLAIM_LOST'});
  await expect(h.entry.send(identity,{clientRequestId:v.authority.runId,input:v.item.input},v.authority)).rejects.toMatchObject({code:'VALIDATION_CLAIM_LOST'});
  await expect(h.service.stop(target.id,v.authority)).rejects.toMatchObject({code:'VALIDATION_CLAIM_LOST'});
  await h.service.stop(target.id);await h.runs.tick();await h.service.tick();
});
it('cancellation fences a delayed automatic test creation and stops request admission',async()=>{
  const h=await setup();const v=await validationCase(h,0);
  await pool.query("UPDATE validation_executions SET record=record || '{\"status\":\"cancelling\"}'::jsonb WHERE id=$1",[v.record.id]);
  await expect(h.service.create(v.input,v.authority)).rejects.toMatchObject({code:'VALIDATION_CLAIM_LOST'});
  expect(await h.service.list(h.candidate.id)).toEqual([]);
});
it('clears a transient stop diagnostic after an interrupted deployment is safely retired',async()=>{
  const h=await setup();const target=await h.service.create(h.input);await h.service.tick();
  h.setRetireFailure(true);await h.service.stop(target.id);await h.service.tick();
  expect(await h.service.get(target.id)).toMatchObject({status:'stopping',diagnostic:'TEST_STOP_UNCONFIRMED'});
  h.setRetireFailure(false);await h.service.tick();
  expect(await h.service.get(target.id)).toMatchObject({status:'stopped',diagnostic:''});
});
it('the public test API rejects forged, manual and stale validation grants, while lease takeover reuses one request',async()=>{
  const h=await setup();const v=await validationCase(h,0);const tokens=new ValidationLeaseTokens();const origin='http://127.0.0.1:8080';
  const app=createApp({drafts,snapshots,candidates:h.candidates,testDeployments:h.service,invocations:h.entry,validationLeaseTokens:tokens,now:clock.now,bootstrapToken:'validation-http-fixture-0123456789',origin,modelConfigured:true,databaseReady:async()=>true});
  let targetId:string|undefined;
  try{
    const login=await app.inject({method:'POST',url:'/api/auth/session',headers:{origin},payload:{token:'validation-http-fixture-0123456789'}});
    const management={origin,cookie:login.headers['set-cookie']!.toString().split(';')[0]!,'x-csrf-token':login.json().csrfToken as string};
    const granted={...management,'x-builder-validation-grant':tokens.issue(v.authority)};
    expect((await app.inject({method:'POST',url:'/api/test-deployments',headers:{...management,'x-builder-validation-grant':new ValidationLeaseTokens().issue(v.authority)},payload:v.input})).statusCode).toBe(403);
    const created=await app.inject({method:'POST',url:'/api/test-deployments',headers:granted,payload:v.input});expect(created.statusCode,created.body).toBe(202);targetId=created.json().id as string;await h.service.tick();
    const root=`/api/test-deployments/${targetId}`;
    expect((await app.inject({method:'POST',url:root+'/sessions',headers:management,payload:{actorId:'U1001'}})).statusCode).toBe(403);
    const grant=await app.inject({method:'POST',url:root+'/sessions',headers:granted,payload:{actorId:'U1001'}});expect(grant.statusCode,grant.body).toBe(201);
    const business={authorization:`Bearer ${grant.json().token}`};const api=`/test-api/deployments/${targetId}`;const payload={clientRequestId:v.authority.runId,input:v.item.input};
    const first=await app.inject({method:'POST',url:api+'/messages',headers:business,payload});expect(first.statusCode,first.body).toBe(202);
    await pool.query('UPDATE validation_executions SET fencing_token=2 WHERE id=$1',[v.record.id]);
    expect((await app.inject({method:'POST',url:api+'/messages',headers:business,payload})).json().code).toBe('VALIDATION_CLAIM_LOST');
    expect((await app.inject({method:'POST',url:root+'/stop',headers:granted,payload:{}})).json().code).toBe('VALIDATION_CLAIM_LOST');
    const successor={...management,'x-builder-validation-grant':tokens.issue({...v.authority,token:'2'})};const next=await app.inject({method:'POST',url:root+'/sessions',headers:successor,payload:{actorId:'U1001'}});
    const retry=await app.inject({method:'POST',url:api+'/messages',headers:{authorization:`Bearer ${next.json().token}`},payload});expect(retry.statusCode,retry.body).toBe(202);expect(retry.json().requestId).toBe(first.json().requestId);
    expect((await app.inject({method:'POST',url:api+'/messages',headers:business,payload})).statusCode).toBe(401);
    expect((await app.inject({url:`/api/test-deployments/by-validation-run/${v.authority.runId}`,headers:management})).json().target.id).toBe(targetId);
  }finally{if(targetId){await h.service.stop(targetId);await h.runs.tick();await h.service.tick();}await app.close();}
});
it('runs a registered generated artifact through the first-candidate ingress and blocks missing bytes without a template fallback',async()=>{
 const h=await setup(true);const target=await h.service.create(h.input);await h.service.tick();expect((await h.service.get(target.id)).status).toBe('ready');
 const identity=await h.service.identity(target.id,'U1001');const request=await h.entry.send(identity,message());await h.entry.tick();
 expect((await h.entry.get(identity,request.requestId)).run).toMatchObject({artifactDigest:'9'.repeat(64),deploymentId:target.deploymentId});
 h.setArtifactAvailable(false);const next=await h.entry.send(identity,message());await h.entry.tick();
 expect((await h.entry.get(identity,next.requestId)).request.status).toBe('blocked');
 await expect(h.service.create({...h.input,clientRequestId:randomUUID()})).rejects.toMatchObject({code:'CANDIDATE_RUNTIME_CHANGED'});
 await h.service.stop(target.id);await h.runs.tick();await h.service.tick();
});
it('tests the first candidate without a release, scopes idempotency and conversations to the fixed deployment, and retains history after stop',async()=>{
  const h=await setup();const target=await h.service.create(h.input);await h.service.tick();
  expect((await h.service.get(target.id)).status).toBe('ready');
  expect(target.runtimeSpec).toEqual(h.candidate.runtimeSpec);expect(h.deployedSpecs[0]).toEqual(h.candidate.runtimeSpec);
  expect((await pool.query('SELECT * FROM release_pointers WHERE agent_id=$1',[h.draft.id])).rowCount).toBe(0);
  const identity={agentId:h.draft.id,actorId:'U1002' as const,environmentId:target.environmentId,testDeploymentId:target.id};
  const body=message();const first=await h.entry.send(identity,body);await h.entry.tick();
  const view=await h.entry.get(identity,first.requestId);
  expect(view).toMatchObject({agentVersion:null,testDeploymentId:target.id,candidateId:h.candidate.id,artifactDigest:'a'.repeat(64),run:{deploymentId:target.deploymentId,actorId:'U1002',runtimeSpec:h.candidate.runtimeSpec,sharedTarget:{kind:'test',testDeploymentId:target.id,candidateId:h.candidate.id}}});
  await h.runs.tick();expect(h.deployedSpecs.every(spec=>contentDigest(spec)===h.candidate.specDigest)).toBe(true);
  await expect(h.entry.get({...identity,actorId:'U1001'},first.requestId)).rejects.toMatchObject({code:'REQUEST_NOT_FOUND'});
  expect((await h.entry.send(identity,body)).requestId).toBe(first.requestId);
  await expect(h.entry.send(identity,{...body,input:'换问题'})).rejects.toMatchObject({code:'REQUEST_INPUT_CONFLICT'});
  const other=await h.service.create({...h.input,clientRequestId:randomUUID(),purpose:'preview'});await h.service.tick();
  expect(other.environmentId).not.toBe(target.environmentId);
  const secondIdentity={...identity,environmentId:other.environmentId,testDeploymentId:other.id};
  await expect(h.entry.get(secondIdentity,first.requestId)).rejects.toMatchObject({code:'REQUEST_NOT_FOUND'});
  await expect(h.entry.send(secondIdentity,{...message(),conversationId:first.conversationId})).rejects.toMatchObject({code:'CONVERSATION_NOT_FOUND'});
  await expect(h.entry.get({agentId:identity.agentId,actorId:identity.actorId,environmentId:identity.environmentId},first.requestId)).rejects.toMatchObject({code:'REQUEST_NOT_FOUND'});
  await h.service.stop(target.id);await h.runs.tick();await h.service.tick();
  expect((await h.service.get(target.id)).status).toBe('stopped');
  expect((await h.runs.get(first.runId)).status).toBe('cancelled');
  await expect(h.entry.send(identity,message())).rejects.toMatchObject({code:'TEST_DEPLOYMENT_NOT_READY'});
  expect((await h.entry.get(identity,first.requestId)).run?.status).toBe('cancelled');
  await h.service.stop(other.id);await h.service.tick();
});
it('blocks mismatched loaded bytes and retires failed preparation while preserving its fixed target',async()=>{
  const h=await setup();h.setDigest('f'.repeat(64));const target=await h.service.create(h.input);await h.service.tick();
  expect(await h.service.get(target.id)).toMatchObject({status:'stopping',failure:true,diagnostic:'TEST_MANIFEST_MISMATCH'});
  await h.service.tick();expect(await h.service.get(target.id)).toMatchObject({status:'failed',candidateId:h.candidate.id});
  expect(h.deployments.get(target.deploymentId)).toBe('stopped');expect(await h.runs.list(h.snapshot.id)).toHaveLength(0);
  const next=await h.service.create({...h.input,clientRequestId:randomUUID()});h.setDigest('a'.repeat(64));await h.service.tick();
  const identity=await h.service.identity(next.id,'U1001');const pending=await h.entry.send(identity,message());h.setDigest('f'.repeat(64));await h.entry.tick();
  expect((await h.entry.get(identity,pending.requestId)).request).toMatchObject({status:'blocked',diagnostic:'TEST_MANIFEST_MISMATCH'});
  expect(await h.runs.list(h.snapshot.id)).toHaveLength(0);await h.service.stop(next.id);await h.service.tick();
});
it('expires a ready deployment and cancels an admitted request before starting a model execution',async()=>{
  const h=await setup();const target=await h.service.create({...h.input,ttlSeconds:3});await h.service.tick();
  const identity=await h.service.identity(target.id,'U1001');const request=await h.entry.send(identity,message());await h.entry.tick();
  await expect.poll(async()=>(await pool.query<{expired:boolean}>('SELECT clock_timestamp()>$1::timestamptz AS expired',[target.expiresAt])).rows[0]!.expired,{timeout:6000,interval:50}).toBe(true);
  await expect(h.service.identity(target.id,'U1001')).rejects.toMatchObject({code:'TEST_DEPLOYMENT_EXPIRED'});
  await h.runs.tick();expect((await h.runs.get(request.runId)).status).toBe('cancelled');
  await h.service.tick();await h.service.tick();expect((await h.service.get(target.id)).status).toBe('stopped');
});
it('freezes test bindings, rejects changed suites and retry input, and returns the original deployment after service reconstruction',async()=>{
  const h=await setup();await expect(h.service.create({...h.input,suiteDigest:'f'.repeat(64)})).rejects.toMatchObject({code:'TEST_SUITE_MISMATCH'});
  const first=await h.service.create(h.input);expect(await h.makeService().create(h.input)).toEqual(first);
  await expect(h.service.create({...h.input,ttlSeconds:500})).rejects.toMatchObject({code:'REQUEST_INPUT_CONFLICT'});
  await expect(pool.query("UPDATE test_deployments SET record=record || '{\"candidateId\":\"changed\"}'::jsonb WHERE id=$1",[first.id])).rejects.toThrow(/immutable/i);
  await h.service.stop(first.id);await h.service.tick();
});
it('stopping a preparing deployment fences its late startup and never resurrects ready state',async()=>{
  const h=await setup();let entered!:()=>void;let release!:()=>void;const reached=new Promise<void>(r=>{entered=r;});const held=new Promise<void>(r=>{release=r;});
  h.setDeployHook(async()=>{entered();await held;});const target=await h.service.create(h.input);const pending=h.service.tick();
  await reached;await h.makeService().stop(target.id);await h.makeService().tick();release();await pending;
  await h.makeService().tick();expect((await h.service.get(target.id)).status).toBe('stopped');expect(h.deployments.get(target.deploymentId)).toBe('stopped');
});
it('stop wins against a delayed request admission without creating a Run',async()=>{
  const h=await setup();const target=await h.service.create(h.input);await h.service.tick();
  const identity={agentId:h.draft.id,actorId:'U1001' as const,environmentId:target.environmentId,testDeploymentId:target.id};
  const first=await h.entry.send(identity,message());let entered!:()=>void;let release!:()=>void;
  const reached=new Promise<void>(r=>{entered=r;});const held=new Promise<void>(r=>{release=r;});h.setLoadHook(async()=>{entered();await held;});
  const pending=h.entry.tick();await reached;await h.service.stop(target.id);release();await pending;
  expect((await h.entry.get(identity,first.requestId)).request.status).toBe('cancelled');expect(await h.runs.list(h.snapshot.id)).toHaveLength(0);
  await h.service.tick();
});
