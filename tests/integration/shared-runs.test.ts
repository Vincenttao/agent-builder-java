import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { RunService, type RunRuntime, type MockControl, type SharedRunSetup } from '../../apps/server/src/runs/run-service.js';
import { ReleaseService, type ReleaseDriver, type ReleaseGate } from '../../apps/server/src/releases/release-service.js';
import { runtimeModelProfile } from '../../apps/runner/src/runtime/model-profile.js';
import { workOrderAssembly, wealthBalanceAssembly } from '../../packages/contracts/src/equipment-template.js';
import type { ReleaseOperation } from '../../packages/contracts/src/releases.js';
import type { ReleaseClaim } from '../../apps/server/src/shared/release-claim.js';
import { draftInput } from '../support/fixtures.js';
import { BaselineService } from '../../apps/server/src/acceptance/application/baseline-service.js';
import { PostgresActions } from '../../apps/server/src/actions/postgres-actions.js';
import { ProjectReleaseDriver } from '../../apps/server/src/releases/project-release-driver.js';
import { contentDigest } from '../../apps/server/src/snapshots/domain/assembly.js';
const schema = `it_shared_runs_${randomUUID().replaceAll('-','')}`;
const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin = new Pool({connectionString:url}); const pool = new Pool({connectionString:url,options:`-c search_path=${schema}`});
const clock = {now:()=>new Date().toISOString()}; const ids = {next:randomUUID};
const drafts = new DraftService(new PostgresDraftRepository(pool),clock,ids); const snapshots = new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids);
const profile = runtimeModelProfile('http://127.0.0.1:1/v1'); const artifactDigest = 'a'.repeat(64);
beforeAll(async()=>{await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
afterEach(async()=>{
  // Fixture-only cleanup; these ports never launch a process or invoke a business API.
  await pool.query("UPDATE runs SET record=record || '{\"status\":\"cancelled\"}'::jsonb WHERE record->>'status' NOT IN ('succeeded','failed','cancelled','interrupted')");
  await pool.query("UPDATE release_operations SET record=record || '{\"status\":\"failed\"}'::jsonb WHERE record->>'status' IN ('queued','preparing','smoking')");
});
async function setup() {
  const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'设备与工单',source:'user',confirmed:true}}});
  const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:workOrderAssembly()});
  const states=new Map<string,string>(); let stops=0; const environments:string[]=[];
  const runtime:RunRuntime={
    claim:async()=>{},retire:async()=>{stops++;return{status:'stopped'};},
    capabilities:async()=>({artifactDigest,modelConfigured:true,executionMode:'trusted-local',bootId:'fixture',modelProfile:profile}),
    deploy:async()=>({status:'ready'}),begin:async id=>{states.set(id,'running');return {id,status:'running',events:[]};},
    execution:async id=>states.has(id)?{id,status:states.get(id)!,events:[],result:{output:'fixture'}}:null,
    cancel:async id=>{states.set(id,'cancelled');return{id,status:'cancelled',events:[]};},
    events:async()=>[],stop:async()=>{stops++;return{status:'stopped'};}
  };
  const mock:MockControl={ready:async()=>true,prepare:async env=>{environments.push(env);},release:async()=>{},calls:async()=>[]};
  const runs=new RunService(pool,snapshots,runtime,mock);
  const gate:ReleaseGate={check:async(id,validationId)=>({agentId:draft.id,snapshotId:id,validationId,binding:{snapshotDigest:snapshot.digest,artifactDigest,modelProfile:profile,mockDigest:'b'.repeat(64),baselineDigest:'c'.repeat(64),testSetDigest:'d'.repeat(64),compatibilityKey:'e'.repeat(64)}})};
  const driver:ReleaseDriver={prepare:async()=>({ready:true,artifactDigest,snapshotDigest:snapshot.digest}),smoke:async()=>({status:'passed',evidence:{fixture:true}}),stop:async()=>{}};
  const releases=new ReleaseService(pool,gate,driver);
  const start=async(revision=0)=>releases.start(draft.id,{snapshotId:snapshot.id,validationId:randomUUID(),expectedRevision:revision,clientRequestId:randomUUID()});
  const config=(op:ReleaseOperation,target:SharedRunSetup['target']):SharedRunSetup=>({runId:target.kind==='release-smoke'?op.smokeRunId:randomUUID(),environmentId:op.environmentId,deploymentId:op.deploymentId,artifactDigest,modelDigest:profile.digest,actorId:'U1001',target});
  return{draft,snapshot,runs,releases,driver,gate,runtime,mock,start,config,states,stats:()=>({stops,environments})};
}
it('the real release driver checks loaded manifests and independently asserts smoke output and external evidence',async()=>{
  const h=await setup();const baselines=new BaselineService(pool,clock,ids);const preview=await baselines.preview(h.draft.id,'equipment-workorder@1');
  const baseline=await baselines.confirm(h.draft.id,{expectedRevision:1,templateId:'equipment-workorder@1',expectedDigest:preview.digest,confirmed:true});
  let mismatch=true;let badFacts=false;let retires=0;
  const loaded={status:'ready',artifactDigest,specDigest:contentDigest(h.snapshot.content.runtimeSpec),modelProfile:profile};
  const runtime={...h.runtime,deployment:async()=>({...loaded,specDigest:mismatch?'f'.repeat(64):loaded.specDigest}),retire:async()=>{retires++;return{status:'stopped'};}};
  const mock={...h.mock,inspect:async(id:string)=>({id,revision:2,config:{seed:'enterprise-default@1' as const,fault:'normal' as const,clock:'2026-10-21T08:00:00.000Z'},state:{}}),
    calls:async(_env:string,runId:string)=>[{runId,operation:'equipment-status',status:200,result:{equipmentId:'PUMP-001',status:'warning',temperatureCelsius:86,source:'seed-equipment-001@1'}}]};
  const driver=new ProjectReleaseDriver(pool,snapshots,baselines,{report:async()=>({baselineId:baseline.id})},h.runs,runtime,mock,new PostgresActions(pool));
  const releases=new ReleaseService(pool,h.gate,driver);
  const start=(revision:number)=>releases.start(h.draft.id,{snapshotId:h.snapshot.id,validationId:randomUUID(),clientRequestId:randomUUID(),expectedRevision:revision});
  const bad=await start(0);await releases.tick();expect((await releases.get(bad.id)).diagnostic).toBe('DEPLOYMENT_MANIFEST_MISMATCH');expect((await releases.pointer(h.draft.id)).versionId).toBeUndefined();expect(retires).toBe(1);
  mismatch=false;const good=await start(0);await releases.tick();expect((await releases.get(good.id)).status).toBe('smoking');await releases.tick();
  await h.runs.tick();expect((await releases.pointer(h.draft.id)).versionId).toBeUndefined();
  h.runtime.execution=async(id)=>({id,status:'succeeded',events:[],result:{result:{content:JSON.stringify({kind:'equipment-report',equipmentId:'PUMP-001',status:'warning',temperatureCelsius:badFacts?0:86,source:'seed-equipment-001@1',recommendation:'检查温度告警'})}}});
  await h.runs.tick();await releases.tick();expect((await releases.get(good.id)).status).toBe('succeeded');const pointer=await releases.pointer(h.draft.id);
  badFacts=true;const badSmoke=await start(1);await releases.tick();await releases.tick();await h.runs.tick();await h.runs.tick();await releases.tick();
  expect((await releases.get(badSmoke.id)).diagnostic).toBe('SMOKE_FAILED');expect(await releases.pointer(h.draft.id)).toEqual(pointer);expect(retires).toBe(2);
});
it('publishes a finance candidate with a read-only balance release smoke',async()=>{
  const h=await setup();
  const financeDraft=await drafts.create({...draftInput,brief:{...draftInput.brief,goal:{value:'查询模拟账户余额',source:'user',confirmed:true},output:{value:'返回接口余额字段',source:'user',confirmed:true}}});
  const snapshot=await snapshots.create(financeDraft.id,{expectedRevision:1,assembly:wealthBalanceAssembly('查询模拟账户余额')});
  const baselines=new BaselineService(pool,clock,ids);const preview=await baselines.preview(financeDraft.id,'wealth-balance-read@1');
  const baseline=await baselines.confirm(financeDraft.id,{expectedRevision:1,templateId:'wealth-balance-read@1',expectedDigest:preview.digest,confirmed:true});
  const facts={accountId:'A1001',currency:'CNY',availableBalanceFen:1000000,asOf:'2026-10-21T08:00:00.000Z'};
  const mock={...h.mock,inspect:async(id:string)=>({id,revision:1,config:{seed:'enterprise-default@1' as const,fault:'normal' as const,clock:'2026-10-21T08:00:00.000Z'},state:{}}),
    calls:async(_env:string,runId:string)=>[{runId,operation:'getAccountBalance',status:200,input:{accountId:'A1001'},result:facts}]};
  (h.mock as unknown as {calls:typeof mock.calls}).calls=mock.calls;
  const financeRuntime=Object.assign(h.runtime,{deployment:async()=>({status:'ready',artifactDigest,specDigest:contentDigest(snapshot.content.runtimeSpec),modelProfile:profile}),
    retire:async()=>({status:'stopped' as const})});
  const driver=new ProjectReleaseDriver(pool,snapshots,baselines,{report:async()=>({baselineId:baseline.id})},h.runs,financeRuntime,mock,new PostgresActions(pool));
  const gate:ReleaseGate={check:async(_snapshotId,validationId)=>({agentId:financeDraft.id,snapshotId:snapshot.id,validationId,runtimeSpec:snapshot.content.runtimeSpec,
    binding:{snapshotDigest:snapshot.digest,artifactDigest,modelProfile:profile,mockDigest:'b'.repeat(64),baselineDigest:baseline.digest,
      testSetDigest:contentDigest(baseline.content.cases),compatibilityKey:'e'.repeat(64)}})};
  const releases=new ReleaseService(pool,gate,driver);const op=await releases.start(financeDraft.id,{snapshotId:snapshot.id,validationId:randomUUID(),clientRequestId:randomUUID(),expectedRevision:0});
  await releases.tick();expect((await releases.get(op.id)).status).toBe('smoking');
  await releases.tick();
  h.runtime.execution=async(id)=>({id,status:'succeeded',events:[],result:{result:{content:JSON.stringify({kind:'account-balance',...facts})}}});
  await h.runs.tick();await h.runs.tick();await releases.tick();
  expect((await releases.get(op.id)).status).toBe('succeeded');
  expect((await releases.pointer(financeDraft.id)).versionId).toBe(op.versionId);
});
it('completing or cancelling a published Run preserves its shared deployment and persistent environment',async()=>{
  const h=await setup();const op=await h.start();await h.releases.tick();await h.releases.tick();
  const a=await h.runs.createShared(h.snapshot.id,{clientRequestId:randomUUID(),input:'查询设备'},h.config(op,{kind:'published',versionId:op.versionId}));
  const b=await h.runs.createShared(h.snapshot.id,{clientRequestId:randomUUID(),input:'第二个查询'},h.config(op,{kind:'published',versionId:op.versionId}));
  expect(a.deploymentId).toBe(op.deploymentId);expect(b.environmentId).toBe(op.environmentId);
  await h.runs.tick();await h.runs.tick();h.states.set(a.id,'succeeded');await h.runs.tick();
  expect((await h.runs.get(a.id)).status).toBe('succeeded');await h.runs.cancel(b.id);await h.runs.tick();
  expect((await h.runs.get(b.id)).status).toBe('cancelled');expect(h.stats().stops).toBe(0);expect(h.stats().environments).toEqual([op.environmentId,op.environmentId]);
  await expect(pool.query("UPDATE runs SET record=jsonb_set(record,'{deploymentId}',to_jsonb($2::text)) WHERE id=$1",[a.id,randomUUID()])).rejects.toThrow('immutable');
});
it('rejects forged published deployment bindings and missing versions before admitting a Run',async()=>{
  const h=await setup();const op=await h.start();await h.releases.tick();await h.releases.tick();
  const conf=h.config(op,{kind:'published',versionId:op.versionId});
  await expect(h.runs.createShared(h.snapshot.id,{clientRequestId:randomUUID(),input:'query'},{...conf,deploymentId:randomUUID()})).rejects.toMatchObject({code:'SHARED_TARGET_MISMATCH'});
  await expect(h.runs.createShared(h.snapshot.id,{clientRequestId:randomUUID(),input:'query'},{...conf,target:{kind:'published',versionId:randomUUID()}})).rejects.toMatchObject({code:'SHARED_TARGET_MISMATCH'});
  expect((await h.runs.list(h.snapshot.id))).toHaveLength(0);
});
it('admits a smoke Run only under its current release lease and exposes only read operations',async()=>{
  const h=await setup();const op=await h.start();await h.releases.tick();let used:ReleaseClaim|undefined;
  h.driver.smoke=async(operation,claim)=>{used=claim;await h.runs.createShared(h.snapshot.id,{clientRequestId:op.smokeRunId,input:'只读冒烟'},h.config(operation,{kind:'release-smoke',claim}));return{status:'pending'};};
  await h.releases.tick();expect(used).toBeDefined();await h.runs.tick();
  expect((await h.runs.context(op.smokeRunId)).operations).toEqual(['equipment-status']);
  const next=await h.start(0).catch(()=>null);expect(next).toBeNull();
  await expect(h.runs.createShared(h.snapshot.id,{clientRequestId:randomUUID(),input:'late'},h.config(op,{kind:'release-smoke',claim:{...used!,token:String(Number(used!.token)+1)}}))).rejects.toMatchObject({code:'RELEASE_CLAIM_LOST'});
});
