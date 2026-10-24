// Opt-in real model + executable Java application host + independent HTTP/A2A Mock.
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,cpSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {settings} from '../workbench-server/settings.js';
const config=settings();if(!config.apiKey)throw new Error('DEEPSEEK_API_KEY missing');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const output=resolve('test-results/dev-workbench-v2/p3/application-host-'+stamp),workspace=resolve('.workbench/verification/application-host-'+stamp);mkdirSync(output,{recursive:true});mkdirSync(workspace,{recursive:true});
const jar=resolve('runtime-template-java/target/moa-business-application-2.0.0.jar');
const redact=(v:string)=>v.split(config.apiKey).join('[REDACTED]');
const mock=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {createBusinessMock} from './mock-business/server.ts';const server=createBusinessMock().listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));process.once('SIGTERM',()=>server.close(()=>process.exit(0)));process.once('disconnect',()=>server.close(()=>process.exit(0)));`],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe','ipc']});
let java:ChildProcess|undefined,javaLog='';const stages:Record<string,unknown>={};
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await done;}finally{clearTimeout(timer);}}
try{
 const address=await Promise.race([once(mock,'message').then(([v])=>v as {port:number}),once(mock,'exit').then(()=>{throw new Error('Mock startup failed');}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Mock startup timeout')),10000).unref())]);
 const mockBase=`http://127.0.0.1:${address.port}`;cpSync('examples/idou',join(workspace,'assets'),{recursive:true});
 const file=join(workspace,'assets/application.json'),definition=JSON.parse(readFileSync(file,'utf8'));definition.connections={idou:mockBase,procurement:mockBase+'/a2a/procurement',fallback:mockBase+'/a2a/fallback'};writeFileSync(file,JSON.stringify(definition,null,2));
 java=spawn('java',['-Xmx768m','-jar',jar,'--server.port=0'],{cwd:workspace,env:{...process.env,DEEPSEEK_API_KEY:config.apiKey,DEEPSEEK_BASE_URL:config.baseUrl,WORKBENCH_APP_DIR:join(workspace,'assets'),WORKBENCH_STATE_DIR:join(workspace,'state')},stdio:['ignore','pipe','pipe']});
 const collect=(chunk:Buffer)=>{javaLog+=chunk.toString();if(javaLog.length>20_000_000)java?.kill('SIGKILL');};java.stdout!.on('data',collect);java.stderr!.on('data',collect);
 let port='';for(let n=0;n<120;n++){port=javaLog.match(/Tomcat started on port (\d+)/)?.[1]??'';if(port)break;if(java.exitCode!==null||java.signalCode!==null)throw new Error('Java exited before ready; inspect java.log');await delay(500);}assert.ok(port,'Java startup timeout; inspect java.log');
 const base=`http://127.0.0.1:${port}`;
 const state=async()=>await (await fetch(mockBase+'/__mock/state')).json() as any;
 const call=async(path:string,body?:unknown,expected=200)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const data=await response.json() as any;assert.equal(response.status,expected,JSON.stringify(data));return data;};
 const message=(conversationId:string|null,query:string,expected=200)=>call('/workbench/messages',{conversationId,query},expected);
 const current=(view:any)=>view.tasks.find((t:any)=>t.id===view.stack.current.id);
 const reply=(view:any,answer:string,expected=200)=>call(`/workbench/conversations/${view.conversationId}/reply`,{taskId:current(view).id,token:current(view).prompt.token,answer},expected);
 const switchB=async(a:any)=>{const before=await state();const ask=await message(a.conversationId,'我要申请采购一台办公电脑，这是采购业务，请转交采购Agent处理。');assert.ok(ask.switchRequest,JSON.stringify(ask));assert.equal((await state()).a2aCalls.length,before.a2aCalls.length);const b=await call(`/workbench/conversations/${a.conversationId}/decide`,{requestId:ask.switchRequest.requestId,choice:'RETAIN'});assert.equal(current(b).target,'procurement');assert.ok(current(b).prompt);return b;};
 const redeemQuery='我要兑换1张咖啡券，giftId是coffee，quantity是1。请发起确认。';
 stages.balance=await message(null,'查询我的i豆余额，查询后结束。');assert.equal((stages.balance as any).stack.current.state,'COMPLETED');assert.ok(JSON.stringify(stages.balance).includes('1280'));assert.equal((await state()).writes,0);console.log('Verified: application model routing and balance');
 const a=await message(null,redeemQuery);const original=current(a);assert.ok(original.prompt);assert.equal((await state()).writes,0);
 await call(`/workbench/conversations/${a.conversationId}/reply`,{taskId:original.id,token:'foreign-token',answer:'确认'},400);assert.equal((await state()).writes,0);
 const b=await switchB(a);const beforeThird=(await state()).a2aCalls.length;
 const depth=await message(a.conversationId,'我现在要咨询人事政策，这不属于福利或采购，请转交兜底Agent。',400);assert.equal(depth.error,'TASK_DEPTH_LIMIT');assert.equal((await state()).a2aCalls.length,beforeThird);assert.equal((await state()).a2aCalls.filter((x:any)=>x.target==='fallback').length,0);
 const doneB=await reply(b,'确认');assert.equal(doneB.stack.resumeCandidate,original.id);
 const resumed=await call(`/workbench/conversations/${a.conversationId}/resume`,{taskId:original.id});assert.notEqual(current(resumed).prompt.token,original.prompt.token);assert.equal((await state()).writes,0);
 await call(`/workbench/conversations/${a.conversationId}/reply`,{taskId:original.id,token:original.prompt.token,answer:'确认'},400);assert.equal((await state()).writes,0);
 const completed=await reply(resumed,'确认');assert.equal(completed.stack.current.state,'COMPLETED');assert.equal((await state()).writes,1);
 await reply(resumed,'确认',400);assert.equal((await state()).writes,1);stages.success={a,b,doneB,resumed,completed};console.log('Verified: A→B→A, fresh confirmation, C zero calls');
 const failA=await message(null,redeemQuery),failB=await switchB(failA);
 await fetch(mockBase+'/__mock/controls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nextA2aFailure:true})});
 const failedB=await reply(failB,'确认');assert.equal(failedB.stack.current.state,'FAILED');assert.equal(failedB.stack.resumeCandidate,current(failA).id);
 const resumeAfterFailure=await call(`/workbench/conversations/${failA.conversationId}/resume`,{taskId:current(failA).id});assert.ok(current(resumeAfterFailure).prompt);
 const rejected=await reply(resumeAfterFailure,'拒绝');assert.equal((await state()).writes,1);stages.failure={failedB,resumeAfterFailure,rejected};console.log('Verified: B failure preserves A, rejection zero new writes');
 await fetch(mockBase+'/__mock/controls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redemptionDelayMs:1500})});
 const pendingA=await message(null,redeemQuery);const unknown=await reply(pendingA,'确认');assert.equal(unknown.stack.current.state,'WAITING_RECEIPT');assert.equal((await state()).writes,2);
 const lateB=await switchB(unknown);const receipt=await call(`/workbench/conversations/${unknown.conversationId}/receipt`,{taskId:current(unknown).id});assert.equal(receipt.stack.current.id,current(lateB).id);assert.equal(receipt.stack.retained,null);
 const finalB=await reply(lateB,'确认');assert.equal(finalB.stack.resumeCandidate,null);assert.equal((await state()).writes,2);stages.lateReceipt={unknown,lateB,receipt,finalB};console.log('Verified: unknown result, original receipt, B remains current');
 const beforePlayback=await state();const journal=join(workspace,'state',a.conversationId,'events.jsonl');const bytes=statSync(journal).size;
 for(let n=0;n<3;n++)await call('/workbench/conversations/'+a.conversationId);
 assert.deepEqual(await state(),beforePlayback);assert.equal(statSync(journal).size,bytes);
 const traces=[...new Set(completed.tasks.flatMap((t:any)=>t.traceIds))] as string[];assert.ok(traces.length>0);let retrieved=0;
 for(const id of traces){let text='';for(let n=0;n<4;n++){const response=await fetch('http://127.0.0.1:16686/api/v3/traces/'+id);if(response.ok){text=await response.text();if(text.includes('moa-business-application'))break;}await delay(250);}assert.ok(text.includes('moa-business-application'),'Trace unavailable: '+id);writeFileSync(join(output,'trace-'+id+'.json'),redact(text));retrieved++;}
 const external=await state();const report={passed:true,scope:'real Flash application routing + executable Java/Runtime/MOA + official A2A SDK + independent Mock; hand-written test assets, no PC/Coding/export acceptance',jarSha256:createHash('sha256').update(readFileSync(jar)).digest('hex'),stages,external,playbackNoCallsOrJournalWrites:true,tracesRetrieved:retrieved};
 writeFileSync(join(output,'result.json'),redact(JSON.stringify(report,null,2))+'\n');console.log(JSON.stringify({passed:true,writes:external.writes,a2aCalls:external.a2aCalls.length,tracesRetrieved:retrieved,report:join(output,'result.json')},null,2));
}catch(error){writeFileSync(join(output,'failure.json'),redact(JSON.stringify({passed:false,error:error instanceof Error?error.message:String(error),stages},null,2))+'\n');throw error;
}finally{if(java)await stop(java);await stop(mock);writeFileSync(join(output,'java.log'),redact(javaLog));}
