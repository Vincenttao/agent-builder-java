import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {Pool} from '../../apps/server/src/db/pool.js';
import {migrate} from '../../apps/server/src/db/migrations.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {PostgresDraftRepository} from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import {SnapshotService} from '../../apps/server/src/snapshots/application/snapshot-service.js';
import {PostgresSnapshotRepository} from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import {RunService,type RunRuntime,type MockControl} from '../../apps/server/src/runs/run-service.js';
import {equipmentAssembly,workOrderAssembly} from '../../packages/contracts/src/equipment-template.js';
import {PostgresActions} from '../../apps/server/src/actions/postgres-actions.js';
import {draftInput} from '../support/fixtures.js';
const schema=`it_run_leases_${randomUUID().replaceAll('-','')}`;
const url=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const clock={now:()=>new Date().toISOString()};const ids={next:randomUUID};
const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids);const snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids);
beforeAll(async()=>{await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
function barrier(){let release!:(value?:unknown)=>void;let entered!:()=>void;const reached=new Promise<void>(r=>{entered=r;});const held=new Promise(r=>{release=r;});return{reached,release,wait:async()=>{entered();return held;}};}
async function setup(options?:{leaseMs:number;heartbeatMs:number},write=false){
  const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'设备报告',source:'user',confirmed:true}}});
  const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:write?workOrderAssembly():equipmentAssembly()});
  let deploys=0;let begins=0;let stops=0;let status='running';
  const runtime:RunRuntime={claim:async()=>{},retire:async()=>{if(deploys)stops++;return{status:'stopped'};},capabilities:async()=>({artifactDigest:'a'.repeat(64),modelConfigured:true,executionMode:'trusted-local',bootId:'fixture'}),
    deploy:async()=>{deploys++;return{status:'ready'};},begin:async id=>{begins++;return{id,status,events:[]};},execution:async id=>({id,status,events:[],result:{answer:'86'}}),
    cancel:async id=>{status='cancelled';return{id,status,events:[]};},stop:async()=>{stops++;return{status:'stopped'};},events:async()=>[]};
  const mock:MockControl={ready:async()=>true,prepare:async()=>{},release:async()=>{},calls:async()=>[{source:'current'}]};
  const create=()=>new RunService(pool,snapshots,runtime,mock,undefined,undefined,options);const first=create();const second=create();
  const run=await first.create(snapshot.id,{clientRequestId:randomUUID(),input:'查询 PUMP-001'});
  const expire=()=>pool.query("UPDATE runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id]);
  return{first,second,run,runtime,mock,expire,stats:()=>({deploys,begins,stops}),finish:()=>{status='succeeded';}};
}
it('an expired worker cannot deploy after a new owner accepts pre-start cancellation',async()=>{
  const h=await setup();const gate=barrier();h.mock.prepare=async()=>{await gate.wait();};
  const stale=h.first.tick();await gate.reached;await h.expire();await h.second.cancel(h.run.id);await h.second.tick();
  const terminal=await h.second.get(h.run.id);expect(terminal.status).toBe('cancelled');gate.release();await stale;
  expect(await h.second.get(h.run.id)).toEqual(terminal);expect(h.stats().deploys).toBe(0);expect(h.stats().begins).toBe(0);
});
it('a late result from an expired worker cannot overwrite the new owner terminal state or event',async()=>{
  const h=await setup();await h.first.tick();h.finish();const gate=barrier();let count=0;
  h.mock.calls=async()=>{if(++count===1){await gate.wait();return[{source:'stale'}];}return[{source:'current'}];};
  const stale=h.first.tick();await gate.reached;await h.expire();await h.second.tick();
  const terminal=await h.second.get(h.run.id);expect(terminal.status).toBe('succeeded');const events=await h.second.events(h.run.id,0);
  gate.release();await stale;expect(await h.second.get(h.run.id)).toEqual(terminal);expect(await h.second.events(h.run.id,0)).toEqual(events);
  expect(h.stats().stops).toBe(1);
});
it('a stale dependency failure cannot update a completed Run or append misleading failure evidence',async()=>{
  const h=await setup();const gate=barrier();h.mock.prepare=async()=>{await gate.wait();throw new Error('late network failure');};
  const stale=h.first.tick();await gate.reached;await h.expire();await h.second.cancel(h.run.id);await h.second.tick();const terminal=await h.second.get(h.run.id);const events=await h.second.events(h.run.id,0);
  gate.release();await stale;expect(await h.second.get(h.run.id)).toEqual(terminal);expect(await h.second.events(h.run.id,0)).toEqual(events);
});
it('renews a live lease during a long dependency call without allowing a second worker to take over',async()=>{
  const h=await setup({leaseMs:1000,heartbeatMs:100});const gate=barrier();h.mock.prepare=async()=>{await gate.wait();};
  const current=h.first.tick();await gate.reached;
  try{
    const before=(await pool.query<{token:string}>('SELECT worker_fencing_token::text AS token FROM runs WHERE id=$1',[h.run.id])).rows[0]!.token;
    await new Promise(resolve=>setTimeout(resolve,1600));await h.second.tick();
    expect((await pool.query<{token:string}>('SELECT worker_fencing_token::text AS token FROM runs WHERE id=$1',[h.run.id])).rows[0]!.token).toBe(before);
    expect(h.stats().deploys).toBe(0);
  }finally{gate.release();await current;}
  h.finish();await h.first.tick();expect((await h.first.get(h.run.id)).status).toBe('succeeded');
});
it('dependency exhaustion remains reconcilable until remote execution and evidence can be observed',async()=>{
  const h=await setup();await h.first.tick();const read=h.runtime.execution;
  h.runtime.execution=async()=>{throw new Error('dependency unavailable');};
  for(let i=0;i<20;i++)await h.first.tick();
  expect(await h.first.get(h.run.id)).toMatchObject({status:'reconciling',diagnostic:'DEPENDENCY_UNAVAILABLE',dependencyFailures:20});
  expect((await h.first.events(h.run.id,0)).some(e=>e.type==='run.interrupted')).toBe(false);
  h.runtime.execution=read;await h.second.tick();expect(await h.second.get(h.run.id)).toMatchObject({status:'running',diagnostic:'',dependencyFailures:0});
  expect((await h.second.context(h.run.id)).runId).toBe(h.run.id);
  h.finish();await h.second.tick();expect((await h.second.get(h.run.id)).status).toBe('succeeded');
  await expect(pool.query("UPDATE runs SET record=jsonb_set(record,'{status}','\"running\"') WHERE id=$1",[h.run.id])).rejects.toThrow('immutable');
});
it('after dependency recovery a native approval interrupt can still create its pending action',async()=>{
  const h=await setup(undefined,true);await h.first.tick();
  h.runtime.execution=async()=>{throw new Error('dependency unavailable');};for(let i=0;i<20;i++)await h.first.tick();
  h.runtime.resume=async id=>({id,status:'running',events:[]});
  h.runtime.execution=async id=>({id,status:'waiting_confirmation',events:[],result:{result:{_interrupt:{toolName:'create_work_order',toolCallId:'recovered-call',payload:{value:{tool_args:{equipmentId:'PUMP-001',description:'检查',priority:'normal'}}}}}}});
  await h.second.tick();expect((await h.second.get(h.run.id)).status).toBe('waiting_confirmation');
  const actions=await new PostgresActions(pool).list(h.run.id);expect(actions).toHaveLength(1);expect(actions[0]!.status).toBe('pending');
  await h.second.cancel(h.run.id);await h.second.tick();expect((await h.second.get(h.run.id)).status).toBe('cancelled');
});
