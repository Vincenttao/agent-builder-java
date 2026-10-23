import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { MockRepository } from '../../apps/mock-services/src/repository.js';
import { createMockApp } from '../../apps/mock-services/src/app.js';
import { createApp } from '../../apps/server/src/app.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { RunService } from '../../apps/server/src/runs/run-service.js';
import { HttpMock, HttpRunner } from '../../apps/server/src/runs/http-ports.js';
import { JavaDeploymentManager } from '../../apps/runner/src/runtime/deployment-manager.js';
import { ExecutionJournal } from '../../apps/runner/src/executions/journal.js';
import { createRunnerApp } from '../../apps/runner/src/app.js';
import { draftInput } from '../support/fixtures.js';
import type { RunRecord } from '../../packages/contracts/src/runs.js';
import { ReleaseService } from '../../apps/server/src/releases/release-service.js';
import {ProjectReleaseDriver} from '../../apps/server/src/releases/project-release-driver.js';
import {BaselineService} from '../../apps/server/src/acceptance/application/baseline-service.js';
import {PostgresActions} from '../../apps/server/src/actions/postgres-actions.js';
import {equipmentAssembly} from '../../packages/contracts/src/equipment-template.js';
import {InvocationService} from '../../apps/server/src/invocations/invocation-service.js';
import type {InvocationView} from '../../packages/contracts/src/invocations.js';
import {CandidateService} from '../../apps/server/src/candidates/candidate-service.js';
import {TestDeploymentService} from '../../apps/server/src/candidates/test-deployment-service.js';
import {contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
import type {Candidate,TestDeployment} from '../../packages/contracts/src/candidates.js';
import {EngineeringTaskManager} from '../../apps/runner/src/engineering/task-manager.js';
import {EngineeringWorkspace} from '../../apps/runner/src/engineering/workspace.js';
import {DevelopmentService} from '../../apps/server/src/development/development-service.js';
import {HttpEngineering} from '../../apps/server/src/development/http-engineering.js';
import {equipmentGenerationRequest} from '../../packages/contracts/src/generation-profile.js';
import {generatedUnit,generatedTool,generatedSkill} from '../support/generated-equipment.js';
import {ValidationService} from '../../apps/server/src/acceptance/application/validation-service.js';
import {RunValidationDriver} from '../../apps/server/src/acceptance/adapters/run-validation-driver.js';
import {CandidateValidationDriver} from '../../apps/server/src/acceptance/adapters/candidate-validation-driver.js';
import {TestApiClient} from '../../apps/server/src/acceptance/adapters/test-api-client.js';
import {ValidationLeaseTokens} from '../../apps/server/src/shared/validation-lease-tokens.js';
import {ProjectReleaseGate} from '../../apps/server/src/releases/project-release-gate.js';

const live = process.env.LIVE_PLATFORM_MODEL === 'true';
if (live && !process.env.DEEPSEEK_API_KEY) throw new Error('Live model key required');
let holdModel = false; let heldCalls = 0;let totalModelCalls=0;
const model = createServer(async (req, res) => {
  totalModelCalls++;
  let body = ''; for await (const bytes of req) body += bytes;
  if (holdModel) { heldCalls++; return; }
  const request = JSON.parse(body) as { messages: { role: string;content?:string }[] };
  const missing=request.messages.filter(m=>m.role==='user').at(-1)?.content==='请查询设备状态。';
  const failed=request.messages.some(m=>m.role==='tool'&&/TOOL_UNAVAILABLE|TOOL_TIMEOUT/.test(m.content??''));
  if(missing||failed){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'case-fixture',model:'fixture',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(missing?{kind:'clarification',missingFields:['equipmentId'],message:'请提供设备编号'}:{kind:'tool-error',code:'TOOL_UNAVAILABLE',message:'工具不可用'})},finish_reason:'stop'}]}));return;}
  const hasSkill=body.includes('"name":"skill_tool"');
  const used = request.messages.filter(message => message.role === 'tool').length >= (hasSkill?2:1);
  if(hasSkill&&!request.messages.some(message=>message.role==='tool')){
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'skill-fixture',model:'fixture',choices:[{index:0,message:{role:'assistant',content:'',tool_calls:[{id:'call-skill',type:'function',function:{name:'skill_tool',arguments:'{"skill_name":"equipment-query"}'}}]},finish_reason:'tool_calls'}]}));return;
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'deterministic-model', model: 'fixture',
    choices: [{ index: 0, message: used ? { role: 'assistant', content: JSON.stringify({kind:'equipment-report',equipmentId:'PUMP-001',status:'warning',temperatureCelsius:body.includes('BAD_SMOKE_OUTPUT')?0:86,source:'seed-equipment-001@1',recommendation:body.includes('VERSION_TWO')?'版本二建议':body.includes('VERSION_ONE')?'版本一建议':'检查设备温度告警'}) } : { role: 'assistant', content: null, tool_calls: [{ id: 'call-equipment', type: 'function', function: { name: 'get_equipment', arguments: '{"equipmentId":"PUMP-001"}' } }] }, finish_reason: used ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
});
it.skipIf(live)('cancels a blocked native model wait before retiring the dedicated JVM with zero external tool calls', async () => {
  holdModel = true;
  try {
    const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { ...draftInput.brief.output, confirmed: true } } });
    const snapshot = await snapshots.create(draft.id, { expectedRevision: 1, assembly: { agentType: 'DeepAgent', systemPrompt: '查询设备', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] } });
    const run = await runs.create(snapshot.id, { clientRequestId: randomUUID(), input: '查询 PUMP-001' }); await runs.tick();
    const deadline = Date.now() + 10000;
    while (heldCalls === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    expect(heldCalls).toBe(1);
    expect((await runs.cancel(run.id)).status).toBe('cancelling');
    // Completion requires the native invocation to return, not merely cancellation admission.
    await expect.poll(async () => { await runs.tick(); return (await runs.get(run.id)).status; }, { timeout: 10000 }).toBe('cancelled');
    const cancelled = await runs.get(run.id);
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.externalEvidence).toEqual([]);
    expect((await runtime.get(run.deploymentId)).status).toBe('stopped');
    await writeFile(resolve(root, 'cancel-evidence.json'), JSON.stringify({ run: cancelled, events: await runs.events(run.id, 0), deployment: await runtime.get(run.deploymentId) }, null, 2));
  } finally { holdModel = false; }
});
const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const suffix = randomUUID().replaceAll('-', ''); const schema = `it_platform_${suffix}`; const mockSchema = `it_business_${suffix}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
const mockPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${mockSchema}` });
const clock = { now: () => new Date().toISOString() }; const ids = { next: randomUUID };
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids);
const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids);
const mockApp = createMockApp({ repository: new MockRepository(mockPool), controlToken: 'mock-control-test-01234567890123', businessToken: 'mock-service-test-01234567890123' });
let platform: ReturnType<typeof createApp>; let runnerApp: ReturnType<typeof createRunnerApp>; let runtime: JavaDeploymentManager; let runs: RunService;
let mock:HttpMock;let runnerPort:HttpRunner;let invocations:InvocationService;
let candidates:CandidateService;let testDeployments:TestDeploymentService;
let engineering:EngineeringTaskManager;let development:DevelopmentService;
let validations:ValidationService;let validationDriver:CandidateValidationDriver;const ingressCalls:{method:string;path:string}[]=[];
const root = resolve('test-results', `platform-${Date.now()}`);
beforeAll(async () => {
  await mkdir(root, { recursive: true }); await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`CREATE SCHEMA "${mockSchema}"`);
  await migrate(pool); await migrate(mockPool, 'db/mock-migrations');
  await new Promise<void>(r => model.listen(0, '127.0.0.1', r));
  const address = model.address(); if (!address || typeof address === 'string') throw new Error('MODEL_PORT');
  const mockBase = await mockApp.listen({ host: '127.0.0.1', port: 0 });
  mock = new HttpMock(mockBase, 'mock-control-test-01234567890123', 'mock-service-test-01234567890123');
  // HTTP ports are resolved before the first request. No business data goes through in-memory doubles.
  const runtimePort = new Proxy({} as HttpRunner, { get: (_target, key) => { const value = runnerPort[key as keyof HttpRunner]; return typeof value === 'function' ? value.bind(runnerPort) : value; } });
  runs = new RunService(pool, snapshots, runtimePort, mock);
  invocations=new InvocationService(pool,snapshots,runs,runtimePort,new PostgresActions(pool),mock);
  const baselines=new BaselineService(pool,clock,ids);
  candidates=new CandidateService(pool,snapshots,runtimePort,baselines);
  testDeployments=new TestDeploymentService(pool,candidates,baselines,snapshots,runs,runtimePort,mock);
  let testApiBase='';const validationLeaseTokens=new ValidationLeaseTokens();const validationActions=new PostgresActions(pool);
  validationDriver=new CandidateValidationDriver(new RunValidationDriver(runs,mock,validationActions),candidates,runtimePort,mock,runs,validationActions,new TestApiClient(()=>testApiBase,'http://127.0.0.1:8080','bootstrap-platform-test-0123456789',validationLeaseTokens));
  validations=new ValidationService(pool,baselines,snapshots,validationDriver,clock,candidates);
  platform = createApp({ drafts, snapshots, runs, invocations, candidates, testDeployments,validations,validationLeaseTokens, now: clock.now, bootstrapToken: 'bootstrap-platform-test-0123456789', origin: 'http://127.0.0.1:8080', modelConfigured: true, databaseReady: async () => true,
    toolProxy: { token: 'proxy-platform-test-0123456789', context: id => runs.context(id), invoke: mock.invoke.bind(mock) } });
  platform.addHook('onRequest',async request=>{if(request.url.startsWith('/test-api/'))ingressCalls.push({method:request.method,path:request.url});});
  const base = await platform.listen({ host: '127.0.0.1', port: 0 });testApiBase=base;
  runtime = new JavaDeploymentManager({ root: resolve(root, 'runner'), artifactPath: resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),
    modelKey: live ? process.env.DEEPSEEK_API_KEY! : 'fixture-key', modelBase: live ? 'https://api.deepseek.com/v1' : `http://127.0.0.1:${address.port}/v1`, proxyBase: `${base}/internal/tool-proxy`, proxyToken: 'proxy-platform-test-0123456789' });
  await runtime.initialize(); const journal = new ExecutionJournal(resolve(root, 'executions'), runtime); await journal.initialize();
  engineering=new EngineeringTaskManager(resolve(root,'engineering'),directory=>{
    let ws:EngineeringWorkspace|undefined;
    return{run:async(input,emit,role)=>{
      ws=new EngineeringWorkspace(directory,resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),input.context,emit);await ws.initialize();
      await role('tester','running','fixture-test-session');await ws.write('tester','tests/plan.json',JSON.stringify({baselineDigest:input.context.baseline.digest,cases:input.context.baseline.content.cases.map(c=>({caseId:c.id,requirementIds:c.requirementIds,assertions:c.assertions,steps:['Invoke fixed candidate','Check external evidence']}))}));await role('tester','completed');
      await role('developer','running','fixture-developer-session');await ws.write('developer','test/generated/EquipmentToolTest.java',generatedUnit);expect((await ws.run('developer','unit-test')).status).toBe('failed');
      await ws.write('developer','src/generated/EquipmentTool.java',generatedTool);await ws.write('developer','skills/equipment-query/SKILL.md',generatedSkill);expect((await ws.run('developer','unit-test')).status).toBe('passed');expect((await ws.run('developer','build')).status).toBe('passed');await role('developer','completed');return ws.inspect().bundle!;
    },cancel:async()=>{await ws?.cancel();}};
  });await engineering.initialize();
  runnerApp = createRunnerApp({ token: 'runner-control-test-0123456789', runtime, journal, engineering, modelConfigured: true });
  const runnerBase=await runnerApp.listen({ host: '127.0.0.1', port: 0 });runnerPort = new HttpRunner(runnerBase, 'runner-control-test-0123456789');
  development=new DevelopmentService(pool,snapshots,baselines,new HttpEngineering(runnerBase,'runner-control-test-0123456789'));
});
afterAll(async () => {
  await engineering?.close();await runtime?.shutdown(); await runnerApp?.close(); await platform?.close(); await mockApp.close(); await new Promise<void>(r => model.close(() => r()));
  await pool.end(); await mockPool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.query(`DROP SCHEMA "${mockSchema}" CASCADE`); await admin.end();
});
it.skipIf(live)('generated Tool and Skill reach the unpublished test API through real packaging, JVM, trusted proxy and PostgreSQL evidence',async()=>{
 const baselines=new BaselineService(pool,clock,ids);
 const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{...draftInput.brief.output,confirmed:true}}});
 const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:{...equipmentAssembly(),systemPrompt:'Read equipment-query Skill first, then get_equipment. Report temperatureCelsius and source from actual tool response.'}});
 const preview=await baselines.preview(draft.id,'equipment-read@1');const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});
 const job=await development.start(snapshot.id,{clientRequestId:randomUUID(),baselineId:baseline.id,generation:{...equipmentGenerationRequest,scope:[...equipmentGenerationRequest.scope],dependencies:[...equipmentGenerationRequest.dependencies]},maxSeconds:120});
 await development.tick();await engineering.tick();await expect.poll(async()=>{await development.tick();return(await development.get(job.id)).status;},{timeout:75000}).toBe('built');
 const login=await platform.inject({method:'POST',url:'/api/auth/session',headers:{origin:'http://127.0.0.1:8080'},payload:{token:'bootstrap-platform-test-0123456789'}});
 const management={origin:'http://127.0.0.1:8080',cookie:login.headers['set-cookie']!.toString().split(';')[0]!,'x-csrf-token':login.json().csrfToken as string};
 const registration=await platform.inject({method:'POST',url:'/api/candidates',headers:management,payload:{snapshotId:snapshot.id,developmentJobId:job.id}});expect(registration.statusCode,registration.body).toBe(201);
 const candidate=registration.json<Candidate>();expect(candidate.provenance).toBe('generated-component');expect(candidate.artifactDigest).not.toBe(runtime.artifactDigest);
 const targetResponse=await platform.inject({method:'POST',url:'/api/test-deployments',headers:management,payload:{clientRequestId:randomUUID(),candidateId:candidate.id,requirementBaselineId:baseline.id,suiteDigest:contentDigest(baseline.content.cases),purpose:'test',ttlSeconds:3600}});expect(targetResponse.statusCode,targetResponse.body).toBe(202);
 const target=targetResponse.json<TestDeployment>();await testDeployments.tick();expect((await testDeployments.get(target.id)).status).toBe('ready');
 const grant=await platform.inject({method:'POST',url:`/api/test-deployments/${target.id}/sessions`,headers:management,payload:{actorId:'U1002'}});expect(grant.statusCode).toBe(201);
 const headers={authorization:`Bearer ${grant.json().token}`};const api=`/test-api/deployments/${target.id}`;
 const sent=await platform.inject({method:'POST',url:api+'/messages',headers,payload:{clientRequestId:randomUUID(),input:'Read the equipment-query Skill, then query PUMP-001'}});expect(sent.statusCode,sent.body).toBe(202);const request=sent.json<InvocationView>();
 await expect.poll(async()=>{await invocations.tick();await runs.tick();return(await runs.get(request.runId)).status;},{timeout:30000}).toBe('succeeded');
 const result=(await platform.inject({url:`${api}/requests/${request.requestId}`,headers})).json<InvocationView>();
 expect(result.run).toMatchObject({artifactDigest:candidate.artifactDigest,actorId:'U1002',deploymentId:target.deploymentId});expect(result.run?.externalEvidence).toHaveLength(1);expect(result.run?.externalEvidence[0]).toMatchObject({actorId:'U1002',operation:'equipment-status',result:{temperatureCelsius:86}});
 const events=await runs.events(request.runId,0);expect(JSON.stringify(events)).toContain('generated_tool_invoked');expect(JSON.stringify(events)).toContain('skill_loaded');
 const loaded=await runtime.get(target.deploymentId);expect(loaded.generated?.developmentBundleDigest).toBe((await development.get(job.id)).bundle?.digest);
 await testDeployments.stop(target.id);await testDeployments.tick();expect((await runtime.get(target.deploymentId)).status).toBe('stopped');
 expect((await pool.query('SELECT * FROM release_pointers WHERE agent_id=$1',[draft.id])).rowCount).toBe(0);
 await writeFile(resolve(root,'generated-test-api-evidence.json'),JSON.stringify({scope:'Fixture source generator and model; real TDD commands, packaging, HTTP services, JVM, SDK Skill and PostgreSQL Mock',job:await development.get(job.id),candidate,target:await testDeployments.get(target.id),loaded,result,events},null,2));
 const validation=await validations.start(snapshot.id,{clientRequestId:randomUUID(),baselineId:baseline.id,allowMockWrites:false,candidateId:candidate.id});
 await expect.poll(async()=>{await validations.tick();await testDeployments.tick();await invocations.tick();await runs.tick();return(await validations.get(validation.id)).status;},{timeout:120000,interval:100}).toBe('completed');
 const report=await validations.report(validation.id);const evidence=await Promise.all(report.cases.map(c=>c.evidenceId?validations.evidence(validation.id,c.evidenceId):null));
 await writeFile(resolve(root,'generated-validation-evidence.json'),JSON.stringify({scope:'Real test-api, generated JVM and PostgreSQL; fixture generator/model; publication must remain blocked',candidate,report,evidence,ingressCalls},null,2));
 expect(report.cases.map(c=>({id:c.caseId,status:c.status,reasons:c.reasons}))).toEqual(baseline.content.cases.map(c=>({id:c.id,status:'passed',reasons:[]})));
 expect(report.verdict).toBe('unverified');expect(report.reasons).toContain('REAL_MODEL_REQUIRED');expect(report.binding.candidate?.testPlanDigest).toBe((await development.get(job.id)).bundle?.planDigest);
 for(const proof of evidence){expect(proof?.candidateEvidence?.testDeployment.status).toBe('stopped');expect(proof?.candidateEvidence?.loadedManifest).toMatchObject({status:'stopped',artifactDigest:candidate.artifactDigest});expect(ingressCalls.filter(c=>c.method==='POST'&&c.path===`${proof!.candidateEvidence!.ingress}/messages`)).toHaveLength(1);}
 expect(new Set(evidence.map(e=>e?.candidateEvidence?.testDeployment.environmentId)).size).toBe(3);
 expect(evidence.map(e=>e?.candidateEvidence?.testDeployment.environmentConfig.fault)).toEqual(['normal','normal','read-timeout']);
 await expect(new ProjectReleaseGate(validations,baselines,snapshots,validationDriver,candidates).check(snapshot.id,validation.id)).rejects.toMatchObject({code:'REAL_EXECUTION_REQUIRED'});
},180000);
it.skipIf(live)('a replacement worker fences a delayed HTTP start before confirming native cancellation',async()=>{
  const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{...draftInput.brief.output,confirmed:true}}});
  const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly()});
  let entered!:()=>void;let release!:()=>void;const reached=new Promise<void>(r=>{entered=r;});const held=new Promise<void>(r=>{release=r;});
  const delayedPort=new Proxy(runnerPort,{get:(target,key)=>{
    if(key==='begin')return async(...args:Parameters<HttpRunner['begin']>)=>{entered();await held;return target.begin(...args);};
    const value=target[key as keyof HttpRunner];return typeof value==='function'?value.bind(target):value;
  }});
  const oldWorker=new RunService(pool,snapshots,delayedPort,mock);const replacement=new RunService(pool,snapshots,runnerPort,mock);
  const run=await oldWorker.create(snapshot.id,{clientRequestId:randomUUID(),input:'查询 PUMP-001'});const beforeCalls=totalModelCalls;const delayed=oldWorker.tick();
  try{
    await reached;expect((await runtime.get(run.deploymentId)).status).toBe('ready');
    await pool.query("UPDATE runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id]);
    await replacement.cancel(run.id);await replacement.tick();const cancelled=await replacement.get(run.id);expect(cancelled.status).toBe('cancelled');
    release();await delayed;expect(await replacement.get(run.id)).toEqual(cancelled);expect(totalModelCalls).toBe(beforeCalls);
    expect(await mock.calls(run.environmentId,run.id)).toEqual([]);expect((await runtime.get(run.deploymentId)).status).toBe('stopped');
    await expect(runnerPort.begin(run.id,{deploymentId:run.deploymentId,sessionId:run.id,message:run.input},'1')).rejects.toMatchObject({code:'EXECUTION_CLAIM_LOST'});
    await runnerPort.claim(run.id,'3');await expect(runnerPort.begin(run.id,{deploymentId:run.deploymentId,sessionId:run.id,message:run.input},'3')).rejects.toMatchObject({code:'EXECUTION_RETIRED'});
    await expect(mock.prepare(run.environmentId,run.id)).rejects.toMatchObject({code:'RUN_RESERVATION_RETIRED'});
    const nativeLeaseEvidence={modelMode:'deterministic-fixture',run:cancelled,events:await replacement.events(run.id,0),deployment:await runtime.get(run.deploymentId),modelCalls:totalModelCalls-beforeCalls,externalCalls:await mock.calls(run.environmentId,run.id),staleWorkerChangedTerminal:false};
    await writeFile(resolve(root,'native-lease-evidence.json'),JSON.stringify(nativeLeaseEvidence,null,2));
    const adapterJar=await readFile(resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'));
    await mkdir(resolve('docs/implementation/evidence'),{recursive:true});
    await writeFile(resolve('docs/implementation/evidence/TD15-NF06-managed-cancel-adapter.json'),JSON.stringify({
      schemaVersion:1,requirement:'TD-15/NF-06 AC-29a managed execution cancellation and stale-worker fencing',
      executionMode:'deterministic-fixture-adapter',scope:'subcriterion only; not full NF-06 or live Docker acceptance',measuredAt:new Date().toISOString(),
      adapterJarSha256:createHash('sha256').update(adapterJar).digest('hex'),testEvidence:nativeLeaseEvidence,
      assertions:{cancelledAfterReplacementWorker:true,noModelCallAfterCancel:totalModelCalls===beforeCalls,noExternalCalls:nativeLeaseEvidence.externalCalls.length===0,
        deploymentStopped:nativeLeaseEvidence.deployment.status==='stopped',staleWorkerDidNotChangeTerminal:!nativeLeaseEvidence.staleWorkerChangedTerminal,
        retiredRunRejected:true,retiredMockReservationRejected:true},verdict:'passed'
    },null,2)+'\n');
  }finally{release();await delayed;}
});
it('real platform HTTP → durable Run → Runner HTTP → Java Core/Runtime → trusted proxy → PostgreSQL Mock evidence', async () => {
  const login = await platform.inject({ method: 'POST', url: '/api/auth/session', headers: { origin: 'http://127.0.0.1:8080' }, payload: { token: 'bootstrap-platform-test-0123456789' } });
  const headers = { origin: 'http://127.0.0.1:8080', cookie: login.headers['set-cookie']!.toString().split(';')[0]!, 'x-csrf-token': login.json().csrfToken as string };
  const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { ...draftInput.brief.output, confirmed: true } } });
  const snapshot = await snapshots.create(draft.id, { expectedRevision: 1, assembly: { agentType: 'DeepAgent', systemPrompt: '必须使用 get_equipment 查询设备，按工具返回报告状态、温度和来源。', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] } });
  const payload = { clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态、温度与来源。' };
  const response = await platform.inject({ method: 'POST', url: `/api/snapshots/${snapshot.id}/runs`, headers, payload });
  expect(response.statusCode, response.body).toBe(202); let run = response.json<RunRecord>();
  const duplicate = await platform.inject({ method: 'POST', url: `/api/snapshots/${snapshot.id}/runs`, headers, payload }); expect(duplicate.json().id).toBe(run.id);
  await runs.tick();
  const deadline = Date.now() + 85000;
  while (['queued', 'running'].includes(run.status) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300)); await runs.tick(); run = await runs.get(run.id);
  }
  const events = await runs.events(run.id, 0); const deployment = await runtime.get(run.deploymentId);
  await writeFile(resolve(root, 'evidence.json'), JSON.stringify({ modelMode: live ? 'live-deepseek' : 'deterministic-fixture', run, events, deployment }, null, 2));
  expect(run.status, JSON.stringify(run)).toBe('succeeded'); expect(JSON.stringify(run.result)).toContain('86');
  expect(run.externalEvidence).toHaveLength(1); expect(run.externalEvidence[0]).toMatchObject({ runId: run.id, operation: 'equipment-status', status: 200, result: { temperatureCelsius: 86 } });
  expect(events.some(event => JSON.stringify(event.data).includes('before_tool_call'))).toBe(true);
  expect(deployment.status).toBe('stopped'); expect(run.artifactDigest).toBe(runtime.artifactDigest);
  expect((await platform.inject({ url: `/api/runs/${run.id}`, headers })).json()).toEqual(run);
  const after = events[0]!.seq;
  const stream = await platform.inject({ url: `/api/runs/${run.id}/events/stream`, headers: { ...headers, 'last-event-id': String(after) } });
  expect(stream.statusCode).toBe(200); expect(stream.headers['content-type']).toContain('text/event-stream');
  const replayed = stream.body.split('\n').filter(line => line.startsWith('id: ')).map(line => Number(line.slice(4)));
  expect(replayed).toEqual(events.filter(event => event.seq > after).map(event => event.seq));
});

it.skipIf(live)('shared Run lifecycle retains a real JVM across completion, cancellation and a later request', async () => {
  const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { ...draftInput.brief.output, confirmed: true } } });
  const snapshot = await snapshots.create(draft.id, { expectedRevision: 1, assembly: { agentType: 'DeepAgent', systemPrompt: '使用 get_equipment 查询设备并报告温度。', maxIterations: 4, railIds: ['audit@1','tool-allowlist@1'], toolIds: ['equipment-status@1'] } });
  // Publication admission and smoke are explicit fixtures here. This test proves the
  // real Run/JVM/Mock lifecycle, not product publication or live-model acceptance.
  const releases = new ReleaseService(pool, { check: async (snapshotId, validationId) => ({ agentId: draft.id, snapshotId, validationId,
    binding: { artifactDigest: runtime.artifactDigest, snapshotDigest: snapshot.digest, modelProfile: runtime.modelProfile,
      baselineDigest:'b'.repeat(64),testSetDigest:'c'.repeat(64),mockDigest:'d'.repeat(64),compatibilityKey:'e'.repeat(64) } }) }, {
    prepare: async op => { const ready = await runtime.start(op.deploymentId, snapshot.content.runtimeSpec, runtime.artifactDigest); return {ready:ready.status==='ready',artifactDigest:ready.artifactDigest,snapshotDigest:snapshot.digest}; },
    smoke: async()=>({status:'passed',evidence:{mode:'fixture-only'}}), stop: async op=>{await runtime.stop(op.deploymentId);}
  });
  const operation = await releases.start(draft.id,{snapshotId:snapshot.id,validationId:randomUUID(),clientRequestId:randomUUID(),expectedRevision:0});
  await releases.tick(); await releases.tick(); expect((await releases.get(operation.id)).status).toBe('succeeded');
  const create = () => runs.createShared(snapshot.id,{clientRequestId:randomUUID(),input:'查询 PUMP-001 的状态'}, {
    runId:randomUUID(),environmentId:operation.environmentId,deploymentId:operation.deploymentId,artifactDigest:runtime.artifactDigest,
    modelDigest:runtime.modelProfile.digest,actorId:'U1001',target:{kind:'published',versionId:operation.versionId}
  });
  const finish = async (id:string,status:string) => { await expect.poll(async()=>{await runs.tick();return(await runs.get(id)).status;},{timeout:30000}).toBe(status);return runs.get(id); };
  const first=await create();await finish(first.id,'succeeded');expect((await runtime.get(operation.deploymentId)).status).toBe('ready');
  const firstEvidence=await runs.get(first.id);const previousHeld=heldCalls;holdModel=true;let cancelled:RunRecord;
  try {
    const second=await create();await runs.tick();await expect.poll(()=>heldCalls,{timeout:10000}).toBe(previousHeld+1);
    await runs.cancel(second.id);cancelled=await finish(second.id,'cancelled');expect(cancelled.externalEvidence).toHaveLength(0);
  } finally { holdModel=false; }
  expect((await runtime.get(operation.deploymentId)).status).toBe('ready');
  const third=await create();const completed=await finish(third.id,'succeeded');expect(completed.externalEvidence).toHaveLength(1);
  expect(await runs.get(first.id)).toEqual(firstEvidence);expect(completed.environmentId).toBe(first.environmentId);
  const events=await runs.events(third.id,0);expect(events.filter(e=>e.source==='runtime').every(e=>(e.data as {event:{sessionId:string}}).event.sessionId===third.id)).toBe(true);
  await writeFile(resolve(root,'shared-run-evidence.json'),JSON.stringify({modelMode:'deterministic-fixture',releaseAdmission:'fixture-only',first:firstEvidence,cancelled,third:completed,deployment:await runtime.get(operation.deploymentId),events},null,2));
});

it.skipIf(live)('native release smoke, failure retention and rollback preserve the actual business ledger',async()=>{
  const draft=await drafts.create({...draftInput,brief:{...draftInput.brief,output:{...draftInput.brief.output,confirmed:true}}});
  const baselines=new BaselineService(pool,clock,ids);const preview=await baselines.preview(draft.id,'equipment-read@1');
  const baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});
  const first=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly('VERSION_ONE')});
  const bad=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly('BAD_SMOKE_OUTPUT')});
  const second=await snapshots.create(draft.id,{expectedRevision:1,assembly:equipmentAssembly('VERSION_TWO')});
  const origin='http://127.0.0.1:8080';
  const login=await platform.inject({method:'POST',url:'/api/auth/session',headers:{origin},payload:{token:'bootstrap-platform-test-0123456789'}});
  const management={origin,cookie:String(login.headers['set-cookie']).split(';')[0]!,'x-csrf-token':login.json().csrfToken as string};
  const candidateResponse=await platform.inject({method:'POST',url:'/api/candidates',headers:management,payload:{snapshotId:second.id}});
  expect(candidateResponse.statusCode,candidateResponse.body).toBe(201);const candidate=candidateResponse.json<Candidate>();
  const targetResponse=await platform.inject({method:'POST',url:'/api/test-deployments',headers:management,payload:{clientRequestId:randomUUID(),candidateId:candidate.id,requirementBaselineId:baseline.id,suiteDigest:contentDigest(baseline.content.cases),purpose:'test',ttlSeconds:3600}});
  expect(targetResponse.statusCode,targetResponse.body).toBe(202);const testTarget=targetResponse.json<TestDeployment>();await testDeployments.tick();
  expect((await testDeployments.get(testTarget.id)).status).toBe('ready');
  expect((await pool.query('SELECT * FROM release_pointers WHERE agent_id=$1',[draft.id])).rowCount).toBe(0);
  const testGrant=await platform.inject({method:'POST',url:`/api/test-deployments/${testTarget.id}/sessions`,headers:management,payload:{actorId:'U1002'}});expect(testGrant.statusCode).toBe(201);
  const testing={authorization:`Bearer ${testGrant.json().token}`};const testRoot=`/test-api/deployments/${testTarget.id}`;
  const sendTest=async()=>{const response=await platform.inject({method:'POST',url:`${testRoot}/messages`,headers:testing,payload:{clientRequestId:randomUUID(),input:'查询 PUMP-001'}});expect(response.statusCode,response.body).toBe(202);return response.json<InvocationView>();};
  const readTest=async(id:string)=>(await platform.inject({method:'GET',url:`${testRoot}/requests/${id}`,headers:testing})).json<InvocationView>();
  const finishTest=async(id:string)=>{await expect.poll(async()=>{await invocations.tick();await runs.tick();return(await readTest(id)).run?.status;},{timeout:15000}).toBe('succeeded');return readTest(id);};
  const firstCandidate=await finishTest((await sendTest()).requestId);
  expect(firstCandidate).toMatchObject({agentVersion:null,candidateId:candidate.id,testDeploymentId:testTarget.id,artifactDigest:runtime.artifactDigest});
  expect(JSON.stringify(firstCandidate.run?.result)).toContain('版本二建议');expect(firstCandidate.run?.externalEvidence).toHaveLength(1);
  // The model and full-validation admission are fixtures; deployment, smoke assertions,
  // HTTP tool traffic, persistence, failure cleanup and rollback are the real implementation.
  const driver=new ProjectReleaseDriver(pool,snapshots,baselines,{report:async()=>({baselineId:baseline.id})},runs,runnerPort,mock,new PostgresActions(pool));
  const releases=new ReleaseService(pool,{check:async(snapshotId,validationId)=>({agentId:draft.id,snapshotId,validationId,binding:{
    artifactDigest:runtime.artifactDigest,snapshotDigest:(await snapshots.get(snapshotId)).digest,modelProfile:runtime.modelProfile,
    baselineDigest:baseline.digest,testSetDigest:'c'.repeat(64),mockDigest:(await mock.identity()).implementationDigest,compatibilityKey:'e'.repeat(64)}})},driver);
  const start=(snapshotId:string,expectedRevision:number,rollbackVersionId?:string)=>releases.start(draft.id,{snapshotId,expectedRevision,validationId:randomUUID(),clientRequestId:randomUUID(),...(rollbackVersionId?{rollbackVersionId}:{})});
  const complete=async(id:string,status:string)=>{await expect.poll(async()=>{await releases.tick();await runs.tick();return(await releases.get(id)).status;},{timeout:35000}).toBe(status);};
  const one=await start(first.id,0);await complete(one.id,'succeeded');const pointer=await releases.pointer(draft.id);
  const grant=await platform.inject({method:'POST',url:'/api/demo-sessions',headers:management,payload:{agentId:draft.id,actorId:'U1002'}});expect(grant.statusCode).toBe(201);
  const business={authorization:`Bearer ${grant.json().token}`};
  const message={clientRequestId:randomUUID(),input:'查询 PUMP-001'};
  const send=async(body:typeof message&{conversationId?:string})=>{const response=await platform.inject({method:'POST',url:`/agent-api/agents/${draft.id}/messages`,headers:business,payload:body});expect(response.statusCode,response.body).toBe(202);return response.json<InvocationView>();};
  const read=async(id:string)=>(await platform.inject({method:'GET',url:`/agent-api/requests/${id}`,headers:business})).json<InvocationView>();
  const finishRequest=async(id:string)=>{await expect.poll(async()=>{await invocations.tick();await runs.tick();return(await read(id)).run?.status;},{timeout:15000}).toBe('succeeded');return read(id);};
  const initial=await send(message);const firstMessage=await finishRequest(initial.requestId);
  expect(firstMessage.agentVersion).toBe(one.versionId);expect(firstMessage.run?.actorId).toBe('U1002');expect(JSON.stringify(firstMessage.run?.result)).toContain('版本一建议');
  expect(firstMessage.run?.externalEvidence[0]).toMatchObject({actorId:'U1002',runId:firstMessage.runId});
  const parallelCandidate=await finishTest((await sendTest()).requestId);
  expect(JSON.stringify(parallelCandidate.run?.result)).toContain('版本二建议');expect(parallelCandidate.run?.deploymentId).toBe(testTarget.deploymentId);
  expect(parallelCandidate.run?.environmentId).not.toBe(firstMessage.run?.environmentId);expect(await releases.pointer(draft.id)).toEqual(pointer);
  expect(await read(firstMessage.requestId)).toEqual(firstMessage);
  await platform.inject({method:'POST',url:`/api/test-deployments/${testTarget.id}/stop`,headers:management,payload:{}});await testDeployments.tick();
  expect((await testDeployments.get(testTarget.id)).status).toBe('stopped');expect((await runtime.get(testTarget.deploymentId)).status).toBe('stopped');
  expect((await platform.inject({method:'POST',url:`${testRoot}/messages`,headers:testing,payload:{clientRequestId:randomUUID(),input:'查询设备'}})).statusCode).toBe(409);
  const history=await platform.inject({method:'GET',url:`/api/test-deployments/${testTarget.id}/requests/${firstCandidate.requestId}`,headers:management});
  expect(history.json()).toEqual(firstCandidate);expect((await runtime.get(one.deploymentId)).status).toBe('ready');
  await writeFile(resolve(root,'native-candidate-evidence.json'),JSON.stringify({modelMode:'deterministic-fixture',releaseAdmission:'fixture-only',candidate,testTarget:await testDeployments.get(testTarget.id),firstWithoutRelease:firstCandidate,alongsidePublishedV1:parallelCandidate,publishedV1:firstMessage,pointerUnchanged:true,stoppedRuntime:await runtime.get(testTarget.deploymentId),historyAfterStop:history.json()},null,2));
  // Real process startup failure, scoped to this test worker: the existing JVM remains alive.
  const startupFailure=await start(second.id,1);const savedExecutablePath=process.env.PATH;
  try {process.env.PATH=resolve(root,'missing-java-executable');await releases.tick();}
  finally {if(savedExecutablePath===undefined)delete process.env.PATH;else process.env.PATH=savedExecutablePath;}
  expect((await releases.get(startupFailure.id)).status).toBe('failed');expect(await releases.pointer(draft.id)).toEqual(pointer);
  expect((await runtime.get(startupFailure.deploymentId)).error).toBe('JVM_START_FAILED');
  const seededRun=randomUUID();await mock.prepare(one.environmentId,seededRun);
  expect((await mock.write({environmentId:one.environmentId,runId:seededRun,actorId:'U1001'},'work-order-create',{equipmentId:'PUMP-001',description:'回滚前保留的业务记录',priority:'normal'},randomUUID())).status).toBe(200);
  await mock.release(one.environmentId,seededRun);const businessState=(await mock.inspect(one.environmentId)).state;
  const failed=await start(bad.id,1);await complete(failed.id,'failed');expect((await releases.get(failed.id)).diagnostic).toBe('SMOKE_FAILED');expect(await releases.pointer(draft.id)).toEqual(pointer);
  expect((await runtime.get(one.deploymentId)).status).toBe('ready');expect((await runtime.get(failed.deploymentId)).status).toBe('stopped');
  await expect(runtime.start(failed.deploymentId,bad.content.runtimeSpec,runtime.artifactDigest)).rejects.toMatchObject({code:'DEPLOYMENT_RETIRED'});
  const oldRequest=await runs.createShared(first.id,{clientRequestId:randomUUID(),input:'查询 PUMP-001'}, {runId:randomUUID(),environmentId:one.environmentId,deploymentId:one.deploymentId,
    artifactDigest:runtime.artifactDigest,modelDigest:runtime.modelProfile.digest,actorId:'U1001',target:{kind:'published',versionId:one.versionId}});
  await expect.poll(async()=>{await runs.tick();return(await runs.get(oldRequest.id)).status;},{timeout:15000}).toBe('succeeded');
  expect((await runs.get(oldRequest.id)).externalEvidence).toHaveLength(1);
  const two=await start(second.id,1);await complete(two.id,'succeeded');const oldSmoke=await runs.get(one.smokeRunId);
  expect(await send(message)).toEqual(firstMessage);
  const afterPublish=await send({...message,clientRequestId:randomUUID()});const secondMessage=await finishRequest(afterPublish.requestId);
  expect(secondMessage.agentVersion).toBe(two.versionId);expect(secondMessage.run?.deploymentId).toBe(two.deploymentId);expect(JSON.stringify(secondMessage.run?.result)).toContain('版本二建议');
  const continuation=await send({...message,clientRequestId:randomUUID(),conversationId:firstMessage.conversationId});const pinnedMessage=await finishRequest(continuation.requestId);
  expect(pinnedMessage.agentVersion).toBe(one.versionId);expect(JSON.stringify(pinnedMessage.run?.result)).toContain('版本一建议');
  const rollback=await start(first.id,2,one.versionId);await complete(rollback.id,'succeeded');
  const afterRollback=await send({...message,clientRequestId:randomUUID()});const rollbackMessage=await finishRequest(afterRollback.requestId);
  expect(rollbackMessage.agentVersion).toBe(rollback.versionId);expect(rollbackMessage.run?.deploymentId).toBe(rollback.deploymentId);expect(JSON.stringify(rollbackMessage.run?.result)).toContain('版本一建议');
  expect(await send(message)).toEqual(firstMessage);
  await runnerPort.retire(two.deploymentId);
  const stopped=await send({...message,clientRequestId:randomUUID(),conversationId:secondMessage.conversationId});await invocations.tick();
  const stoppedMessage=await read(stopped.requestId);expect(stoppedMessage.request).toMatchObject({status:'blocked',diagnostic:'DEPLOYMENT_NOT_READY'});expect(stoppedMessage.run).toBeNull();
  const cancelStopped=await platform.inject({method:'POST',url:`/agent-api/requests/${stopped.requestId}/cancel`,headers:business,payload:{}});expect(cancelStopped.json().request.status).toBe('cancelled');
  expect((await releases.pointer(draft.id)).versionId).toBe(rollback.versionId);expect(rollback.environmentId).toBe(one.environmentId);expect(rollback.deploymentId).not.toBe(one.deploymentId);
  expect((await mock.inspect(one.environmentId)).state).toEqual(businessState);expect(await runs.get(one.smokeRunId)).toEqual(oldSmoke);
  const overview=await releases.overview(draft.id);expect(overview.versions).toHaveLength(3);expect(overview.cleanupPending).toEqual([]);
  await writeFile(resolve(root,'native-publication-evidence.json'),JSON.stringify({modelMode:'deterministic-fixture',fullValidationAdmission:'fixture-only',overview,businessStateBeforeRollback:businessState,businessStateAfterRollback:(await mock.inspect(one.environmentId)).state,startupFailure:await runtime.get(startupFailure.deploymentId),failedDeployment:await runtime.get(failed.deploymentId),oldRunAfterFailedRelease:await runs.get(oldRequest.id),oldSmoke},null,2));
  await writeFile(resolve(root,'native-invocation-evidence.json'),JSON.stringify({modelMode:'deterministic-fixture',fullValidationAdmission:'fixture-only',firstMessage,secondMessage,pinnedMessage,rollbackMessage,stoppedMessage,originalAfterRollback:await read(firstMessage.requestId)},null,2));
},180000);
