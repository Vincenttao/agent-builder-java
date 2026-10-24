import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessMock} from '../mock-business/server.js';

test('independent business Mock provides nested balance, idempotent ledger, and query after unknown result',async t=>{
 const server=createBusinessMock().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const call=async(path:string,body?:unknown)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json() as any};};
 assert.equal((await call('/health')).body.mode,'independent-mock');
 assert.equal((await call('/api/employees/demo/balance')).body.employee.wallet.availablePoints,1280);
 const order={employeeId:'demo',giftId:'coffee',quantity:1,idempotencyKey:'intent-1'};
 assert.equal((await call('/api/redemptions',order)).status,201);
 const replay=await call('/api/redemptions',order);assert.equal(replay.status,200);assert.equal(replay.body.order.id,'order-1');
 assert.equal((await call('/api/redemptions',{...order,quantity:2})).status,409);
 assert.equal((await call('/api/employees/demo/balance')).body.employee.wallet.availablePoints,1180);
 await call('/__mock/controls',{redemptionDelayMs:150});
 await assert.rejects(fetch(base+'/api/redemptions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...order,idempotencyKey:'intent-2'}),signal:AbortSignal.timeout(40)}));
 const receipt=await call('/api/redemptions/by-key/intent-2');assert.equal(receipt.body.order.status,'completed');
 const state=(await call('/__mock/state')).body;
 assert.equal(state.orders.length,2);assert.equal(state.writes,2);assert.equal(state.balances.demo,1080);
});

test('controlled A2A target preserves task/context on input-required continuation and exposes real call records',async t=>{
 const server=createBusinessMock().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(()=>new Promise<void>(r=>server.close(()=>r())));const a=server.address();assert.ok(a&&typeof a!=='string');const base=`http://127.0.0.1:${a.port}`;
 const send=async(params:unknown)=>{const r=await fetch(base+'/a2a/procurement',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'rpc-1',method:'message/send',params})});return await r.json() as any;};
 const first=await send({message:{role:'user',messageId:'m1',parts:[{kind:'text',text:'申请采购'}]}});
 assert.equal(first.result.status.state,'input-required');
 const {id,contextId}=first.result;
 const second=await send({message:{role:'user',messageId:'m2',taskId:id,contextId,parts:[{kind:'text',text:'确认采购'}]}});
 assert.equal(second.result.id,id);assert.equal(second.result.contextId,contextId);assert.equal(second.result.status.state,'completed');
 const stale=await send({message:{role:'user',messageId:'m3',taskId:'unknown',contextId,parts:[{kind:'text',text:'确认'}]}});assert.equal(stale.error.code,-32001);
 const state=await (await fetch(base+'/__mock/state')).json() as any;assert.equal(state.a2aCalls.length,3);assert.equal(state.a2aTasks.length,1);
});

test('Mock supports Runtime-pinned A2A 1.0 SendMessage wire format',async t=>{
 const server=createBusinessMock().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const send=async(taskId?:string)=>await (await fetch(base+'/a2a/procurement',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'v1-request',method:'SendMessage',params:{message:{role:'ROLE_USER',messageId:'v1-message',contextId:'v1-context',...(taskId?{taskId}:{}),parts:[{text:taskId?'确认':'申请采购'}]}}})})).json() as any;
 const first=await send();assert.equal(first.result.task.status.state,'TASK_STATE_INPUT_REQUIRED');assert.equal(first.result.task.contextId,'v1-context');assert.equal(first.result.task.status.message.role,'ROLE_AGENT');
 const second=await send(first.result.task.id);assert.equal(second.result.task.status.state,'TASK_STATE_COMPLETED');assert.equal(second.result.task.id,first.result.task.id);assert.equal(second.result.task.artifacts[0].parts[0].kind,undefined);
});
