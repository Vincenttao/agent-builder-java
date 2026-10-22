import {resolveOpenCodeExecutable} from '../apps/runner/src/engineering/engine-binary.js';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from '../apps/server/src/db/pool.js';
import {migrate} from '../apps/server/src/db/migrations.js';
import {DraftService} from '../apps/server/src/drafts/application/draft-service.js';
import {PostgresDraftRepository} from '../apps/server/src/drafts/adapters/postgres-drafts.js';
import {SnapshotService} from '../apps/server/src/snapshots/application/snapshot-service.js';
import {PostgresSnapshotRepository} from '../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import {BaselineService} from '../apps/server/src/acceptance/application/baseline-service.js';
import {DevelopmentService} from '../apps/server/src/development/development-service.js';
import {HttpEngineering} from '../apps/server/src/development/http-engineering.js';
import {EngineeringTaskManager} from '../apps/runner/src/engineering/task-manager.js';
import {OpenCodeTaskExecutor} from '../apps/runner/src/engineering/task-executor.js';
import {ExecutionJournal} from '../apps/runner/src/executions/journal.js';
import {createRunnerApp} from '../apps/runner/src/app.js';
import {createApp} from '../apps/server/src/app.js';
import {equipmentAssembly} from '../packages/contracts/src/equipment-template.js';
import {equipmentGenerationRequest} from '../packages/contracts/src/generation-profile.js';
import type {DevelopmentJob,EngineeringEvent,CommandResult} from '../packages/contracts/src/development.js';
import {draftInput} from '../tests/support/fixtures.js';
if(process.env.RUN_LIVE_E2E!=='1'||!process.env.DEEPSEEK_API_KEY)throw new Error('Live engineering probe requires explicit opt-in and local credentials');
const id=randomUUID();const root=resolve('.cache/development-live',id);await mkdir(root,{recursive:true});
const schema=`live_development_${id.replaceAll('-','')}`;const database=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:database});const pool=new Pool({connectionString:database,options:`-c search_path=${schema}`});await admin.query(`CREATE SCHEMA "${schema}"`);await migrate(pool);
const clock={now:()=>new Date().toISOString()};const ids={next:randomUUID};
const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids);const snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids);const baselines=new BaselineService(pool,clock,ids);
const runtime={artifactDigest:createHash('sha256').update('not-used-for-business-runtime').digest('hex'),bootId:randomUUID()};
const manager=new EngineeringTaskManager(join(root,'runner'),directory=>new OpenCodeTaskExecutor({root:directory,sdkJar:resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),executable:resolveOpenCodeExecutable(),modelKey:process.env.DEEPSEEK_API_KEY!}));await manager.initialize();
const journal=new ExecutionJournal(join(root,'executions'),runtime as never);await journal.initialize();const token=randomUUID()+randomUUID();
const runner=createRunnerApp({token,runtime:runtime as never,journal,modelConfigured:true,engineering:manager});const runnerBase=await runner.listen({host:'127.0.0.1',port:0});
const service=new DevelopmentService(pool,snapshots,baselines,new HttpEngineering(runnerBase,token));
const origin='http://127.0.0.1:8080';const app=createApp({drafts,snapshots,baselines,development:service,bootstrapToken:token,origin,databaseReady:async()=>true,now:clock.now,modelConfigured:true});const base=await app.listen({host:'127.0.0.1',port:0});
const timers=[setInterval(()=>{void manager.tick();},500),setInterval(()=>{void service.tick();},500)];
const evidence:{id:string;startedAt:string;finishedAt?:string;status:string;job?:DevelopmentJob;cancelledJob?:DevelopmentJob;events?:EngineeringEvent[];commands?:CommandResult[];files?:unknown[];error?:string}={id,startedAt:clock.now(),status:'running'};
try{
 const login=await fetch(base+'/api/auth/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie')!.split(';')[0]!;const csrf=(await login.json() as {csrfToken:string}).csrfToken;
 async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{const response=await fetch(base+path,{method,signal:AbortSignal.timeout(45000),headers:{cookie,origin,'x-csrf-token':csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,`HTTP_${response.status}_${path}`);return response.json() as Promise<T>;}
 const draft=await drafts.create({...draftInput,name:'真实 OpenCode Tool/Skill 生成验证',brief:{...draftInput.brief,goal:{value:'按设备编号查询模拟设备状态和温度',source:'user',confirmed:true},output:{value:'设备状态报告',source:'user',confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});const preview=await baselines.preview(draft.id,'equipment-read@1');const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});
 const body={clientRequestId:randomUUID(),baselineId:baseline.id,generation:equipmentGenerationRequest,maxSeconds:900};
 const job=await api<DevelopmentJob>(`/api/snapshots/${snapshot.id}/development`,'POST',body);assert.equal((await api<DevelopmentJob>(`/api/snapshots/${snapshot.id}/development`,'POST',body)).id,job.id);
 console.log(JSON.stringify({stage:'admitted',probeId:id,jobId:job.id}));let last='';const deadline=Date.now()+960000;
 if(process.argv.includes('--cancel-only')){
  const startedDeadline=Date.now()+60000;let sessionId:string|undefined;
  while(Date.now()<startedDeadline){try{const session=JSON.parse(await readFile(join(root,'runner/tasks',job.id,'workspace/control/tester-session.json'),'utf8')) as {sessionId:string};sessionId=session.sessionId;if(sessionId)break;}catch{}await delay(100);}
  assert.ok(sessionId);await delay(500);await api(`/api/development/${job.id}/cancel`,'POST',{});
  while(Date.now()<startedDeadline+30000){evidence.job=await api<DevelopmentJob>(`/api/development/${job.id}`);if(evidence.job.status==='cancelled')break;await delay(250);}
  assert.equal(evidence.job?.status,'cancelled');assert.equal((await manager.get(job.id)).status,'cancelled');evidence.status='passed-live-management-cancellation';console.log(JSON.stringify({stage:'cancelled',id,jobId:job.id,sessionId}));
 }else{
 while(Date.now()<deadline){const current=await api<DevelopmentJob>(`/api/development/${job.id}`);evidence.job=current;const state=JSON.stringify({status:current.status,roles:current.roles});if(state!==last){console.log(JSON.stringify({stage:'progress',jobId:job.id,...JSON.parse(state)}));last=state;}
  if(['built','failed','cancelled','reconciling'].includes(current.status))break;await delay(1000);
 }
 assert.equal(evidence.job!.status,'built');assert.ok(evidence.job!.bundle);assert.equal(evidence.job!.roles.length,2);assert.notEqual(evidence.job!.roles[0]!.sessionId,evidence.job!.roles[1]!.sessionId);
 evidence.events=(await api<{items:EngineeringEvent[]}>(`/api/development/${job.id}/events`)).items;
 evidence.commands=[];for(const event of evidence.events.filter(event=>event.type==='command.completed'))evidence.commands.push(await api<CommandResult>(`/api/development/${job.id}/commands/${String(event.data.id)}`));
 const bundle=evidence.job!.bundle!;assert.equal(evidence.commands.find(c=>c.id===bundle.unitRedId)?.exitCode,1);for(const commandId of [bundle.unitGreenId,bundle.contractCheckId,bundle.buildId])assert.equal(evidence.commands.find(c=>c.id===commandId)?.exitCode,0);
 evidence.files=[];for(const file of bundle.files.filter(file=>file.path!=='component.jar')){const actual=await api<{path:string;content:string;digest:string}>(`/api/development/${job.id}/file?path=${encodeURIComponent(file.path)}`);assert.equal(createHash('sha256').update(actual.content).digest('hex'),file.digest);evidence.files.push(actual);}
 const cancel=await api<DevelopmentJob>(`/api/snapshots/${snapshot.id}/development`,'POST',{...body,clientRequestId:randomUUID()});
 const cancelDeadline=Date.now()+60000;while(Date.now()<cancelDeadline){const current=await api<DevelopmentJob>(`/api/development/${cancel.id}`);if(current.roles.some(role=>role.status==='running'))break;await delay(500);}
 await api(`/api/development/${cancel.id}/cancel`,'POST',{});while(Date.now()<cancelDeadline+30000){evidence.cancelledJob=await api<DevelopmentJob>(`/api/development/${cancel.id}`);if(evidence.cancelledJob.status==='cancelled')break;await delay(500);}assert.equal(evidence.cancelledJob?.status,'cancelled');assert.equal((await manager.get(cancel.id)).status,'cancelled');
 evidence.status='passed-generation-build-review-and-cancel';console.log(JSON.stringify({stage:'passed',id,bundleDigest:bundle.digest,cancelledJobId:cancel.id}));
 }
}catch(error){evidence.status='failed';evidence.error=error instanceof assert.AssertionError?error.message:error instanceof Error?error.name:'UNKNOWN_ERROR';console.log(JSON.stringify({stage:'failed',id,code:evidence.error}));process.exitCode=1;}
finally{
 timers.forEach(clearInterval);await manager.close();await app.close();await runner.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();
 evidence.finishedAt=clock.now();await mkdir('test-results/tdd-013',{recursive:true});await writeFile(join('test-results/tdd-013',`development-${id}.json`),JSON.stringify(evidence,null,2));
}
