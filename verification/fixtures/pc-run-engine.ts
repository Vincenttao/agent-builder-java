// Browser contract fixture only. This does not execute Java, MOA, a model or A2A.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import type {RunEngine,ProcessExit} from '../../workbench-server/local-java.js';
type FixtureTask={id:string;target:string;kind:string;query:string;state:string;prompt:{kind:string;token:string;message:string;expiresAt:number}|null;output:Record<string,unknown>;error:string;traceIds:string[]};
export function pcRunFixture(options:{beforeMessage?:(query:string)=>Promise<void>}={}){
 const counters={builds:0,messages:0,posts:0,reads:0,writes:0,replies:[] as any[]};
 const engine:RunEngine={kind:'contract-fixture',async build(input){counters.builds++;input.onLog('Browser contract fixture; no Java compilation.');const jar=join(input.directory,'fixture.jar');writeFileSync(jar,'contract-fixture');return {jar};},async start(){
  const views=new Map<string,any>();
  const event=(v:any,type:string,taskId='',data:any={})=>v.events.push({sequence:v.events.length+1,time:new Date().toISOString(),type,taskId,data});
  const task=(target:string,kind:string,query:string,token:string):FixtureTask=>({id:randomUUID(),target,kind,query,state:'WAITING_INPUT',prompt:{kind:kind==='skill'?'confirm_action':'a2a_input',token,message:kind==='skill'?'兑换 coffee，需确认':'采购 Agent 需要批准',expiresAt:Date.now()+600000},output:{},error:'',traceIds:['1234567890abcdef1234567890abcdef']});
  const sync=(v:any)=>{for(const entry of v.stack.tasks){const frame=v.tasks.find((t:any)=>t.id===entry.id);entry.state=frame.state;}return v;};
  const server=createServer(async(req,res)=>{
   res.setHeader('content-type','application/json');if(req.method==='GET')counters.reads++;else counters.posts++;
   let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{};
   if(req.url==='/workbench/conversations'&&req.method==='POST'){const id=randomUUID(),view={conversationId:id,busy:false,stack:{current:null,retained:null,resumeCandidate:null,tasks:[]},tasks:[],events:[],switchRequest:null,clarification:'',conflict:false};views.set(id,view);res.end(JSON.stringify(view));return;}
   const match=req.url?.match(/^\/workbench\/conversations\/([^/]+)(?:\/(reply|decide|resume|receipt))?$/);
   const v=views.get(body.conversationId??match?.[1]);if(!v){res.statusCode=404;res.end(JSON.stringify({error:'CONVERSATION_NOT_FOUND'}));return;}
   if(req.method==='GET'){res.end(JSON.stringify(sync(v)));return;}
   if(req.url==='/workbench/messages'){
    await options.beforeMessage?.(body.query);counters.messages++;
    if(v.stack.retained){res.statusCode=409;res.end(JSON.stringify({error:'TASK_DEPTH_LIMIT'}));return;}
    if(body.query==='处理采购'){v.switchRequest={requestId:randomUUID(),target:'procurement',query:body.query};event(v,'switch_decision_required',v.stack.current.id,{target:'procurement'});}
    else {const a=task('benefits','skill',body.query,'old-'+randomUUID());v.tasks.push(a);v.stack.current={id:a.id,target:a.target,state:a.state,submittedCall:null};v.stack.tasks.push(v.stack.current);event(v,'routing_decided',a.id,{action:'SKILL',target:'benefits',reason:'contract fixture only'});event(v,'input_required',a.id);
     if(body.query==='不明结果'){a.state='WAITING_RECEIPT';a.prompt=null;v.stack.current.submittedCall='contract-original-key';event(v,'operation_submitted',a.id,{callId:'contract-original-key'});sync(v);res.destroy();return;}}
   }else if(match?.[2]==='decide'){
    assert.equal(body.requestId,v.switchRequest.requestId);assert.equal(body.choice,'RETAIN');const a=v.tasks.find((t:any)=>t.id===v.stack.current.id);a.prompt=null;v.stack.retained=v.stack.current;
    const b=task('procurement','agent','处理采购','b-'+randomUUID());v.tasks.push(b);v.stack.current={id:b.id,target:b.target,state:b.state,submittedCall:null};v.stack.tasks.push(v.stack.current);v.switchRequest=null;event(v,'task_retained',a.id);event(v,'a2a_call_started',b.id,{target:'procurement'});
   }else if(match?.[2]==='reply'){
    counters.replies.push(body);const frame=v.tasks.find((t:any)=>t.id===body.taskId);if(!frame?.prompt||frame.prompt.token!==body.token||frame.id!==v.stack.current.id){res.statusCode=400;res.end(JSON.stringify({error:'STALE_TASK_INPUT'}));return;}assert.equal(frame.prompt.token,body.token);assert.equal(frame.id,v.stack.current.id);frame.prompt=null;frame.state='COMPLETED';
    if(frame.kind==='agent'){v.stack.resumeCandidate=v.stack.retained.id;frame.output={text:'contract fixture procurement completed'};}
    else {if(body.answer==='确认')counters.writes++;frame.output={status:'completed',source:'contract-fixture'};}
    event(v,'task_finished',frame.id,{state:frame.state});
   }else if(match?.[2]==='resume'){
    assert.equal(body.taskId,v.stack.resumeCandidate);v.stack.current=v.stack.retained;v.stack.retained=null;v.stack.resumeCandidate=null;
    const a=v.tasks.find((t:any)=>t.id===body.taskId);a.state='WAITING_INPUT';a.prompt={token:'fresh-'+randomUUID(),kind:'confirm_action',message:'复核通过，旧确认已失效。请重新确认',expiresAt:Date.now()+600000};event(v,'resume_facts_checked',a.id,{passed:true});
   }else if(match?.[2]==='receipt'){
    const frame=v.tasks.find((t:any)=>t.id===body.taskId);assert.equal(v.stack.tasks.find((t:any)=>t.id===body.taskId).submittedCall,'contract-original-key');frame.state='COMPLETED';frame.output={status:'completed',idempotencyKey:'contract-original-key'};event(v,'operation_receipt',frame.id,{state:'COMPLETED'});
   }
   res.end(JSON.stringify(sync(v)));
  });
  server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');let finish:(v:ProcessExit)=>void=()=>{};const exited=new Promise<ProcessExit>(r=>finish=r);
  return {origin:`http://127.0.0.1:${address.port}`,exited,stop:async()=>{await new Promise<void>(r=>server.close(()=>r()));finish({code:0,signal:null});}};
 }};return {engine,counters};
}
