// Explicit local adapter verification for an actual, unapplied OpenCode proposal. No model invocation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createBusinessMock} from '../mock-business/server.js';
const execute=promisify(execFile),reportFile=process.argv[2];assert.ok(reportFile,'Supply an actual OpenCode proposal result.json');
const proposal=JSON.parse(readFileSync(reportFile,'utf8'));const job=proposal.review.job;assert.equal(job.engineKind,'opencode');assert.equal(job.status,'awaiting_review');
const files=job.changes,definition=JSON.parse(files['application.json']),catalog=JSON.parse(files['adapters/operations.json']);
const server=createBusinessMock().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
const configuration={...definition,connections:{...definition.connections,idou:origin},mapping:definition.mapping};
const call=async(op:string,args:Record<string,unknown>={},executionId='local-generated-first',extra={})=>{
 const source=files['skills/'+catalog[op].resultScript];assert.equal(typeof source,'string');
 const {stdout}=await execute('/usr/bin/python3',['-I','-c',source],{env:{SKILL_INPUT:JSON.stringify({arguments:args,execution_id:executionId,configuration,...extra})},timeout:5000,maxBuffer:65536});return JSON.parse(stdout);
};
try{
 const balance=await call('balance');assert.equal(balance.data.available,1280);
 const gifts=await call('gifts');assert.ok(gifts.data.gifts.some((g:any)=>g.id==='coffee'&&g.points===100));
 const args={employeeId:'demo',giftId:'coffee',quantity:1};const first=await call('redeem',args);assert.equal(first.data.status,'completed');
 const duplicate=await call('redeem',args);assert.equal(duplicate.data.orderId,first.data.orderId);
 const changed=await call('redeem',{...args,quantity:2});assert.equal(changed.data.status,'failed');
 const receipt=await call('receipt',{idempotencyKey:first.data.idempotencyKey});assert.equal(receipt.data.orderId,first.data.orderId);
 const finish=await call('finish',{},'local-finish',{results:{balance:balance.data,gifts:gifts.data}});assert.equal(finish.success,true);assert.ok(JSON.parse(finish.data.summary).balance);
 await assert.rejects(call('balance',{},'wrong-mapping',{configuration:{...configuration,mapping:{balancePath:'data.points.available'}}}));
 const controls=await fetch(origin+'/__mock/controls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redemptionDelayMs:1500})});assert.equal(controls.status,200);
 const unknown=await call('redeem',args,'local-generated-unknown');assert.equal(unknown.data.status,'unknown');
 const recovered=await call('receipt',{idempotencyKey:unknown.data.idempotencyKey});assert.equal(recovered.data.status,'completed');
 const state=await(await fetch(origin+'/__mock/state')).json() as any;assert.equal(state.writes,2);assert.equal(state.orders.length,2);
 const result={scope:'actual generated Python adapters against independent local HTTP Mock only; no Java/MOA/LLM execution or confirmation acceptance',sourceJob:job.id,sourceSession:job.sessionId,passed:true,checks:['balance','catalog','same-key idempotency','changed-argument refusal','original receipt','finish','bad mapping failure','unknown result original-key recovery'],writes:state.writes,modelCalls:0};
 writeFileSync(join(dirname(reportFile),'local-adapters.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await new Promise<void>(r=>server.close(()=>r()));}
