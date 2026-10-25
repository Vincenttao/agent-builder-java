import express from 'express';
import {randomUUID} from 'node:crypto';
import {registerWealthMock} from './wealth.js';

type Order={id:string;employeeId:string;giftId:string;quantity:number;points:number;idempotencyKey:string;status:'completed'};
type A2aTask={id:string;contextId:string;kind:'task';status:{state:string;message:unknown};artifacts?:unknown[]};
const gifts=[{id:'coffee',name:'咖啡券',points:100},{id:'book',name:'图书券',points:300}];
function versionOneTask(task:A2aTask){
 const message=(source:any)=>({role:'ROLE_AGENT',messageId:source.messageId,parts:source.parts.map((p:any)=>({text:p.text}))});
 return {id:task.id,contextId:task.contextId,status:{state:'TASK_STATE_'+task.status.state.toUpperCase().replaceAll('-','_'),timestamp:new Date().toISOString(),message:message(task.status.message)},artifacts:task.artifacts?.map((a:any)=>({...a,parts:a.parts.map((p:any)=>({text:p.text}))}))};
}

/** Standalone demo dependency. Controls and recorded ledger are explicitly Mock-only. */
export function createBusinessMock(){
 const app=express();app.use(express.json({limit:'128kb'}));
 registerWealthMock(app);
 const balances:Record<string,number>={demo:1280};const orders=new Map<string,Order>();const tasks=new Map<string,A2aTask>();
 const calls:unknown[]=[];const a2aCalls:unknown[]=[];let writes=0;let redemptionDelayMs=0;let nextA2aFailure=false;
 const record=(target:unknown[],value:unknown)=>{target.push(value);if(target.length>1000)target.shift();};
 app.get('/health',(_q,s)=>s.json({status:'ok',mode:'independent-mock'}));
 app.get('/api/gifts',(_q,s)=>s.json({gifts}));
 app.get('/api/employees/:employeeId/balance',(q,s)=>{
  const id=q.params.employeeId;record(calls,{operation:'balance',employeeId:id,at:new Date().toISOString()});
  if(!(id in balances)){s.status(404).json({error:'EMPLOYEE_NOT_FOUND'});return;}
  s.json({employee:{id,wallet:{availablePoints:balances[id],unit:'i豆'}}});
 });
 app.post('/api/redemptions',async(q,s)=>{
  const {employeeId,giftId,quantity,idempotencyKey}=q.body??{};
  record(calls,{operation:'redeem',employeeId,giftId,quantity,idempotencyKey,at:new Date().toISOString()});
  const gift=gifts.find(g=>g.id===giftId);
  if(typeof employeeId!=='string'||!(employeeId in balances)||!gift||!Number.isInteger(quantity)||quantity<1||quantity>10||typeof idempotencyKey!=='string'||!idempotencyKey.match(/^[a-zA-Z0-9_-]{1,128}$/)){
   s.status(400).json({error:'INVALID_REDEMPTION'});return;
  }
  const old=orders.get(idempotencyKey);
  if(old){if(old.employeeId!==employeeId||old.giftId!==giftId||old.quantity!==quantity){s.status(409).json({error:'IDEMPOTENCY_CONFLICT'});return;}s.json({order:old,replayed:true});return;}
  const points=gift.points*quantity;if(balances[employeeId]<points){s.status(409).json({error:'INSUFFICIENT_POINTS'});return;}
  if(orders.size>=1000){s.status(409).json({error:'MOCK_RETENTION_LIMIT_RESET_REQUIRED'});return;}
  const order:Order={id:`order-${orders.size+1}`,employeeId,giftId,quantity,points,idempotencyKey,status:'completed'};
  balances[employeeId]-=points;orders.set(idempotencyKey,order);writes++;
  // Commit first, delay only the response: client timeout is an unknown outcome, not a failed write.
  if(redemptionDelayMs)await new Promise(r=>setTimeout(r,redemptionDelayMs));
  s.status(201).json({order,replayed:false});
 });
 app.get('/api/redemptions/by-key/:key',(q,s)=>{record(calls,{operation:'receipt',key:q.params.key});const order=orders.get(q.params.key);if(!order){s.status(404).json({error:'ORDER_NOT_FOUND'});return;}s.json({order});});
 for(const target of ['procurement','fallback']){
  app.get(`/a2a/${target}/.well-known/agent-card.json`,(q,s)=>s.json({name:`Mock ${target}`,description:'受控 Demo Agent，无企业业务连接',url:`http://${q.headers.host}/a2a/${target}`,version:'1.0.0',protocolVersion:'1.0',supportedInterfaces:[{protocolBinding:'JSONRPC',url:`http://${q.headers.host}/a2a/${target}`,protocolVersion:'1.0'}],capabilities:{streaming:false},defaultInputModes:['text/plain'],defaultOutputModes:['text/plain'],skills:[{id:target,name:target,description:'受控两轮确认',tags:['demo']}]}));
  app.post(`/a2a/${target}`,(q,s)=>{
   const rpc=q.body??{};record(a2aCalls,{target,request:rpc,at:new Date().toISOString()});
   const fail=(code:number,message:string)=>s.json({jsonrpc:'2.0',id:rpc.id??null,error:{code,message}});
   const modern=rpc.method==='SendMessage';
   const respond=(task:A2aTask)=>s.json({jsonrpc:'2.0',id:rpc.id,result:modern?{task:versionOneTask(task)}:task});
   if(rpc.jsonrpc!=='2.0'||!['message/send','SendMessage'].includes(rpc.method)){fail(-32601,'Only SendMessage/message/send is supported');return;}
   const message=rpc.params?.message;
   if(message?.role!==(modern?'ROLE_USER':'user')||!Array.isArray(message.parts)||!message.parts.every((p:any)=>(modern?p.kind===undefined:p.kind==='text')&&typeof p.text==='string')){fail(-32602,'Invalid message');return;}
   let task:A2aTask;
   if(message.taskId){
    const existing=tasks.get(message.taskId);
    if(!existing||message.contextId!==existing.contextId||!existing.id.startsWith(target+'-')){fail(-32001,'Task/context not found');return;}
    task=existing;
    if(task.status.state!=='input-required'){respond(task);return;}
    const text=message.parts.map((p:any)=>p.text).join('\n');
    task.status={state:nextA2aFailure?'failed':/取消|拒绝/.test(text)?'canceled':'completed',message:{kind:'message',role:'agent',messageId:randomUUID(),parts:[{kind:'text',text:nextA2aFailure?'Mock 业务失败':/取消|拒绝/.test(text)?'已取消':'Mock 业务已完成'}]}};nextA2aFailure=false;
    if(task.status.state==='completed')task.artifacts=[{artifactId:randomUUID(),name:'业务回执',parts:[{kind:'text',text:JSON.stringify({mock:true,target,taskId:task.id})}]}];
   }else{
    if(tasks.size>=1000){fail(-32000,'Mock retention limit');return;}
    task={id:target+'-'+randomUUID(),contextId:message.contextId??randomUUID(),kind:'task',status:{state:'input-required',message:{kind:'message',role:'agent',messageId:randomUUID(),parts:[{kind:'text',text:'请确认继续处理。此目标为独立 Mock。'}]}}};tasks.set(task.id,task);
   }
   respond(task);
  });
 }
 app.get('/__mock/state',(_q,s)=>s.json({mock:true,balances,orders:[...orders.values()],writes,calls,a2aCalls,a2aTasks:[...tasks.values()]}));
 app.post('/__mock/controls',(q,s)=>{
  const {redemptionDelayMs:delay,nextA2aFailure:failure}=q.body??{};
  if(delay!==undefined&&(!Number.isInteger(delay)||delay<0||delay>5000)||failure!==undefined&&typeof failure!=='boolean'){s.status(400).json({error:'INVALID_MOCK_CONTROL'});return;}
  if(delay!==undefined)redemptionDelayMs=delay;if(failure!==undefined)nextA2aFailure=failure;
  s.json({mock:true,redemptionDelayMs,nextA2aFailure});
 });
 app.use((_q,s)=>s.status(404).json({error:'NOT_FOUND'}));
 app.use((e:unknown,_q:express.Request,s:express.Response,_next:express.NextFunction)=>s.status(400).json({error:'INVALID_REQUEST'}));
 return app;
}
