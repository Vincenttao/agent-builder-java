import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReviewManager} from '../workbench-server/reviews.js';
import {createWorkbench,readTree} from '../workbench-server/app.js';

test('fixed template metadata, empty business goal and revision-aware journey survive later template changes',async t=>{
 const root=mkdtempSync(join(tmpdir(),'journey-')),wb=createWorkbench({root,templateFiles:readTree('templates/moa')});
 const server=wb.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 t.after(async()=>{await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();rmSync(root,{recursive:true,force:true});});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const call=async(path:string,role='application',method='GET',body?:unknown)=>{const r=await fetch('http://127.0.0.1:'+address.port+'/api'+path,{method,headers:{'Content-Type':'application/json','x-workbench-role':role},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,await r.clone().text());return await r.json() as any;};
 const release=wb.store.publish('moa-platform','platform','1.0.0');
 const releases=(await call('/templates')).releases;assert.equal(releases[0].metadata.family,'moa');assert.match(releases[0].metadata.purpose,/业务/);assert.ok(releases[0].metadata.developmentSkills.some((x:any)=>x.name==='moa-application-development'));assert.equal(releases[0].metadata.commit,release.commit);
 const app=(await call('/projects','application','POST',{releaseId:release.id,name:'新应用',goal:'查询i豆余额并经确认兑换'})).project;
 let current=await call('/projects/'+app.id);assert.equal(current.sourceRelease.version,'1.0.0');assert.equal(current.sourceRelease.metadata.commit,release.commit);assert.equal(current.definition.description,'查询i豆余额并经确认兑换');assert.deepEqual(current.definition.skills,[]);assert.deepEqual(current.definition.scope.own,[]);assert.equal(current.journey.stage,'NEW');
 const template=wb.store.get('moa-platform','platform');wb.store.save(template.id,'platform',template.head,{'instructions.md':'只影响下一发行版的新指令'});
 const again=await call('/projects/'+app.id);assert.equal(again.sourceRelease.commit,release.commit);assert.equal(again.sourceRelease.metadata.digest,releases[0].metadata.digest);assert.notEqual(again.files['instructions.md'],'只影响下一发行版的新指令');
 const p=wb.store.get(app.id,'application');wb.store.save(p.id,'application',p.head,readTree('examples/commerce-wealth'));let summary=(await call('/projects/'+app.id+'/journey')).journey;assert.equal(summary.stage,'NEEDS_CHECK');
 const report=new ReviewManager(wb.store).check(app.id,'application');assert.equal(report.passed,true);summary=(await call('/projects/'+app.id+'/journey')).journey;assert.equal(summary.stage,'READY_TO_RUN');assert.equal(summary.check.id,report.id);assert.equal(summary.business,'not-verified');
 const head=wb.store.get(app.id,'application').head;wb.store.save(app.id,'application',head,{'instructions.md':'业务语义修改后必须重新检查'});summary=(await call('/projects/'+app.id+'/journey')).journey;assert.equal(summary.stage,'NEEDS_CHECK');assert.equal(summary.check,null);assert.equal(summary.previousChecks,1);
 const diagnosis=(await call('/projects/'+app.id+'/journey','platform')).journey;assert.equal(diagnosis.readOnly,true);assert.equal(diagnosis.head,summary.head);
});
