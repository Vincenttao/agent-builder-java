// Opt-in real saved-project build + Java process + business call through workbench HTTP APIs.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkbench,readTree} from '../workbench-server/app.js';
import {settings} from '../workbench-server/settings.js';
const config=settings();if(!config.apiKey)throw new Error('DEEPSEEK_API_KEY missing');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),root=resolve('.workbench/verification/workbench-runtime-'+stamp),output=resolve('test-results/dev-workbench-v2/p4/workbench-runtime-'+stamp);mkdirSync(output,{recursive:true});
const safe=(value:string)=>value.split(config.apiKey).join('[REDACTED]');
const workbench=createWorkbench({root});const server=workbench.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
const mock=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {createBusinessMock} from './mock-business/server.ts';const server=createBusinessMock().listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));process.once('SIGTERM',()=>server.close(()=>process.exit(0)));process.once('disconnect',()=>server.close(()=>process.exit(0)));`],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe','ipc']});
async function call(path:string,role='application',method='GET',body?:unknown,expected=200){const response=await fetch(base+path,{method,headers:{'content-type':'application/json','x-workbench-role':role},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const data=await response.json() as any;assert.equal(response.status,expected,JSON.stringify(data));return data;}
let run:any,lastView:any,mockOrigin:string|undefined;
try{
 const mockAddress=await Promise.race([once(mock,'message').then(([v])=>v as {port:number}),once(mock,'exit').then(()=>{throw new Error('Mock exited');}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Mock startup timeout')),10000).unref())]);const mockBase=`http://127.0.0.1:${mockAddress.port}`;mockOrigin=mockBase;
 const template=await call('/api/projects/moa-platform','platform');
 const updated=await call('/api/projects/moa-platform/files','platform','PUT',{baseHead:template.project.head,changes:{'RUNTIME.md':template.files['RUNTIME.md']+'\n平台发行：本机双层 MOA 范式。\n'}});
 const release=(await call('/api/templates/moa-platform/releases','platform','POST',{version:'1.0.0'},201)).release;
 const created=(await call('/api/projects','application','POST',{releaseId:release.id,name:'工作台运行联调应用'},201)).project;
 const empty=await call('/api/projects/'+created.id);assert.deepEqual(empty.definition.skills,[]);assert.deepEqual(empty.definition.scope.own,[]);
 const changes=readTree('examples/idou');const definition=JSON.parse(changes['application.json']);definition.connections={idou:mockBase,procurement:mockBase+'/a2a/procurement',fallback:mockBase+'/a2a/fallback'};changes['application.json']=JSON.stringify(definition,null,2)+'\n';
 const saved=(await call('/api/projects/'+created.id+'/files','application','PUT',{baseHead:created.head,changes})).project;
 run=(await call('/api/projects/'+created.id+'/runs','application','POST',{baseHead:saved.head},202)).run;console.log('Started original build:',run.id);
 for(let n=0;n<240;n++){run=(await call('/api/runs/'+run.id)).run;if(!['building','starting'].includes(run.status))break;await delay(1000);}
 writeFileSync(join(output,'run.json'),safe(JSON.stringify(run,null,2))+'\n');assert.equal(run.status,'running',run.error?.message);assert.equal(run.engine,'local-java');assert.equal(run.head,saved.head);assert.ok(run.artifact.sha256);assert.equal(workbench.store.git(created.id,['status','--porcelain']),'');
 console.log('Verified: saved project built and original Java process ready');
 const view=lastView=await call('/api/runs/'+run.id+'/messages','application','POST',{query:'查询我的i豆余额，查询后结束。'});assert.equal(view.live,true);assert.equal(view.stack.current.state,'COMPLETED');assert.ok(JSON.stringify(view).includes('1280'));
 const before=await (await fetch(mockBase+'/__mock/state')).json() as any;assert.equal(before.writes,0);assert.equal(before.calls.filter((c:any)=>c.operation==='balance').length,1);
 const read=await call('/api/runs/'+run.id+'/conversations/'+view.conversationId,'platform');assert.equal(read.stack.current.id,view.stack.current.id);assert.deepEqual(await (await fetch(mockBase+'/__mock/state')).json(),before);
 await call('/api/runs/'+run.id+'/stop','platform','POST',{},403);
 const newer=await call('/api/projects/'+created.id+'/files','application','PUT',{baseHead:saved.head,changes:{'instructions.md':changes['instructions.md']+'\n下一修订补充说明。\n'}});assert.notEqual(newer.project.head,saved.head);assert.equal((await call('/api/runs/'+run.id)).run.head,saved.head);
 const stopped=(await call('/api/runs/'+run.id+'/stop','application','POST',{})).run;assert.equal(stopped.status,'stopped');const history=await call('/api/runs/'+run.id+'/conversations/'+view.conversationId);assert.equal(history.live,false);assert.equal(history.interrupted,false);
 assert.deepEqual(await (await fetch(mockBase+'/__mock/state')).json(),before);
 const manifest=JSON.parse(readFileSync(join(root,'runs',run.id,'source.json'),'utf8'));assert.equal(manifest.head,saved.head);
 const report={passed:true,scope:'real template release/empty application + explicit hand-written business assets + frozen project Maven build/Java startup + real Flash business request through Node HTTP + read-only history; no PC/Coding/export acceptance',release,sourceHead:saved.head,editedHead:newer.project.head,run:stopped,manifest,view,history,external:before};
 writeFileSync(join(output,'result.json'),safe(JSON.stringify(report,null,2))+'\n');console.log(JSON.stringify({passed:true,runId:run.id,sourceHead:saved.head,artifact:run.artifact,externalCalls:before.calls.length,report:join(output,'result.json')},null,2));
}catch(error){let external;try{if(mockOrigin)external=await (await fetch(mockOrigin+'/__mock/state')).json();}catch{}writeFileSync(join(output,'failure.json'),safe(JSON.stringify({passed:false,error:error instanceof Error?error.message:String(error),run,lastView,external},null,2))+'\n');throw error;
}finally{
 await workbench.close();await new Promise<void>(r=>server.close(()=>r()));workbench.store.close();
 if(mock.exitCode===null&&mock.signalCode===null){const end=once(mock,'exit');mock.kill('SIGTERM');const timer=setTimeout(()=>mock.kill('SIGKILL'),3000);try{await end;}finally{clearTimeout(timer);}}
}
