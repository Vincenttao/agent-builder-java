// Opt-in real model + executable Java service + independent Mock verification.
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync,cpSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {settings} from '../workbench-server/settings.js';
const config=settings();if(!config.apiKey)throw new Error('DEEPSEEK_API_KEY missing');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const output=resolve('test-results/dev-workbench-v2/p3/java-service-'+stamp),workspace=resolve('.workbench/verification/java-service-'+stamp);mkdirSync(output,{recursive:true});mkdirSync(workspace,{recursive:true});
const jar=resolve('runtime-template-java/target/moa-business-application-2.0.0.jar');
const redact=(v:string)=>v.split(config.apiKey).join('[REDACTED]');
const mock=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {createBusinessMock} from './mock-business/server.ts';const server=createBusinessMock().listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));process.once('SIGTERM',()=>server.close(()=>process.exit(0)));process.once('disconnect',()=>server.close(()=>process.exit(0)));`],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe','ipc']});
let java:ChildProcess|undefined,javaLog='';
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await done;}finally{clearTimeout(timer);}}
try{
 const address=await Promise.race([once(mock,'message').then(([v])=>v as {port:number}),once(mock,'exit').then(()=>{throw new Error('Mock startup failed');}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Mock startup timeout')),10000).unref())]);
 const mockBase=`http://127.0.0.1:${address.port}`;cpSync('examples/idou',join(workspace,'assets'),{recursive:true});
 const file=join(workspace,'assets/application.json'),definition=JSON.parse(readFileSync(file,'utf8'));definition.connections={idou:mockBase,procurement:mockBase+'/a2a/procurement',fallback:mockBase+'/a2a/fallback'};writeFileSync(file,JSON.stringify(definition,null,2));
 java=spawn('java',['-Xmx768m','-jar',jar,'--server.port=0'],{cwd:workspace,env:{...process.env,DEEPSEEK_API_KEY:config.apiKey,DEEPSEEK_BASE_URL:config.baseUrl,WORKBENCH_APP_DIR:join(workspace,'assets'),WORKBENCH_STATE_DIR:join(workspace,'state')},stdio:['ignore','pipe','pipe']});
 const collect=(chunk:Buffer)=>{javaLog+=chunk.toString();if(javaLog.length>12_000_000)java?.kill('SIGKILL');};java.stdout!.on('data',collect);java.stderr!.on('data',collect);
 let port='';for(let n=0;n<120;n++){port=javaLog.match(/Tomcat started on port (\d+)/)?.[1]??'';if(port)break;if(java.exitCode!==null||java.signalCode!==null)throw new Error('Java exited before ready; inspect java.log');await delay(500);}assert.ok(port,'Java startup timeout; inspect java.log');
 const base=`http://127.0.0.1:${port}`;
 const state=async()=>await (await fetch(mockBase+'/__mock/state')).json() as any;
 const turn=async(body:unknown,expected=200)=>{const response=await fetch(base+'/workbench/turns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});const data=await response.json() as any;assert.equal(response.status,expected,JSON.stringify(data));return data;};
 const balance=await turn({skillId:'benefits',query:'查询我的i豆余额，查询后结束。'});assert.equal(balance.interrupt,null);assert.ok(JSON.stringify(balance.result).includes('1280'));assert.equal((await state()).writes,0);
 const redeem=await turn({skillId:'benefits',query:'我要兑换1张咖啡券，giftId是coffee，quantity是1。请发起确认。'});assert.ok(redeem.interrupt?.id);assert.equal((await state()).writes,0);
 await turn({executionId:redeem.executionId,interruptId:'foreign-id',answer:'确认'},400);assert.equal((await state()).writes,0);
 const redeemed=await turn({executionId:redeem.executionId,interruptId:redeem.interrupt.id,answer:'确认'});assert.equal(redeemed.interrupt,null);assert.equal((await state()).writes,1);
 await turn({executionId:redeem.executionId,interruptId:redeem.interrupt.id,answer:'确认'},400);assert.equal((await state()).writes,1);
 const denied=await turn({skillId:'benefits',query:'我要兑换1张咖啡券，giftId是coffee，quantity是1。请发起确认。'});assert.ok(denied.interrupt?.id);
 const rejection=await turn({executionId:denied.executionId,interruptId:denied.interrupt.id,answer:'拒绝'});assert.equal((await state()).writes,1);
 await fetch(mockBase+'/__mock/controls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redemptionDelayMs:1500})});
 const unknown=await turn({skillId:'benefits',query:'我要兑换1张咖啡券，giftId是coffee，quantity是1。请发起确认。'});assert.ok(unknown.interrupt?.id);
 const unknownResult=await turn({executionId:unknown.executionId,interruptId:unknown.interrupt.id,answer:'确认'});assert.equal(unknownResult.interrupt,null);assert.ok(JSON.stringify(unknownResult.result).includes('unknown'));
 const external=await state();assert.equal(external.writes,2);const original=external.orders[1];assert.equal((await (await fetch(mockBase+'/api/redemptions/by-key/'+original.idempotencyKey)).json() as any).order.id,original.id);
 const report={passed:true,scope:'executable Java service + Runtime adapter + real Flash/MOA Skill loop + independent HTTP Mock; task host and export acceptance not covered',balance,redeemed,rejection,unknownResult,external,originalReceiptVerified:true};writeFileSync(join(output,'result.json'),redact(JSON.stringify(report,null,2))+'\n');console.log(JSON.stringify({passed:true,externalWrites:external.writes,externalCalls:external.calls.length,report:join(output,'result.json')},null,2));
}catch(error){writeFileSync(join(output,'failure.json'),redact(JSON.stringify({passed:false,error:error instanceof Error?error.message:String(error)},null,2))+'\n');throw error;
}finally{if(java)await stop(java);await stop(mock);writeFileSync(join(output,'java.log'),redact(javaLog));}
