import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createWorkbench,readTree} from '../workbench-server/app.js';
import {pcRunFixture} from './fixtures/pc-run-engine.js';

test('technical exports pin run source/JAR, exclude local state, detect changes and retain run references',async t=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-exports-')),fixture=pcRunFixture();
 const wb=createWorkbench({root:join(root,'.workbench'),runEngine:fixture.engine,templateFiles:{...readTree(resolve('templates/moa')),'pom.xml':'<project/>','src/main/java/com/openjiuwen/workbench/BusinessApplication.java':'contract fixture'}});
 const release=wb.store.publish('moa-platform','platform','1.0.0');const app=wb.store.createApplication(release.id,'导出测试应用','application');
 const server=wb.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(async()=>{await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();rmSync(root,{recursive:true,force:true});});
 const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const call=async(path:string,method='GET',body?:unknown,role='application')=>{const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','x-workbench-role':role},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:response.status===204?null:await response.json() as any};};
 const run=await wb.runs.start(app.id,'application',app.head);for(let n=0;n<100&&wb.runs.get(run.id,'application').status!=='running';n++)await new Promise(r=>setTimeout(r,10));assert.equal(wb.runs.get(run.id,'application').status,'running');
 const forbidden=await call('/projects/'+app.id+'/exports','POST',{runId:run.id},'platform');assert.equal(forbidden.status,403);
 writeFileSync(join(root,'.env.local'),'DEEPSEEK_API_KEY='+'sk-'+'z'.repeat(32));
 assert.equal((await call('/projects/'+app.id+'/exports','POST',{})).body.error.code,'INVALID_RUN');
 assert.equal((await call('/projects/'+app.id+'/exports','POST')).status,400);
 const exported=await call('/projects/'+app.id+'/exports','POST',{runId:run.id});assert.equal(exported.status,201);const record=exported.body.export;
 assert.equal(record.head,app.head);assert.equal(record.runId,run.id);assert.equal(record.verification.standalone,'not-verified');assert.equal(record.engine,'contract-fixture');
 const manifest=await call('/exports/'+record.id+'/manifest');assert.equal(manifest.body.manifest.sourceHead,app.head);assert.equal(manifest.body.manifest.verification.business,'not-verified');
 const saved=wb.store.save(app.id,'application',app.head,{'instructions.md':'新草稿版本不改变历史包'});
 const repeated=await call('/projects/'+app.id+'/exports','POST',{runId:run.id});assert.equal(repeated.status,200);assert.equal(repeated.body.export.id,record.id);
 for(const kind of ['application','source']){
  const response=await fetch(base+'/api/exports/'+record.id+'/files/'+kind);assert.equal(response.status,200);const archive=join(root,kind+'.tar.gz');writeFileSync(archive,Buffer.from(await response.arrayBuffer()));
  const directory=join(root,'unpack '+kind);mkdirSync(directory);execFileSync('tar',['-xzf',archive,'-C',directory]);const packageRoot=join(directory,kind);
  assert.equal(JSON.parse(readFileSync(join(packageRoot,'manifest.json'),'utf8')).sourceHead,app.head);
  assert.equal(readFileSync(join(packageRoot,kind==='application'?'assets/instructions.md':'instructions.md'),'utf8').includes('新草稿版本'),false);
  const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'});assert.equal(/(?:\.env\.local|index\.sqlite|workbench\.lock|events\.jsonl|\.git\/|\.opencode\/)/.test(names),false);assert.equal(names.includes('/home/vincent'),false);
  execFileSync('sh',[join(packageRoot,'verify.sh')]);
  assert.throws(()=>execFileSync('sh',[join(packageRoot,'start.sh')],{env:{PATH:process.env.PATH},stdio:'pipe'}),(e:any)=>e.stderr.toString().includes('contract fixture'));
  assert.equal(readFileSync(join(packageRoot,'manifest.json'),'utf8').includes(root),false);
  writeFileSync(join(packageRoot,kind==='application'?'assets/instructions.md':'instructions.md'),'tampered');assert.throws(()=>execFileSync('sh',[join(packageRoot,'verify.sh')],{stdio:'pipe'}));
 }
 assert.equal((await call('/exports/'+record.id+'/files/../../.env.local')).status,404);
 writeFileSync(join(wb.exports.directory(record.id),'application.tar.gz'),'altered archive');assert.equal((await call('/exports/'+record.id+'/files/application')).body.error.code,'EXPORT_CHANGED');
 await wb.runs.stop(run.id,'application');assert.equal((await call('/runs/'+run.id,'DELETE')).body.error.code,'RUN_REFERENCED');assert.ok(existsSync(wb.runs.directory(run.id)));
 assert.equal((await call('/exports/'+record.id,'DELETE',undefined,'platform')).status,403);
 assert.equal((await call('/exports/'+record.id,'DELETE')).status,204);assert.equal((await call('/runs/'+run.id,'DELETE')).status,204);assert.equal(wb.store.get(app.id,'application').head,saved.head);
});

test('export rejects altered frozen source or JAR and leaves no ready package',async t=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-export-tamper-')),fixture=pcRunFixture();
 const wb=createWorkbench({root,runEngine:fixture.engine,templateFiles:{...readTree(resolve('templates/moa')),'pom.xml':'<project/>','src/main/java/com/openjiuwen/workbench/BusinessApplication.java':'contract fixture'}});
 t.after(async()=>{await wb.close();wb.store.close();rmSync(root,{recursive:true,force:true});});
 const release=wb.store.publish('moa-platform','platform','1.0.0'),app=wb.store.createApplication(release.id,'篡改检查','application');const run=await wb.runs.start(app.id,'application',app.head);
 for(let n=0;n<100&&wb.runs.get(run.id,'application').status!=='running';n++)await new Promise(r=>setTimeout(r,10));
 const exports=wb.exports;assert.ok(exports,'export manager must be available');
 const path=join(wb.runs.directory(run.id),'project/instructions.md'),original=readFileSync(path,'utf8');writeFileSync(path,'改动构建输入');await assert.rejects(exports.create(app.id,'application',run.id),(e:any)=>e.code==='RUN_SOURCE_CHANGED');
 rmSync(path);await assert.rejects(exports.create(app.id,'application',run.id),(e:any)=>e.code==='RUN_SOURCE_CHANGED');
 writeFileSync(path,original);const ready=wb.runs.get(run.id,'application');writeFileSync(join(wb.runs.directory(run.id),ready.artifact!.path),'changed binary');await assert.rejects(exports.create(app.id,'application',run.id),(e:any)=>e.code==='ARTIFACT_CHANGED');assert.equal(exports.list(app.id,'application').length,0);
});
