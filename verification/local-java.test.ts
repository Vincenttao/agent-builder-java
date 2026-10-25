import {checkedRelease} from './fixtures/checked-release.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalJavaEngine,ownsProcess,stopOwnedProcess,type RunEngine} from '../workbench-server/local-java.js';
import {ProjectStore,WorkbenchError} from '../workbench-server/projects.js';
import {readTree} from '../workbench-server/files.js';
import {RunManager} from '../workbench-server/runs.js';
function processFixture(){
 const root=mkdtempSync(join(tmpdir(),'workbench-java-adapter-'));const key='sk-'+'a'.repeat(32);
 writeFileSync(join(root,'.env.local'),'DEEPSEEK_API_KEY='+key+'\n',{mode:0o600});
 const binary=join(root,'fixture-java.mjs');
 writeFileSync(binary,`#!/usr/bin/env node\nimport {createServer} from 'node:http';const runId=process.argv.find(v=>v.startsWith('-Dworkbench.runId=')).split('=')[1];const server=createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({runId,mode:'live-java',model:process.env.MODEL_NAME}));});server.listen(0,'127.0.0.1',()=>{process.stdout.write(process.env.DEEPSEEK_API_KEY.slice(0,12));setTimeout(()=>{process.stdout.write(process.env.DEEPSEEK_API_KEY.slice(12)+'\\n');console.log('Tomcat started on port '+server.address().port+' (http)');},30);});\n`);chmodSync(binary,0o755);
 const previousBinary=process.env.JAVA_BIN,previousKey=process.env.DEEPSEEK_API_KEY;process.env.JAVA_BIN=binary;process.env.DEEPSEEK_API_KEY=key;
 return {root,key,cleanup(){if(previousBinary===undefined)delete process.env.JAVA_BIN;else process.env.JAVA_BIN=previousBinary;if(previousKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=previousKey;rmSync(root,{recursive:true,force:true});}};
}
test('native process adapter verifies run identity, redacts split log secrets and never signals a mismatched identity',async t=>{
 const fixture=processFixture();const output:string[]=[];let handle:Awaited<ReturnType<LocalJavaEngine['start']>>|undefined;
 t.after(async()=>{if(handle)await handle.stop();fixture.cleanup();});
 handle=await new LocalJavaEngine(fixture.root).start({directory:fixture.root,jar:join(fixture.root,'fixture.jar'),stateDirectory:join(fixture.root,'state'),runId:randomUUID(),signal:new AbortController().signal,onLog:value=>output.push(value),onProcess:()=>{}});
 assert.ok(handle.process);assert.equal(ownsProcess(handle.process),true);assert.equal(output.join('').includes(fixture.key),false);
 await assert.rejects(stopOwnedProcess({...handle.process,marker:'-Dworkbench.runId=not-owned'}),(e:unknown)=>e instanceof WorkbenchError&&e.code==='PROCESS_IDENTITY_CHANGED');assert.equal(ownsProcess(handle.process),true);
 await handle.stop();assert.equal(ownsProcess(handle.process),false);
});
test('reconstructed manager adopts the original live process and blocks a second start',async t=>{
 const fixture=processFixture();const store=new ProjectStore(join(fixture.root,'data'));const native=new LocalJavaEngine(fixture.root);
 const adapter:RunEngine={kind:'process-fixture',async build(input){const jar=join(input.directory,'fixture.jar');writeFileSync(jar,'process fixture');return {jar};},start:input=>native.start(input)};
 const first=new RunManager(store,adapter);let next:RunManager|undefined;
 t.after(async()=>{if(next)await next.close();await first.close();store.close();fixture.cleanup();});
 const template=store.seedTemplate({...readTree('templates/moa'),'pom.xml':'fixture','src/main/java/com/openjiuwen/workbench/BusinessApplication.java':'fixture'});const release=checkedRelease(store,template.id,'platform','1.0.0');const app=store.createApplication(release.id,'应用','application');
 const created=await first.start(app.id,'application',app.head);let running=first.get(created.id,'application');
 for(let n=0;n<200&&running.status!=='running';n++){await new Promise(r=>setTimeout(r,10));running=first.get(created.id,'application');}assert.equal(running.status,'running');assert.ok(running.process);
 next=new RunManager(store,adapter);await next.ready;assert.equal(next.get(created.id,'application').process?.pid,running.process.pid);assert.equal(next.get(created.id,'application').status,'running');
 await assert.rejects(next.start(app.id,'application',app.head),(e:unknown)=>e instanceof WorkbenchError&&e.code==='RUN_BUSY');
 assert.equal((await next.reconnect(created.id,'application')).status,'running');await next.stop(created.id,'application');assert.equal(ownsProcess(running.process),false);
});


test('native process start uses the model configuration captured before a private registry change',async t=>{
 const fixture=processFixture(),directory=join(fixture.root,'project');mkdirSync(directory);const original=process.env.MODEL_PROFILES_JSON;delete process.env.MODEL_PROFILES_JSON;let handle:Awaited<ReturnType<LocalJavaEngine['start']>>|undefined;t.after(async()=>{if(handle)await handle.stop();fixture.cleanup();if(original!==undefined)process.env.MODEL_PROFILES_JSON=original;});
 const registry=(model:string)=>'MODEL_API_KEY='+fixture.key+'\nMODEL_PROFILES_JSON='+JSON.stringify([{id:'review',title:'Review',model,baseUrl:'http://127.0.0.1:8999/v1',keyEnv:'MODEL_API_KEY'}])+'\n';writeFileSync(join(fixture.root,'.env.local'),registry('captured-model'));writeFileSync(join(directory,'runtime-settings.json'),JSON.stringify({modelProfile:'review',environmentId:'local'}));const engine=new LocalJavaEngine(fixture.root),configuration=engine.configure(directory);writeFileSync(join(fixture.root,'.env.local'),registry('later-model'));
 handle=await engine.start({directory,configuration,runId:randomUUID(),signal:new AbortController().signal,onLog:()=>{},onProcess:()=>{},jar:join(directory,'fixture.jar'),stateDirectory:join(directory,'state')});const response=await fetch(handle.origin+'/workbench/application'),value=await response.json() as any;assert.equal(value.model,'captured-model');assert.equal(engine.configure(directory).model,'later-model');
});
