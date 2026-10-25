import {checkedRelease} from './fixtures/checked-release.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {ProjectStore,WorkbenchError} from '../workbench-server/projects.js';
import {readTree} from '../workbench-server/files.js';
import {RunManager} from '../workbench-server/runs.js';
import type {RunEngine,ProcessExit} from '../workbench-server/local-java.js';
const conversationId='00000000-0000-4000-8000-000000000001';
function engine(options:{fail?:boolean;wait?:boolean;loseMessage?:boolean}={}):RunEngine{
 return {
  kind:'contract-fixture',
  async build(input){
   input.onLog('build fixture '+'sk-'+'a'.repeat(32));
   if(options.wait)await new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
   if(options.fail)throw new Error('compiler failed');
   assert.ok(readFileSync(join(input.directory,'application.json'),'utf8'));
   const jar=join(input.directory,'fixture.jar');writeFileSync(jar,'explicit build fixture');return {jar};
  },
  async start(input){
   let count=0;
   const server=createServer((request,response)=>{
    response.setHeader('content-type','application/json');
    if(request.url==='/workbench/application'){response.end(JSON.stringify({runId:input.runId,mode:'live-java'}));return;}
    if(request.url==='/workbench/conversations'){response.end(JSON.stringify({conversationId,busy:false,stack:{current:null,retained:null,tasks:[]},tasks:[],events:[]}));return;}
    if(request.method==='POST'){count++;if(options.loseMessage){response.destroy();return;}}
    response.end(JSON.stringify({conversationId,busy:false,stack:{current:{id:'task',state:'WAITING_INPUT'}},tasks:[],events:[{sequence:count}]}));
   });
   server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
   const address=server.address();assert.ok(address&&typeof address!=='string');
   let end:(v:ProcessExit)=>void=()=>{};const exited=new Promise<ProcessExit>(r=>end=r);
   return {origin:`http://127.0.0.1:${address.port}`,exited,stop:async()=>{await new Promise<void>(r=>server.close(()=>r()));end({code:0,signal:null});}};
  }
 };
}
function fixture(t:test.TestContext,adapter=engine()){
 const root=mkdtempSync(join(tmpdir(),'workbench-runs-'));const store=new ProjectStore(root);const template=store.seedTemplate({...readTree('templates/moa'),'pom.xml':'<project/>','src/main/java/com/openjiuwen/workbench/BusinessApplication.java':'fixture'});const release=checkedRelease(store,template.id,'platform','1.0.0');const app=store.createApplication(release.id,'应用','application');const runs=new RunManager(store,adapter);
 t.after(async()=>{await runs.close();store.close();rmSync(root,{recursive:true,force:true});});return {root,store,runs,app,template};
}
async function settled(runs:RunManager,id:string){for(let n=0;n<200;n++){const run=runs.get(id,'application');if(!['building','starting','stopping'].includes(run.status))return run;await new Promise(r=>setTimeout(r,10));}throw new Error('run did not settle');}

test('run freezes saved content, isolates build output, proxies only owned business calls, and keeps read-only history',async t=>{
 const {store,runs,app,template}=fixture(t);const run=await runs.start(app.id,'application',app.head);const ready=await settled(runs,run.id);assert.equal(ready.status,'running');assert.equal(ready.engine,'contract-fixture');assert.equal(ready.head,app.head);assert.ok(ready.artifact);assert.ok(ready.artifact.sha256);
 assert.equal(ready.logs.join('').includes('sk-aaaaaaaa'),false);assert.equal(store.git(app.id,['status','--porcelain']),'');
 store.save(app.id,'application',app.head,{'instructions.md':'下一版本'});assert.equal(runs.get(run.id,'application').head,app.head);
 const result=await runs.message(run.id,'application',{query:'查询'});assert.equal(result.conversationId,conversationId);
 const before=await runs.conversation(run.id,'application',conversationId);const again=await runs.conversation(run.id,'platform',conversationId);assert.deepEqual(again,before);
 await assert.rejects(runs.command(run.id,'platform',conversationId,'reply',{taskId:'task',token:'x',answer:'确认'}),(e:unknown)=>e instanceof WorkbenchError&&e.code==='FORBIDDEN');
 await runs.stop(run.id,'application');const history=await runs.conversation(run.id,'application',conversationId);assert.equal(history.live,false);assert.equal(history.interrupted,true);
 await assert.rejects(runs.message(run.id,'application',{query:'重复'}),(e:unknown)=>e instanceof WorkbenchError&&e.code==='RUN_NOT_ACTIVE');
 const platformRun=await runs.start(template.id,'platform',template.head);
 assert.deepEqual(runs.listAll('application').map(r=>r.id),[run.id]);
 assert.equal(runs.listAll('platform').length,2);await runs.stop(platformRun.id,'platform');
});

test('stale revision, wrong role, and concurrent build are rejected before another build',async t=>{
 const {runs,app,template}=fixture(t,engine({wait:true}));
 await assert.rejects(runs.start(template.id,'application',template.head));await assert.rejects(runs.start(app.id,'platform',app.head));
 await assert.rejects(runs.start(app.id,'application','0'.repeat(40)),(e:unknown)=>e instanceof WorkbenchError&&e.code==='REVISION_CONFLICT');
 const run=await runs.start(app.id,'application',app.head);await assert.rejects(runs.start(app.id,'application',app.head),(e:unknown)=>e instanceof WorkbenchError&&e.code==='RUN_BUSY');
 const stopped=await runs.stop(run.id,'application');assert.equal(stopped.status,'stopped');
});

test('failed build stays visible and deletion requires owned inactive workspace',async t=>{
 const {runs,app,root}=fixture(t,engine({fail:true}));const run=await runs.start(app.id,'application',app.head);assert.equal((await settled(runs,run.id)).status,'failed');
 const directory=join(root,'runs',run.id);assert.ok(existsSync(directory));writeFileSync(join(directory,'owner.json'),JSON.stringify({id:'foreign'}));await assert.rejects(runs.remove(run.id,'application'),(e:unknown)=>e instanceof WorkbenchError&&e.code==='WORKSPACE_OWNERSHIP_MISMATCH');
 writeFileSync(join(directory,'owner.json'),JSON.stringify({kind:'workbench-run',id:run.id,projectId:app.id}));await runs.remove(run.id,'application');assert.equal(existsSync(directory),false);
});

test('HTTP runtime routes enforce owner role and preserve read-only stopped conversation',async t=>{
 const {createWorkbench}=await import('../workbench-server/app.js');const root=mkdtempSync(join(tmpdir(),'workbench-runs-api-'));
 const workbench=createWorkbench({root,runEngine:engine(),templateFiles:{...readTree('templates/moa'),'pom.xml':'<project/>','src/main/java/com/openjiuwen/workbench/BusinessApplication.java':'fixture'}});
 const server=workbench.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(async()=>{await workbench.close();await new Promise<void>(r=>server.close(()=>r()));workbench.store.close();rmSync(root,{recursive:true,force:true});});
 const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const call=async(path:string,role='application',method='GET',body?:unknown)=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json','x-workbench-role':role},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:response.status===204?null:await response.json() as any};};
 assert.equal((await call('/api/projects/moa-platform/checks','platform','POST',{})).body.report.passed,true);
 const release=(await call('/api/templates/moa-platform/releases','platform','POST',{version:'1.0.0'})).body.release;
 const project=(await call('/api/projects','application','POST',{releaseId:release.id,name:'应用'})).body.project;
 const created=await call('/api/projects/'+project.id+'/runs','application','POST',{baseHead:project.head});assert.equal(created.status,202);const run=await settled(workbench.runs,created.body.run.id);assert.equal(run.status,'running');
 const result=await call('/api/runs/'+run.id+'/messages','application','POST',{query:'查询'});assert.equal(result.status,200);assert.equal(result.body.conversationId,conversationId);
 assert.equal((await call('/api/runs/'+run.id+'/stop','platform','POST',{})).status,403);
 assert.equal((await call('/api/runs/'+run.id+'/stop','application','POST',{})).body.run.status,'stopped');
 const history=await call('/api/runs/'+run.id+'/conversations/'+conversationId,'platform');assert.equal(history.status,200);assert.equal(history.body.live,false);
 assert.equal((await call('/api/runs/'+run.id,'application','DELETE')).status,204);
});


test('an unobserved first message keeps its original conversation and is never sent twice',async t=>{
 const {runs,app}=fixture(t,engine({loseMessage:true}));const run=await runs.start(app.id,'application',app.head);await settled(runs,run.id);
 await assert.rejects(runs.message(run.id,'application',{query:'处理业务'}),(error:unknown)=>error instanceof WorkbenchError&&error.code==='JAVA_REQUEST_UNOBSERVED');
 const original=runs.get(run.id,'application');assert.deepEqual(original.conversations,[conversationId]);
 const observed=await runs.conversation(run.id,'application',conversationId);assert.equal(observed.events[0].sequence,1);assert.equal(observed.unobserved,true);
 const reconciled=await runs.observe(run.id,'application',conversationId);assert.equal(reconciled.events[0].sequence,1);assert.deepEqual(runs.get(run.id,'application').unobserved,[]);
});
