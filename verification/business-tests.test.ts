import {businessTestFixture} from './fixtures/business-workbench.js';
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createWorkbench,readTree} from '../workbench-server/app.js';import {createBusinessMock} from '../mock-business/server.js';import {checkedRelease} from './fixtures/checked-release.js';import {pcRunFixture} from './fixtures/pc-run-engine.js';
const suite={schemaVersion:1,family:'moa',mockConnection:'idou',cases:[{id:'decline',title:'拒绝不写入',steps:[{id:'ask',type:'message',query:'兑换咖啡',assertions:[{source:'view',path:'stack.current.state',operator:'equals',value:'WAITING_INPUT'}]},{id:'decline',type:'reply',answer:'拒绝',assertions:[{source:'view',path:'stack.current.state',operator:'equals',value:'COMPLETED'},{source:'delta',path:'writes',operator:'equals',value:0}]}]}]};
async function setup(t:test.TestContext,options:Parameters<typeof pcRunFixture>[0]={}){return businessTestFixture(t,suite,options);}
async function finished(call:Awaited<ReturnType<typeof setup>>['call'],id:string){for(let n=0;n<200;n++){const r=await call('/business-tests/'+id);if(!['running','cancelling'].includes(r.body.report.status))return r.body.report;await new Promise(r=>setTimeout(r,10));}throw Error('test report did not finish');}
test('business regression binds the actual saved suite/run and cannot promote fixture execution to real business proof',async t=>{
 const {wb,project,run,call}=await setup(t);assert.equal((await call('/projects/'+project.id+'/business-tests','platform','POST',{baseHead:project.head,runId:run.id,allowMockWrites:true})).status,403);assert.equal((await call('/projects/'+project.id+'/business-tests','application','POST',{baseHead:project.head,runId:run.id})).status,409);const started=await call('/projects/'+project.id+'/business-tests','application','POST',{baseHead:project.head,runId:run.id,allowMockWrites:true});assert.equal(started.status,202);const report=await finished(call,started.body.report.id);assert.equal(report.status,'passed');assert.equal(report.engine,'contract-fixture');assert.equal(report.verification,'contract-fixture');assert.equal(report.head,project.head);assert.equal(report.runId,run.id);assert.match(report.suiteDigest,/^[a-f0-9]{64}$/);assert.equal(report.cases[0].assertions.every((a:any)=>a.passed),true);wb.store.save(project.id,'application',project.head,{'instructions.md':'新的业务指导'});const again=await call('/projects/'+project.id+'/business-tests');assert.equal(again.body.reports[0].stale,true);assert.equal(again.body.reports[0].head,project.head);
});
test('COMPLETED does not override failed external state assertions',async t=>{
 const {wb,project,run,call}=await setup(t);await wb.runs.stop(run.id,'application');const changed=structuredClone(suite);changed.cases[0].steps[1].assertions[1].value=1;const p=wb.store.save(project.id,'application',project.head,{'tests/business-cases.json':JSON.stringify(changed)}),next=await wb.runs.start(p.id,'application',p.head);for(let n=0;n<200&&wb.runs.get(next.id,'application').status!=='running';n++)await new Promise(r=>setTimeout(r,10));const started=await call('/projects/'+p.id+'/business-tests','application','POST',{baseHead:p.head,runId:next.id,allowMockWrites:true});assert.equal(started.status,202);const report=await finished(call,started.body.report.id);assert.equal(report.status,'failed');assert.ok(report.cases[0].assertions.some((a:any)=>!a.passed&&a.path==='writes'));assert.equal(report.cases[0].state,'COMPLETED');
});


test('cancellation waits for the original request and prevents manual interference or automatic retries',async t=>{
 let release:()=>void=()=>{};const pending=new Promise<void>(r=>release=r);t.after(()=>release());const {wb,project,run,fixture,call}=await setup(t,{beforeMessage:async()=>pending});const started=await call('/projects/'+project.id+'/business-tests','application','POST',{baseHead:project.head,runId:run.id,allowMockWrites:true});assert.equal(started.status,202);for(let n=0;n<100&&!wb.runs.get(run.id,'application').unobserved?.length;n++)await new Promise(r=>setTimeout(r,5));assert.equal(wb.runs.get(run.id,'application').testing,started.body.report.id);assert.equal((await call('/runs/'+run.id+'/messages','application','POST',{query:'人工消息'})).status,409);assert.equal((await call('/runs/'+run.id+'/stop','application','POST',{})).status,409);assert.equal((await call('/business-tests/'+started.body.report.id+'/cancel','application','POST',{})).body.report.status,'cancelling');release();const result=await finished(call,started.body.report.id);assert.equal(result.status,'cancelled');assert.equal(fixture.counters.messages,1);assert.equal(fixture.counters.writes,0);assert.equal(wb.runs.get(run.id,'application').testing,undefined);await wb.runs.stop(run.id,'application');await assert.rejects(wb.runs.remove(run.id,'application'),/引用/);assert.equal((await call('/business-tests/'+result.id,'application','DELETE')).status,204);await wb.runs.remove(run.id,'application');
});

test('business suites reject executable commands, missing assertions and invalid phase references before execution',async()=>{
 const {parseBusinessSuite}=await import('../workbench-server/business-tests.js');const invalid=structuredClone(suite) as any;invalid.cases[0].steps[0].type='bash';assert.throws(()=>parseBusinessSuite(JSON.stringify(invalid)),/Schema/);invalid.cases[0].steps=[{id:'one',type:'message',query:'hello'}];assert.throws(()=>parseBusinessSuite(JSON.stringify(invalid)),/确定性断言/);invalid.cases[0].steps[0].assertions=[{source:'task',path:'prompt.token',operator:'notEqualsFrom',fromStep:'future'}];assert.throws(()=>parseBusinessSuite(JSON.stringify(invalid)),/原view或task/);
});


test('all example suites use the supported bounded declarative schema',async()=>{
 const {parseBusinessSuite}=await import('../workbench-server/business-tests.js');
 for(const example of ['idou','commerce-wealth','deepagent-materials'])assert.ok(parseBusinessSuite(readTree('examples/'+example)['tests/business-cases.json']).cases.length>0);
});

test('fault injection restores the original controls and preserves the business ledger',async t=>{
 const {wb,project,run,call,origin}=await setup(t);await wb.runs.stop(run.id,'application');
 const post=async(body:unknown)=>(await fetch(origin+'/__mock/controls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
 await post({redemptionDelayMs:25,nextA2aFailure:true});
 const cases={...suite,cases:[{id:'fault',title:'故障注入不清账本',steps:[{id:'delay',type:'controls',control:{redemptionDelayMs:100,nextA2aFailure:false},assertions:[{source:'delta',path:'writes',operator:'equals',value:0}]}]}]};
 const p=wb.store.save(project.id,'application',project.head,{'tests/business-cases.json':JSON.stringify(cases)}),next=await wb.runs.start(p.id,'application',p.head);
 for(let n=0;n<200&&wb.runs.get(next.id,'application').status!=='running';n++)await new Promise(r=>setTimeout(r,10));
 const started=await call('/projects/'+p.id+'/business-tests','application','POST',{baseHead:p.head,runId:next.id,allowMockWrites:true});assert.equal(started.status,202);
 const report=await finished(call,started.body.report.id);assert.equal(report.status,'passed');
 const controls=await (await fetch(origin+'/__mock/controls')).json() as any;assert.deepEqual(controls,{mock:true,redemptionDelayMs:25,nextA2aFailure:true});
 assert.equal(report.cases[0].before.sha256,report.cases[0].after.sha256);
});
