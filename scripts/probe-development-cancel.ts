import {resolveOpenCodeExecutable} from '../apps/runner/src/engineering/engine-binary.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {EngineeringTaskManager} from '../apps/runner/src/engineering/task-manager.js';
import {OpenCodeTaskExecutor} from '../apps/runner/src/engineering/task-executor.js';
import type {EngineeringTaskInput} from '../packages/contracts/src/development.js';
if(process.env.RUN_LIVE_E2E!=='1'||!process.env.DEEPSEEK_API_KEY)throw new Error('Live engineering opt-in required');
const prior=resolve('.cache/development-live/cba9b1ff-89c1-479c-9b99-50902976e026/runner/tasks/2471fcff-6511-4bce-a0f8-0ab5fa3018f7/input.json');
const input=JSON.parse(await readFile(prior,'utf8')) as EngineeringTaskInput;
const id=randomUUID();const root=resolve('.cache/development-cancel',id);await mkdir(root,{recursive:true});
const manager=new EngineeringTaskManager(root,directory=>new OpenCodeTaskExecutor({root:directory,sdkJar:resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),executable:resolveOpenCodeExecutable(),modelKey:process.env.DEEPSEEK_API_KEY!}));await manager.initialize();
const evidence:{id:string;startedAt:string;finishedAt?:string;status:string;record?:unknown;error?:string}={id,startedAt:new Date().toISOString(),status:'running'};
try{
 await manager.submit(id,input);await manager.tick();const deadline=Date.now()+60000;
 let sessionId:string|undefined;
 while(Date.now()<deadline){try{const session=JSON.parse(await readFile(join(root,'tasks',id,'workspace','control','tester-session.json'),'utf8')) as {sessionId:string};sessionId=session.sessionId;if(sessionId)break;}catch{}await delay(100);}
 assert.ok(sessionId,'Actual OpenCode session must exist before cancellation');await delay(500);
 console.log(JSON.stringify({stage:'cancelling',id}));const result=await manager.cancel(id);evidence.record=await manager.get(id);assert.equal(result.status,'cancelled');
 await assert.rejects(manager.submit(id,input),{code:'ENGINEERING_TASK_RETIRED'});evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error instanceof Error?error.message:'UNKNOWN_ERROR';process.exitCode=1;}
finally{await manager.close();evidence.finishedAt=new Date().toISOString();await writeFile(join('test-results/tdd-013',`cancellation-${id}.json`),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}
