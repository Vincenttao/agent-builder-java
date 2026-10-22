import {resolveOpenCodeExecutable} from '../apps/runner/src/engineering/engine-binary.js';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {EngineeringWorkspace} from '../apps/runner/src/engineering/workspace.js';
import {createEngineeringMcp} from '../apps/runner/src/engineering/mcp.js';
import {OpenCodeEngine} from '../apps/runner/src/engineering/engine.js';
import type {AcceptanceBaseline} from '../packages/contracts/src/baselines.js';
import type {Snapshot} from '../packages/contracts/src/index.js';
import type {EngineeringEvent} from '../packages/contracts/src/development.js';
if(process.env.RUN_LIVE_E2E!=='1'||!process.env.DEEPSEEK_API_KEY)throw new Error('RUN_LIVE_E2E=1 and local model credentials required');
const base=process.env.APP_ORIGIN??'http://127.0.0.1:8080';
const login=await fetch(base+'/api/auth/session',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:process.env.LOCAL_BOOTSTRAP_TOKEN})});assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
const previous=JSON.parse(await readFile('docs/implementation/evidence/TDD-012/live-candidate.json','utf8'));
async function get<T>(path:string):Promise<T>{const r=await fetch(base+path,{headers:{cookie}});assert.equal(r.status,200);return r.json() as Promise<T>;}
const baseline=await get<AcceptanceBaseline>(`/api/baselines/${previous.target.requirementBaselineId}`);
const snapshot=await get<Snapshot>(`/api/snapshots/${previous.snapshotId}`);
const id=randomUUID();const root=resolve('.cache/engineering-live',id);await mkdir(root,{recursive:true});await mkdir('test-results/tdd-013',{recursive:true});
const events:EngineeringEvent[]=[];
const workspace=new EngineeringWorkspace(root,resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),{baseline,goal:snapshot.content.draft.brief.goal.value,snapshotId:snapshot.id},async event=>{events.push(event);console.log(JSON.stringify({event:event.type,role:event.role,data:event.data}));});await workspace.initialize();
const tokens={developer:randomUUID()+randomUUID(),tester:randomUUID()+randomUUID()};const mcp=createEngineeringMcp(workspace,tokens);const mcpBase=await mcp.listen({host:'127.0.0.1',port:0});
const engine=new OpenCodeEngine({root,executable:resolveOpenCodeExecutable(),modelKey:process.env.DEEPSEEK_API_KEY,mcpBase,tokens});
const evidence:{id:string;startedAt:string;status:string;roles:unknown[];events:EngineeringEvent[];bundle?:unknown;error?:string;finishedAt?:string}={id,startedAt:new Date().toISOString(),status:'running',roles:[],events};
try{
 await engine.start();console.log(JSON.stringify({stage:'engine-ready',id,version:engine.inspect().version}));
 const tester=await engine.runRole('tester','Use builder tools. Read engineering-skill.md and context.json. Design and save tests/plan.json against the confirmed baseline before implementation. Preserve every required assertion.');evidence.roles.push(tester);assert.equal(tester.status,'completed');assert.ok(workspace.inspect().planDigest);console.log(JSON.stringify({stage:'tester-completed',sessionId:tester.sessionId}));
 const developer=await engine.runRole('developer','Use builder tools. Read engineering-skill.md and context.json. Generate a Java unit test, run it against the stub and observe a real red result, then implement EquipmentTool and its Skill, get a green unit-test, and run build. You must use actual write and run tools; prose is not a deliverable.');evidence.roles.push(developer);assert.equal(developer.status,'completed');assert.ok(workspace.inspect().bundle);evidence.bundle=workspace.inspect().bundle;evidence.status='built-awaiting-runtime-integration';
 console.log(JSON.stringify({stage:'bundle-built',id,bundle:evidence.bundle}));
}catch(error){evidence.status='failed';evidence.error=error instanceof Error?error.message:'UNKNOWN_ERROR';process.exitCode=1;console.log(JSON.stringify({stage:'failed',id,code:evidence.error}));}
finally{await workspace.cancel();await engine.stop();await mcp.close();evidence.finishedAt=new Date().toISOString();await writeFile(join('test-results/tdd-013',`generation-${id}.json`),JSON.stringify(evidence,null,2));}
