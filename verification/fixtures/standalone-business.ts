// Opt-in live assertions only; this module does not start processes or run on import.
import assert from 'node:assert/strict';
export async function verifyStandaloneBusiness(base:string,mockBase:string,onObservation?:(value:unknown)=>void){
 const stages:Record<string,any>={};
 const ledger=async()=>await (await fetch(mockBase+'/__mock/state')).json() as any;
 const call=async(path:string,body?:unknown,expected=200)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const data=await response.json() as any;onObservation?.({path,status:response.status,data});assert.equal(response.status,expected,JSON.stringify(data));return data;};
 const current=(view:any)=>view.tasks.find((t:any)=>t.id===view.stack.current?.id);
 const message=(conversationId:string|null,query:string,expected=200)=>call('/workbench/messages',{conversationId,query},expected);
 const reply=(view:any,answer:string,expected=200)=>call(`/workbench/conversations/${view.conversationId}/reply`,{taskId:current(view).id,token:current(view).prompt.token,answer},expected);
 const before=await ledger();
 stages.balance=await message(null,'查询我的i豆余额，查询后结束。');assert.equal(stages.balance.stack.current.state,'COMPLETED');assert.ok(JSON.stringify(stages.balance).includes('1280'));assert.equal((await ledger()).writes,before.writes);
 const query='我要兑换1张咖啡券，giftId是coffee，quantity是1。请发起确认。';
 const a=stages.a=await message(null,query),original=current(a);assert.ok(original.prompt);assert.equal((await ledger()).writes,before.writes);
 await call(`/workbench/conversations/${a.conversationId}/reply`,{taskId:original.id,token:'foreign-token',answer:'确认'},400);assert.equal((await ledger()).writes,before.writes);
 const beforeSwitch=await ledger(),asked=stages.switchRequest=await message(a.conversationId,'我要申请采购一台办公电脑，这是采购业务，请转交采购Agent处理。');assert.ok(asked.switchRequest);assert.equal((await ledger()).a2aCalls.length,beforeSwitch.a2aCalls.length);
 const b=stages.b=await call(`/workbench/conversations/${a.conversationId}/decide`,{requestId:asked.switchRequest.requestId,choice:'RETAIN'});assert.equal(current(b).target,'procurement');assert.ok(current(b).prompt);assert.equal(b.stack.retained.id,original.id);
 const callsBeforeThird=(await ledger()).a2aCalls.length;
 const third=stages.third=await message(a.conversationId,'我现在要咨询人事政策，这不属于福利或采购，请转交兜底Agent。',400);assert.equal(third.error,'TASK_DEPTH_LIMIT');assert.equal((await ledger()).a2aCalls.length,callsBeforeThird);assert.equal((await ledger()).a2aCalls.filter((v:any)=>v.target==='fallback').length,0);
 const doneB=stages.doneB=await reply(b,'确认');assert.equal(doneB.stack.resumeCandidate,original.id);
 const resumed=stages.resumed=await call(`/workbench/conversations/${a.conversationId}/resume`,{taskId:original.id});assert.notEqual(current(resumed).prompt.token,original.prompt.token);assert.equal((await ledger()).writes,before.writes);
 await call(`/workbench/conversations/${a.conversationId}/reply`,{taskId:original.id,token:original.prompt.token,answer:'确认'},400);assert.equal((await ledger()).writes,before.writes);
 const completed=stages.completed=await reply(resumed,'确认');assert.equal(completed.stack.current.state,'COMPLETED');assert.equal((await ledger()).writes,before.writes+1);
 await reply(resumed,'确认',400);assert.equal((await ledger()).writes,before.writes+1);
 const reject=stages.rejectStart=await message(null,query);assert.ok(current(reject).prompt);stages.rejected=await reply(reject,'拒绝');assert.equal((await ledger()).writes,before.writes+1);assert.equal(stages.rejected.stack.current.state,'COMPLETED','rejection must settle normally, zero writes alone is insufficient');
 const procurement='我要申请采购一台办公电脑，这是采购业务，请转交采购Agent处理。';
 const controls=async(body:unknown)=>{const response=await fetch(mockBase+'/__mock/controls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);};
 // B failure must preserve A; review produces a fresh waiting point, and a refusal then settles normally.
 const failedA=stages.failedA=await message(null,query),failedAFrame=current(failedA);
 const failedAsk=stages.failedAsk=await message(failedA.conversationId,procurement);assert.ok(failedAsk.switchRequest);
 const failingB=stages.failingB=await call(`/workbench/conversations/${failedA.conversationId}/decide`,{requestId:failedAsk.switchRequest.requestId,choice:'RETAIN'});assert.ok(current(failingB).prompt);
 await controls({nextA2aFailure:true});const failedB=stages.failedB=await reply(failingB,'确认');assert.equal(failedB.stack.current.state,'FAILED');assert.equal(failedB.stack.resumeCandidate,failedAFrame.id);
 const failedResumed=stages.failedResumed=await call(`/workbench/conversations/${failedA.conversationId}/resume`,{taskId:failedAFrame.id});assert.notEqual(current(failedResumed).prompt.token,failedAFrame.prompt.token);
 stages.failedARejected=await reply(failedResumed,'拒绝');assert.equal(stages.failedARejected.stack.current.state,'COMPLETED');assert.equal((await ledger()).writes,before.writes+1);
 // A submitted write with an unknown response remains a layer until its original key is reconciled.
 const unknownStart=stages.unknownStart=await message(null,query);assert.ok(current(unknownStart).prompt);await controls({redemptionDelayMs:1500});
 const unknown=stages.unknown=await reply(unknownStart,'确认');assert.equal(unknown.stack.current.state,'WAITING_RECEIPT');assert.equal((await ledger()).writes,before.writes+2);const unknownA=current(unknown);
 const unknownAsk=stages.unknownAsk=await message(unknown.conversationId,procurement);assert.ok(unknownAsk.switchRequest);
 const unknownB=stages.unknownB=await call(`/workbench/conversations/${unknown.conversationId}/decide`,{requestId:unknownAsk.switchRequest.requestId,choice:'RETAIN'});const unknownBId=current(unknownB).id;assert.equal(unknownB.stack.retained.id,unknownA.id);
 const late=stages.lateReceipt=await call(`/workbench/conversations/${unknown.conversationId}/receipt`,{taskId:unknownA.id});assert.equal(late.stack.current.id,unknownBId);assert.equal(late.stack.retained,null);assert.equal(late.tasks.find((t:any)=>t.id===unknownA.id).state,'COMPLETED');assert.equal((await ledger()).writes,before.writes+2);
 const unknownDoneB=stages.unknownDoneB=await reply(unknownB,'确认');assert.equal(unknownDoneB.stack.current.state,'COMPLETED');assert.equal(unknownDoneB.stack.resumeCandidate,null);await controls({redemptionDelayMs:0});assert.equal((await ledger()).writes,before.writes+2);
 const externalBefore=await ledger(),viewBefore=await call('/workbench/conversations/'+completed.conversationId);
 for(let n=0;n<3;n++)assert.deepEqual(await call('/workbench/conversations/'+completed.conversationId),viewBefore);
 assert.deepEqual(await ledger(),externalBefore);
 return {stages,external:externalBefore,traceIds:[...new Set(Object.values(stages).flatMap((v:any)=>v.tasks??[]).flatMap((t:any)=>t.traceIds??[]))] as string[],checks:['balance actual HTTP result','confirmation zero writes before approval','A→B→A and fresh token','third-layer zero downstream call','foreign/old/repeated replies rejected','approval one write','rejection settles normally with zero new writes','B failure preserves A and fresh review','unknown write uses original-key receipt','late A receipt does not steal B or resubmit','read-only repeated view unchanged']};
}
