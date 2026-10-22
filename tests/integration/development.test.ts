import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {Pool} from '../../apps/server/src/db/pool.js';
import {migrate} from '../../apps/server/src/db/migrations.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {PostgresDraftRepository} from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import {SnapshotService} from '../../apps/server/src/snapshots/application/snapshot-service.js';
import {PostgresSnapshotRepository} from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import {BaselineService} from '../../apps/server/src/acceptance/application/baseline-service.js';
import {DevelopmentService,type EngineeringPort} from '../../apps/server/src/development/development-service.js';
import {EngineeringTaskManager} from '../../apps/runner/src/engineering/task-manager.js';
import {generationProfile} from '../../apps/runner/src/engineering/profile.js';
import {equipmentAssembly} from '../../packages/contracts/src/equipment-template.js';
import type {EngineeringTaskRecord} from '../../packages/contracts/src/development.js';
import {draftInput} from '../support/fixtures.js';
import {DependencyError} from '../../apps/server/src/runs/http-ports.js';
import {resolve} from 'node:path';
const schema=`it_development_${randomUUID().replaceAll('-','')}`;
const url=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:url});const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const clock={now:()=>new Date().toISOString()};const ids={next:randomUUID};
const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids);
const snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids);
const baselines=new BaselineService(pool,clock,ids);
beforeAll(async()=>{await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);});
afterAll(async()=>{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();});
const generation={profileVersion:generationProfile.version,scope:['tool','skill'] as ('tool'|'skill')[],dependencies:[...generationProfile.dependencies],connectionProfile:generationProfile.connectionProfile};
async function setup(){
 const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{value:'设备报告',source:'user',confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});
 const preview=await baselines.preview(draft.id,'equipment-read@1');const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});
 const manager=new EngineeringTaskManager(resolve('test-results',`development-${randomUUID()}`),()=>({run:async()=>{throw new Error('fixture not executed');},cancel:async()=>{}}));await manager.initialize();
 let submitHook=async()=>{};let afterSubmitHook=async()=>{};
 const port:EngineeringPort={submit:async(id,input)=>{await submitHook();const result=await manager.submit(id,input);await afterSubmitHook();return result;},get:id=>manager.get(id),cancel:id=>manager.cancel(id),events:(id,after)=>manager.events(id,after)};
 const service=new DevelopmentService(pool,snapshots,baselines,port);
 const input={clientRequestId:randomUUID(),baselineId:baseline.id,generation,maxSeconds:30};
 return{draft,snapshot,baseline,input,manager,service,port,setSubmitHook:(hook:()=>Promise<void>)=>{submitHook=hook;},setAfterSubmitHook:(hook:()=>Promise<void>)=>{afterSubmitHook=hook;}};
}
it('freezes confirmed inputs, deduplicates admission, and recovers an uncertain submit without starting another task',async()=>{
 const h=await setup();const [a,b]=await Promise.all([h.service.start(h.snapshot.id,h.input),h.service.start(h.snapshot.id,h.input)]);expect(a.id).toBe(b.id);
 await expect(h.service.start(h.snapshot.id,{...h.input,maxSeconds:40})).rejects.toMatchObject({code:'DEVELOPMENT_INPUT_CONFLICT'});
 h.setAfterSubmitHook(async()=>{throw new Error('response lost');});await h.service.tick();expect((await h.service.get(a.id)).status).toBe('queued');
 h.setAfterSubmitHook(async()=>{});const restarted=new DevelopmentService(pool,snapshots,baselines,h.port);await restarted.tick();expect((await h.manager.get(a.id)).id).toBe(a.id);
 await drafts.update(h.draft.id,{expectedRevision:1,name:'changed',brief:{...h.draft.brief,goal:{value:'changed',source:'user',confirmed:true}}});
 expect((await restarted.get(a.id)).baselineDigest).toBe(h.baseline.digest);
 await expect(pool.query("UPDATE development_jobs SET task_input=task_input || '{\"maxSeconds\":5}'::jsonb WHERE id=$1",[a.id])).rejects.toThrow(/immutable/i);
 await restarted.cancel(a.id);await restarted.tick();expect((await restarted.get(a.id)).status).toBe('cancelled');await h.manager.close();
});
it('rejects a different baseline and preserves cancellation across an in-flight late submit',async()=>{
 const h=await setup();const other=await setup();await expect(h.service.start(h.snapshot.id,{...h.input,baselineId:other.baseline.id})).rejects.toMatchObject({code:'BASELINE_TARGET_MISMATCH'});
 const job=await h.service.start(h.snapshot.id,h.input);let release!:()=>void;let entered!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});const reached=new Promise<void>(r=>{entered=r;});h.setSubmitHook(async()=>{entered();await gate;});
 const submitting=h.service.tick();await reached;await h.service.cancel(job.id);const restarted=new DevelopmentService(pool,snapshots,baselines,h.port);await restarted.tick();
 expect((await restarted.get(job.id)).status).toBe('cancelled');release();await submitting;
 expect((await h.service.get(job.id)).status).toBe('cancelled');await expect(h.manager.get(job.id)).rejects.toMatchObject({code:'ENGINEERING_NOT_FOUND'});
 await h.manager.close();await other.manager.close();
});
it('does not promote a mismatched runner binding or a nonterminal cancellation to success',async()=>{
 const h=await setup();const job=await h.service.start(h.snapshot.id,h.input);
 const invalid:EngineeringPort={...h.port,submit:async()=>({id:job.id,inputDigest:'wrong',status:'built',roles:[]} as unknown as EngineeringTaskRecord),cancel:async()=>({id:job.id,status:'reconciling'})};
 const service=new DevelopmentService(pool,snapshots,baselines,invalid);await service.tick();expect((await service.get(job.id)).status).toBe('reconciling');
 await service.cancel(job.id);await service.tick();expect((await service.get(job.id)).status).toBe('cancelling');await h.manager.close();
});
it('reports explicit pre-execution model configuration rejection instead of leaving a task queued forever',async()=>{
 const h=await setup();const service=new DevelopmentService(pool,snapshots,baselines,{...h.port,submit:async()=>{throw new DependencyError(409,'ENGINE_MODEL_NOT_CONFIGURED');}});
 const job=await service.start(h.snapshot.id,h.input);await service.tick();expect(await service.get(job.id)).toMatchObject({status:'failed',diagnostic:'ENGINE_MODEL_NOT_CONFIGURED'});await h.manager.close();
});
