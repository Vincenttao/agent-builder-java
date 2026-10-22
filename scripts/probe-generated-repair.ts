// Opt-in reproduction: seeded fixture defect -> real failed business report -> real OpenCode repair -> regression.
import {resolveOpenCodeExecutable} from '../apps/runner/src/engineering/engine-binary.js';
import assert from 'node:assert/strict';
import {EngineeringWorkspace} from '../apps/runner/src/engineering/workspace.js';
import type {TaskExecutor} from '../apps/runner/src/engineering/task-executor.js';
import {generatedUnit,generatedSkill} from '../tests/support/generated-equipment.js';
import {defectiveTool} from '../tests/support/repair-context.js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
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
import {JavaDeploymentManager} from '../apps/runner/src/runtime/deployment-manager.js';
import {ExecutionJournal} from '../apps/runner/src/executions/journal.js';
import {createRunnerApp} from '../apps/runner/src/app.js';
import {createApp} from '../apps/server/src/app.js';
import {createMockApp} from '../apps/mock-services/src/app.js';
import {MockRepository} from '../apps/mock-services/src/repository.js';
import {HttpMock,HttpRunner} from '../apps/server/src/runs/http-ports.js';
import {RunService} from '../apps/server/src/runs/run-service.js';
import {PostgresActions} from '../apps/server/src/actions/postgres-actions.js';
import {InvocationService} from '../apps/server/src/invocations/invocation-service.js';
import {CandidateService} from '../apps/server/src/candidates/candidate-service.js';
import {TestDeploymentService} from '../apps/server/src/candidates/test-deployment-service.js';
import {equipmentAssembly} from '../packages/contracts/src/equipment-template.js';
import {equipmentGenerationRequest} from '../packages/contracts/src/generation-profile.js';
import {contentDigest} from '../apps/server/src/snapshots/domain/assembly.js';
import type {DevelopmentJob} from '../packages/contracts/src/development.js';
import type {Candidate,TestDeployment} from '../packages/contracts/src/candidates.js';
import type {InvocationView} from '../packages/contracts/src/invocations.js';
import {ValidationService} from '../apps/server/src/acceptance/application/validation-service.js';
import {RunValidationDriver} from '../apps/server/src/acceptance/adapters/run-validation-driver.js';
import {CandidateValidationDriver} from '../apps/server/src/acceptance/adapters/candidate-validation-driver.js';
import {TestApiClient} from '../apps/server/src/acceptance/adapters/test-api-client.js';
import {ValidationLeaseTokens} from '../apps/server/src/shared/validation-lease-tokens.js';
import {ReleaseService} from '../apps/server/src/releases/release-service.js';
import {ProjectReleaseGate} from '../apps/server/src/releases/project-release-gate.js';
import {ProjectReleaseDriver} from '../apps/server/src/releases/project-release-driver.js';
import type {ValidationExecution,ValidationReport} from '../packages/contracts/src/validations.js';
import type {ReleaseOperation,ReleaseOverview} from '../packages/contracts/src/releases.js';
import {draftInput} from '../tests/support/fixtures.js';
if(process.env.RUN_LIVE_E2E!=='1'||!process.env.DEEPSEEK_API_KEY)throw new Error('Explicit live opt-in and local model credentials required');
const id=randomUUID(),root=resolve('.cache/generated-repair-live',id);await mkdir(root,{recursive:true});
const suffix=id.replaceAll('-',''),schema=`live_repair_${suffix}`,mockSchema=`live_repair_mock_${suffix}`;
const database=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin=new Pool({connectionString:database}),pool=new Pool({connectionString:database,options:`-c search_path=${schema}`}),mockPool=new Pool({connectionString:database,options:`-c search_path=${mockSchema}`});
await admin.query(`CREATE SCHEMA "${schema}"`);await admin.query(`CREATE SCHEMA "${mockSchema}"`);await migrate(pool);await migrate(mockPool,'db/mock-migrations');
const clock={now:()=>new Date().toISOString()},ids={next:randomUUID},token=randomUUID()+randomUUID(),origin='http://127.0.0.1:8080';
const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids),snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids),baselines=new BaselineService(pool,clock,ids);
const mockControlToken=randomUUID()+randomUUID(),mockBusinessToken=randomUUID()+randomUUID();
const mockApp=createMockApp({repository:new MockRepository(mockPool),controlToken:mockControlToken,businessToken:mockBusinessToken});const mockBase=await mockApp.listen({host:'127.0.0.1',port:0});const mock=new HttpMock(mockBase,mockControlToken,mockBusinessToken);
let runnerPort:HttpRunner,engineeringPort:HttpEngineering;
const runtimePort=new Proxy({} as HttpRunner,{get:(_target,key)=>{const value=runnerPort[key as keyof HttpRunner];return typeof value==='function'?value.bind(runnerPort):value;}});
const developmentPort=new Proxy({} as HttpEngineering,{get:(_target,key)=>{const value=engineeringPort[key as keyof HttpEngineering];return typeof value==='function'?value.bind(engineeringPort):value;}});
const runs=new RunService(pool,snapshots,runtimePort,mock),actions=new PostgresActions(pool),invocations=new InvocationService(pool,snapshots,runs,runtimePort,actions,mock);
const candidates=new CandidateService(pool,snapshots,runtimePort,baselines),targets=new TestDeploymentService(pool,candidates,baselines,snapshots,runs,runtimePort,mock);

let localBase='';const validationLeaseTokens=new ValidationLeaseTokens();
const validationDriver=new CandidateValidationDriver(new RunValidationDriver(runs,mock,actions),candidates,runtimePort,mock,runs,actions,new TestApiClient(()=>localBase,origin,token,validationLeaseTokens));
const validations=new ValidationService(pool,baselines,snapshots,validationDriver,clock,candidates);
const development=new DevelopmentService(pool,snapshots,baselines,developmentPort,{validations,candidates});
const releases=new ReleaseService(pool,new ProjectReleaseGate(validations,baselines,snapshots,validationDriver,candidates),new ProjectReleaseDriver(pool,snapshots,baselines,validations,runs,runtimePort,mock,actions));
const app=createApp({validations,releases,validationLeaseTokens,drafts,snapshots,baselines,development,runs,invocations,candidates,testDeployments:targets,bootstrapToken:token,origin,databaseReady:async()=>true,now:clock.now,modelConfigured:true,toolProxy:{token,context:session=>runs.context(session),invoke:mock.invoke.bind(mock)}});
const ingressCalls:{method:string;path:string}[]=[];app.addHook('onRequest',async request=>{if(request.url.startsWith('/test-api/')||request.url.startsWith('/agent-api/'))ingressCalls.push({method:request.method,path:request.url});});
const base=await app.listen({host:'127.0.0.1',port:0});localBase=base;
const sdkJar=resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar');
const runtime=new JavaDeploymentManager({root:join(root,'runner'),artifactPath:sdkJar,modelKey:process.env.DEEPSEEK_API_KEY!,proxyBase:base+'/internal/tool-proxy',proxyToken:token});await runtime.initialize();
// Only the initial candidate uses a deliberately defective fixture. Repair uses real OpenCode.
const manager=new EngineeringTaskManager(join(root,'engineering'),directory=>{
 let active:TaskExecutor|undefined;let workspace:EngineeringWorkspace|undefined;
 return {run:async(input,onEvent,onRole)=>{
  if(input.context.repair){active=new OpenCodeTaskExecutor({root:directory,sdkJar,executable:resolveOpenCodeExecutable(),modelKey:process.env.DEEPSEEK_API_KEY!});return active.run(input,onEvent,onRole);}
  workspace=new EngineeringWorkspace(directory,sdkJar,input.context,onEvent);await workspace.initialize();
  await onRole('tester','running');await workspace.write('tester','tests/plan.json',JSON.stringify({baselineDigest:input.context.baseline.digest,cases:input.context.baseline.content.cases.map(c=>({caseId:c.id,requirementIds:c.requirementIds,assertions:c.assertions,steps:['Invoke fixed candidate through test-api','Check external API result against output']}))}));await onRole('tester','completed');
  await onRole('developer','running');await workspace.write('developer','test/generated/EquipmentToolTest.java',generatedUnit);assert.equal((await workspace.run('developer','unit-test')).status,'failed');
  await workspace.write('developer','src/generated/EquipmentTool.java',defectiveTool);await workspace.write('developer','skills/equipment-query/SKILL.md',generatedSkill);assert.equal((await workspace.run('developer','unit-test')).status,'passed');assert.equal((await workspace.run('developer','build')).status,'passed');await onRole('developer','completed');await workspace.cancel();return workspace.inspect().bundle!;
 },cancel:async()=>{await active?.cancel();await workspace?.cancel();}};
});await manager.initialize();
const journal=new ExecutionJournal(join(root,'executions'),runtime);await journal.initialize();const runner=createRunnerApp({token,runtime,journal,engineering:manager,modelConfigured:true});const runnerBase=await runner.listen({host:'127.0.0.1',port:0});runnerPort=new HttpRunner(runnerBase,token);engineeringPort=new HttpEngineering(runnerBase,token);
const workers=new Set<Promise<void>>();const timers=[manager,development,targets,invocations,runs,validations,releases].map(service=>setInterval(()=>{const task=service.tick().catch(()=>{console.log(JSON.stringify({stage:'worker-retry'}));}).finally(()=>workers.delete(task));workers.add(task);},500));
const evidence:Record<string,unknown>={id,startedAt:clock.now(),status:'running',scope:'Initial implementation is an explicit seeded-defect fixture; repair developer and business Agent use real DeepSeek. Fixed tester plan is reused; PostgreSQL Mock business data.'};
try{
 const login=await fetch(base+'/api/auth/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0]!;const csrf=(await login.json() as {csrfToken:string}).csrfToken;
 async function api<T>(path:string,method='GET',body?:unknown,authorization?:string):Promise<T>{const response=await fetch(base+path,{method,signal:AbortSignal.timeout(90000),headers:authorization?{authorization,'content-type':'application/json'}:{cookie,origin,'x-csrf-token':csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,`HTTP_${response.status}_${path}`);return response.json() as Promise<T>;}
 const draft=await drafts.create({...draftInput,name:'生成候选真实运行验证',brief:{...draftInput.brief,goal:{value:'通过生成 Tool 和 Skill 查询模拟设备状态及温度',source:'user',confirmed:true},output:{value:'设备状态报告',source:'user',confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:{...equipmentAssembly(),systemPrompt:equipmentAssembly().systemPrompt+' 每次设备查询先调用 skill_tool 读取 equipment-query 的 SKILL.md，再按 Skill 使用 get_equipment。'}});
 const preview=await baselines.preview(draft.id,'equipment-read@1');const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});evidence.snapshot=snapshot;evidence.baseline=baseline;
 async function awaitJob(job:DevelopmentJob){
  let current=job,last='';const deadline=Date.now()+960000;
  while(Date.now()<deadline){current=await api<DevelopmentJob>(`/api/development/${job.id}`);evidence.currentJob=current;const state=JSON.stringify({status:current.status,roles:current.roles});if(state!==last){console.log(JSON.stringify({stage:'development',id,jobId:job.id,...JSON.parse(state)}));last=state;}if(['built','failed','cancelled','reconciling'].includes(current.status))break;await delay(1000);}
  assert.equal(current.status,'built');assert.ok(current.bundle);return current;
 }
 async function validate(candidate:Candidate){
  const execution=await api<ValidationExecution>(`/api/snapshots/${snapshot.id}/validations`,'POST',{clientRequestId:randomUUID(),baselineId:baseline.id,allowMockWrites:false,candidateId:candidate.id});
  let current=execution,done=-1;const deadline=Date.now()+600000;
  while(Date.now()<deadline){current=await api<ValidationExecution>(`/api/validations/${execution.id}`);evidence.currentValidation=current;if(current.results.length!==done){done=current.results.length;console.log(JSON.stringify({stage:'validation',id,executionId:execution.id,results:current.results.map(c=>({caseId:c.caseId,status:c.status,reasons:c.reasons}))}));}if(current.status==='completed')break;await delay(500);}
  assert.equal(current.status,'completed');const report=await api<ValidationReport>(`/api/validations/${execution.id}/report`);return{execution:current,report,evidence:await Promise.all(report.cases.map(c=>c.evidenceId?validations.evidence(execution.id,c.evidenceId):null))};
 }
 const original=await awaitJob(await api<DevelopmentJob>(`/api/snapshots/${snapshot.id}/development`,'POST',{clientRequestId:randomUUID(),baselineId:baseline.id,generation:equipmentGenerationRequest,maxSeconds:900}));evidence.original=original;
 const oldCandidate=await api<Candidate>('/api/candidates','POST',{snapshotId:snapshot.id,developmentJobId:original.id});evidence.oldCandidate=oldCandidate;
 const failure=await validate(oldCandidate);evidence.failure=failure;assert.equal(failure.report.verdict,'failed');assert.equal(failure.report.cases.find(c=>c.caseId==='TC-001')?.assertions.find(a=>a.ruleId==='equipment-facts')?.status,'failed');
 const request={clientRequestId:randomUUID(),baselineId:baseline.id,generation:equipmentGenerationRequest,maxSeconds:900,repairExecutionId:failure.execution.id};
 const job=await api<DevelopmentJob>(`/api/snapshots/${snapshot.id}/development`,'POST',request);assert.deepEqual(await api<DevelopmentJob>(`/api/snapshots/${snapshot.id}/development`,'POST',request),job);
 const current=await awaitJob(job);evidence.repair=current;assert.equal(current.repair?.parentJobId,original.id);assert.equal(current.bundle!.planDigest,original.bundle!.planDigest);assert.notEqual(current.bundle!.digest,original.bundle!.digest);assert.equal(current.roles.find(r=>r.role==='tester')?.status,'reused');assert.ok(!current.roles.find(r=>r.role==='tester')?.sessionId);
 evidence.engineeringEvents=await development.events(job.id);
 const candidate=await api<Candidate>('/api/candidates','POST',{snapshotId:snapshot.id,developmentJobId:job.id});evidence.candidate=candidate;assert.notEqual(candidate.artifactDigest,oldCandidate.artifactDigest);
 const regression=await validate(candidate);evidence.regression=regression;const validation=regression.execution,report=regression.report;
 assert.equal(report.verdict,'passed');assert.equal(report.binding.artifactDigest,candidate.artifactDigest);assert.equal(report.binding.candidate?.id,candidate.id);assert.equal(report.binding.candidate?.testPlanDigest,current.bundle!.planDigest);assert.equal(report.cases.length,3);
 assert.deepEqual(await validations.report(failure.execution.id),failure.report);
 await assert.rejects(()=>releases.start(draft.id,{clientRequestId:randomUUID(),snapshotId:snapshot.id,validationId:failure.execution.id,expectedRevision:0}));
 const release=await api<ReleaseOperation>(`/api/drafts/${draft.id}/releases`,'POST',{clientRequestId:randomUUID(),snapshotId:snapshot.id,validationId:validation.id,expectedRevision:0});evidence.release=release;
 console.log(JSON.stringify({stage:'release-started',id,releaseId:release.id}));let releaseState=release;const releaseDeadline=Date.now()+240000;
 while(Date.now()<releaseDeadline){releaseState=await api<ReleaseOperation>(`/api/releases/${release.id}`);evidence.release=releaseState;if(['succeeded','failed'].includes(releaseState.status))break;await delay(500);}assert.equal(releaseState.status,'succeeded');assert.equal(releaseState.reference.binding.artifactDigest,candidate.artifactDigest);
 const published=await api<ReleaseOverview>(`/api/drafts/${draft.id}/releases`);evidence.published=published;assert.equal(published.pointer?.versionId,release.versionId);
 const demo=await api<{token:string;environmentId:string}>('/api/demo-sessions','POST',{agentId:draft.id,actorId:'U1002'});
 const businessGrant=`Bearer ${demo.token}`;const sent=await api<InvocationView>(`/agent-api/agents/${draft.id}/messages`,'POST',{clientRequestId:randomUUID(),input:'查询 PUMP-001 的状态、温度和来源，输出设备报告。'},businessGrant);let business=sent;const businessDeadline=Date.now()+150000;
 while(Date.now()<businessDeadline){business=await api<InvocationView>(`/agent-api/requests/${sent.requestId}`,'GET',undefined,businessGrant);evidence.business=business;if(business.run&&['succeeded','failed','cancelled','interrupted'].includes(business.run.status))break;await delay(500);}
 assert.equal(business.run?.status,'succeeded');assert.equal(business.agentVersion,release.versionId);assert.equal(business.run?.artifactDigest,candidate.artifactDigest);assert.equal(business.run?.actorId,'U1002');assert.equal(business.run?.externalEvidence.length,1);evidence.businessEvents=await runs.events(sent.runId,0);evidence.ingressCalls=ingressCalls;
 evidence.status='passed-seeded-defect-live-repair-regression-publication';console.log(JSON.stringify({stage:'passed',id,jobId:job.id,candidateId:candidate.id}));
}catch(error){evidence.status='failed';evidence.error=error instanceof assert.AssertionError?error.message:error instanceof Error?error.name:'UNKNOWN';console.log(JSON.stringify({stage:'failed',id,code:evidence.error}));process.exitCode=1;}
finally{
 timers.forEach(clearInterval);await manager.close();await Promise.allSettled([...workers]);await runtime.shutdown();await journal.drain();await runner.close();await app.close();await mockApp.close();await pool.end();await mockPool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.query(`DROP SCHEMA "${mockSchema}" CASCADE`);await admin.end();
 evidence.finishedAt=clock.now();await mkdir('test-results/tdd-016',{recursive:true});await writeFile(join('test-results/tdd-016',`live-repair-${id}.json`),JSON.stringify(evidence,null,2));
}
