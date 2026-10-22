import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createRunnerApp} from '../../apps/runner/src/app.js';
import {EngineeringTaskManager} from '../../apps/runner/src/engineering/task-manager.js';
import {ExecutionJournal} from '../../apps/runner/src/executions/journal.js';
import {createApp} from '../../apps/server/src/app.js';
import {DraftService} from '../../apps/server/src/drafts/application/draft-service.js';
import {MemoryDraftRepository} from '../support/memory-drafts.js';
import {draftInput} from '../support/fixtures.js';
import {equipmentGenerationRequest} from '../../packages/contracts/src/generation-profile.js';
import {equipmentBaseline} from '../../apps/server/src/acceptance/application/equipment-baseline.js';
import {contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
const token='development-contract-test-token-012345';
it('Runner authenticates generation admission, validates fixed inputs and rejects shell/credential overrides',async()=>{
 const root=resolve('test-results',`engineering-http-${randomUUID()}`);
 const manager=new EngineeringTaskManager(root,()=>({run:async()=>{throw new Error('not executed');},cancel:async()=>{}}));await manager.initialize();
 const runtime={artifactDigest:'a'.repeat(64),bootId:randomUUID()};
 const journal=new ExecutionJournal(resolve(root,'executions'),runtime as never);await journal.initialize();
 const app=createRunnerApp({token,runtime:runtime as never,journal,modelConfigured:true,engineering:manager});
 const draft={...draftInput,id:randomUUID(),revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const content=equipmentBaseline(draft,'equipment-read@1');const baseline={id:randomUUID(),draftId:draft.id,draftRevision:1,confirmedAt:draft.createdAt,confirmedBy:'fixture',digest:contentDigest(content),content};
 const id=randomUUID();const body={context:{snapshotId:randomUUID(),goal:'equipment',baseline},generation:equipmentGenerationRequest,maxSeconds:60};const headers={authorization:`Bearer ${token}`};
 try{
  expect((await app.inject({method:'PUT',url:`/engineering/tasks/${id}`,payload:body})).statusCode).toBe(401);
  for(const patch of [{command:'shell'}, {env:{DEEPSEEK_API_KEY:'forged'}},{context:{...body.context,baseline:null}}])expect((await app.inject({method:'PUT',url:`/engineering/tasks/${id}`,headers,payload:{...body,...patch}})).statusCode).toBe(400);
  expect((await app.inject({method:'PUT',url:`/engineering/tasks/${id}`,headers,payload:body})).statusCode).toBe(202);
  expect((await app.inject({method:'PUT',url:`/engineering/tasks/${id}`,headers,payload:{...body,maxSeconds:45}})).json().code).toBe('ENGINEERING_INPUT_CONFLICT');
  expect((await app.inject({method:'POST',url:`/engineering/tasks/${id}/cancel`,headers,payload:{}})).json().status).toBe('cancelled');
  expect((await app.inject({method:'PUT',url:`/engineering/tasks/${id}`,headers,payload:body})).json().code).toBe('ENGINEERING_TASK_RETIRED');
  expect((await app.inject({url:`/engineering/tasks/${id}/file?path=../control/opencode.json`,headers})).statusCode).toBe(409);
  const artifact={bundleDigest:'b'.repeat(64),specDigest:'c'.repeat(64)};
  expect((await app.inject({method:'POST',url:`/engineering/tasks/${id}/artifact`,payload:artifact})).statusCode).toBe(401);
  for(const extra of [{path:'../untrusted.jar'},{command:'jar'},{artifactDigest:'d'.repeat(64)}])expect((await app.inject({method:'POST',url:`/engineering/tasks/${id}/artifact`,headers,payload:{...artifact,...extra}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url:`/engineering/tasks/${id}/artifact`,headers,payload:artifact})).json().code).toBe('GENERATED_BUNDLE_MISSING');
  expect((await app.inject({url:`/artifacts/${'a'.repeat(64)}`})).statusCode).toBe(401);
 }finally{await manager.close();await app.close();}
});
it('management requires login and CSRF, and cannot accept caller-supplied baseline content or verdicts',async()=>{
 const drafts=new DraftService(new MemoryDraftRepository(),{now:()=>new Date().toISOString()},{next:randomUUID});let calls=0;
 const development={start:async()=>{calls++;return{id:randomUUID(),status:'queued'};}};
 const origin='http://127.0.0.1:8080';const app=createApp({drafts,databaseReady:async()=>true,now:()=>new Date().toISOString(),bootstrapToken:token,origin,modelConfigured:true,development:development as never});
 const url=`/api/snapshots/${randomUUID()}/development`;const body={clientRequestId:randomUUID(),baselineId:randomUUID(),generation:equipmentGenerationRequest,maxSeconds:60};
 try{
  expect((await app.inject({method:'POST',url,headers:{origin},payload:body})).statusCode).toBe(401);
  const session=await app.inject({method:'POST',url:'/api/auth/session',headers:{origin},payload:{token}});
  const headers={origin,cookie:String(session.headers['set-cookie']).split(';')[0]!,'x-csrf-token':session.json().csrfToken};
  expect((await app.inject({method:'POST',url,headers:{origin,cookie:headers.cookie},payload:body})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,headers,payload:{...body,baseline:{},verdict:'passed'}})).statusCode).toBe(400);expect(calls).toBe(0);
  expect((await app.inject({method:'POST',url,headers,payload:body})).statusCode).toBe(202);expect(calls).toBe(1);
  const repair={...body,repairExecutionId:randomUUID()};
  for(const patch of [{repair:{attempt:0}},{maxAttempts:100},{files:[]},{repairExecutionId:'not-a-report-id'}])expect((await app.inject({method:'POST',url,headers,payload:{...repair,...patch}})).statusCode).toBe(400);
  expect(calls).toBe(1);expect((await app.inject({method:'POST',url,headers,payload:repair})).statusCode).toBe(202);expect(calls).toBe(2);
 }finally{await app.close();}
});
