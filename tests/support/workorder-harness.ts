import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {Pool} from '../../apps/server/src/db/pool.js';
import {migrate} from '../../apps/server/src/db/migrations.js';
import {createApp} from '../../apps/server/src/app.js';
import {createMockApp} from '../../apps/mock-services/src/app.js';
import {MockRepository} from '../../apps/mock-services/src/repository.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {PostgresDraftRepository} from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import {SnapshotService} from '../../apps/server/src/snapshots/application/snapshot-service.js';
import {PostgresSnapshotRepository} from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import {BaselineService} from '../../apps/server/src/acceptance/application/baseline-service.js';
import {ValidationService} from '../../apps/server/src/acceptance/application/validation-service.js';
import {RunValidationDriver} from '../../apps/server/src/acceptance/adapters/run-validation-driver.js';
import {CandidateValidationDriver} from '../../apps/server/src/acceptance/adapters/candidate-validation-driver.js';
import {TestApiClient} from '../../apps/server/src/acceptance/adapters/test-api-client.js';
import {ValidationWriteFault} from '../../apps/server/src/acceptance/adapters/validation-write-fault.js';
import {ValidationLeaseTokens} from '../../apps/server/src/shared/validation-lease-tokens.js';
import {RunService} from '../../apps/server/src/runs/run-service.js';
import {HttpRunner,HttpMock} from '../../apps/server/src/runs/http-ports.js';
import {PostgresActions} from '../../apps/server/src/actions/postgres-actions.js';
import {ActionService} from '../../apps/server/src/actions/action-service.js';
import {CandidateService} from '../../apps/server/src/candidates/candidate-service.js';
import {TestDeploymentService} from '../../apps/server/src/candidates/test-deployment-service.js';
import {InvocationService} from '../../apps/server/src/invocations/invocation-service.js';
import {ReleaseService} from '../../apps/server/src/releases/release-service.js';
import {ProjectReleaseGate} from '../../apps/server/src/releases/project-release-gate.js';
import {ProjectReleaseDriver} from '../../apps/server/src/releases/project-release-driver.js';
import {JavaDeploymentManager} from '../../apps/runner/src/runtime/deployment-manager.js';
import {ExecutionJournal} from '../../apps/runner/src/executions/journal.js';
import {createRunnerApp} from '../../apps/runner/src/app.js';
import {workOrderAssembly} from '../../packages/contracts/src/equipment-template.js';
import {draftInput} from './fixtures.js';

/** Real HTTP/JVM/PostgreSQL harness. Only the deterministic adapter test advances the action clock. */
export async function workOrderHarness(options:{root?:string;modelKey:string;modelBase?:string}){
  const id=randomUUID(),suffix=id.replaceAll('-',''),root=options.root??resolve('test-results/tdd-017',id);await mkdir(root,{recursive:true});
  const url=process.env.TEST_DATABASE_URL??'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
  const schema=`workorder_${suffix}`,mockSchema=`workorder_mock_${suffix}`;
  const admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`}),mockPool=new Pool({connectionString:url,options:`-c search_path=${mockSchema}`});
  await admin.query(`CREATE SCHEMA "${schema}"`);await admin.query(`CREATE SCHEMA "${mockSchema}"`);await migrate(pool);await migrate(mockPool,'db/mock-migrations');
  let offset=0;const clock={now:()=>new Date(Date.now()+offset).toISOString()},ids={next:randomUUID};
  const token=randomUUID()+randomUUID(),origin='http://127.0.0.1:8080';
  const drafts=new DraftService(new PostgresDraftRepository(pool),clock,ids),snapshots=new SnapshotService(drafts,new PostgresSnapshotRepository(pool),clock,ids),baselines=new BaselineService(pool,clock,ids);
  const mockControl=randomUUID()+randomUUID(),mockBusiness=randomUUID()+randomUUID();
  const mockApp=createMockApp({repository:new MockRepository(mockPool),controlToken:mockControl,businessToken:mockBusiness}),mockBase=await mockApp.listen({host:'127.0.0.1',port:0});
  const mock=new HttpMock(mockBase,mockControl,mockBusiness),actions=new PostgresActions(pool,clock),writes=new ActionService(actions,mock),fault=new ValidationWriteFault(pool,writes);
  let runnerPort:HttpRunner;const port=new Proxy({} as HttpRunner,{get:(_target,key)=>{const v=runnerPort[key as keyof HttpRunner];return typeof v==='function'?v.bind(runnerPort):v;}});
  const runs=new RunService(pool,snapshots,port,mock,actions,writes),invocations=new InvocationService(pool,snapshots,runs,port,actions,mock);
  const candidates=new CandidateService(pool,snapshots,port,baselines),targets=new TestDeploymentService(pool,candidates,baselines,snapshots,runs,port,mock);
  let base='';const leases=new ValidationLeaseTokens();
  const driver=new CandidateValidationDriver(new RunValidationDriver(runs,mock,actions),candidates,port,mock,runs,actions,new TestApiClient(()=>base,origin,token,leases));
  const validations=new ValidationService(pool,baselines,snapshots,driver,clock,candidates);
  const releases=new ReleaseService(pool,new ProjectReleaseGate(validations,baselines,snapshots,driver,candidates),new ProjectReleaseDriver(pool,snapshots,baselines,validations,runs,port,mock,actions));
  const app=createApp({drafts,snapshots,baselines,runs,actions,validations,candidates,testDeployments:targets,invocations,releases,validationLeaseTokens:leases,now:clock.now,bootstrapToken:token,origin,modelConfigured:true,databaseReady:async()=>true,
    toolProxy:{token,context:id=>runs.context(id),invoke:mock.invoke.bind(mock),write:fault.invoke.bind(fault)}});
  const ingress:{method:string;path:string}[]=[];app.addHook('onRequest',async request=>{if(request.url.startsWith('/test-api/')||request.url.startsWith('/agent-api/'))ingress.push({method:request.method,path:request.url});});
  base=await app.listen({host:'127.0.0.1',port:0});
  const runtime=new JavaDeploymentManager({root:join(root,'runner'),artifactPath:resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),modelKey:options.modelKey,...(options.modelBase?{modelBase:options.modelBase}:{}),proxyBase:base+'/internal/tool-proxy',proxyToken:token});
  await runtime.initialize();const journal=new ExecutionJournal(join(root,'executions'),runtime);await journal.initialize();
  const runner=createRunnerApp({token,runtime,journal,modelConfigured:true});runnerPort=new HttpRunner(await runner.listen({host:'127.0.0.1',port:0}),token);
  const login=await fetch(base+'/api/auth/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!,csrf=(await login.json() as {csrfToken:string}).csrfToken;
  async function api<T>(path:string,method='GET',body?:unknown,authorization?:string):Promise<T>{
    const r=await fetch(base+path,{method,signal:AbortSignal.timeout(90_000),headers:authorization?{authorization,'content-type':'application/json'}:{cookie,origin,'x-csrf-token':csrf,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(!r.ok){const data=await r.json() as {code?:string};throw new Error(`${r.status} ${path} ${data.code??'REQUEST_FAILED'}`);}return r.json() as Promise<T>;
  }
  async function target(fixedCandidate:boolean){
    const draft=await drafts.create({...draftInput,name:`工单八项验收 ${id}`,brief:{...draftInput.brief,goal:{value:'查询设备事实；用户申请时，经有效确认创建模拟工单',source:'user',confirmed:true},output:{value:'设备报告与可核查的模拟工单',source:'user',confirmed:true}}});
    const preview=await baselines.preview(draft.id,'equipment-workorder@1'),baseline=await baselines.confirm(draft.id,{expectedRevision:1,templateId:'equipment-workorder@1',confirmed:true,expectedDigest:preview.digest});
    const snapshot=await snapshots.create(draft.id,{expectedRevision:1,assembly:workOrderAssembly()});
    const candidate=fixedCandidate?await candidates.create(snapshot.id):undefined;
    const validation=await validations.start(snapshot.id,{clientRequestId:randomUUID(),baselineId:baseline.id,allowMockWrites:true,...(candidate?{candidateId:candidate.id}:{})});
    return{draft,baseline,snapshot,candidate,validation};
  }
  async function pump(){await targets.tick();await invocations.tick();await runs.tick();await validations.tick();await releases.tick();}
  async function close(){await runtime.shutdown();await runner.close();await app.close();await mockApp.close();await pool.end();await mockPool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.query(`DROP SCHEMA "${mockSchema}" CASCADE`);await admin.end();}
  return{id,root,base,api,token,origin,pool,runs,actions,validations,baselines,candidates,targets,releases,runtime,driver,ingress,target,pump,close,advanceActionClock:(ms:number)=>{if(!options.modelBase)throw new Error('Live runs cannot advance the clock');offset+=ms;}};
}
