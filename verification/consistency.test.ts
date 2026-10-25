import test from 'node:test';
import assert from 'node:assert/strict';
import {definitionInputs,parseConsistency} from '../workbench-server/consistency-contract.js';
import {consistencyPath} from '../workbench-server/consistency-contract.js';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createWorkbench,readTree} from '../workbench-server/app.js';
import type {CodingEngine} from '../workbench-server/coding.js';
import {checkedRelease} from './fixtures/checked-release.js';
import {pcRunFixture} from './fixtures/pc-run-engine.js';

test('semantic input identity excludes test evidence but includes runtime definitions, skills and execution code',()=>{
 const files={'application.json':'{}','instructions.md':'one','skills/balance/SKILL.md':'business','tests/business-cases.json':'old','src/main/java/Main.java':'v1'};
 const original=definitionInputs(files);
 assert.equal(definitionInputs({...files,'tests/business-cases.json':'new'}).digest,original.digest);
 for(const path of ['instructions.md','skills/balance/SKILL.md','src/main/java/Main.java'])assert.notEqual(definitionInputs({...files,[path]:'changed'}).digest,original.digest);
 assert.equal(definitionInputs(Object.fromEntries(Object.entries(files).reverse())).digest,original.digest);
});

test('conflicts retain original task safeguards through rejected repairs, version changes and source-bound rechecks',async t=>{
 const root=mkdtempSync(join(tmpdir(),'consistency-')),fixture=pcRunFixture();let verdict='conflict',omitRead=false,modifySource=false;
 const engine:CodingEngine={kind:'contract-fixture',async run(input){
  const files=readTree(input.directory);delete files['.git'];const source=definitionInputs(files);let summary='contract only';
  if(input.purpose==='consistency'){
   const report={inputDigest:source.digest,verdict,issues:verdict==='clear'?[]:[{paths:['instructions.md','application.json'],description:'应用指令与业务范围冲突',impact:'查询被误认为写入',suggestion:'保留查询能力，统一业务指导'}]};
   mkdirSync(dirname(join(input.directory,consistencyPath)),{recursive:true});writeFileSync(join(input.directory,consistencyPath),JSON.stringify(report));
   if(modifySource)writeFileSync(join(input.directory,'instructions.md'),'unauthorized analysis modification');
  }else{writeFileSync(join(input.directory,'instructions.md'),'只查询已定义业务，不写入');summary='关联修订';}
  return {sessionId:'fixture',model:'fixture',summary,evidence:[{tool:'skill',status:'completed',input:{name:input.skill}},...(!omitRead?source.required:[]).map(filePath=>({tool:'read',status:'completed',input:{filePath:join(input.directory,filePath)}}))]};
 }};
 const wb=createWorkbench({root,codingEngine:engine,runEngine:fixture.engine,templateFiles:{...readTree('templates/moa'),'pom.xml':'<project/>','src/main/java/com/openjiuwen/workbench/BusinessApplication.java':'fixture'}});
 t.after(async()=>{await wb.close();wb.store.close();rmSync(root,{recursive:true,force:true});});
 const release=checkedRelease(wb.store,'moa-platform','platform','1.0.0'),p=wb.store.createApplication(release.id,'冲突闭环','application');
 const finish=async(id:string)=>{for(let n=0;n<100;n++){const j=wb.jobs.get(id,'application');if(!['running','awaiting_input'].includes(j.status))return j;await new Promise(r=>setTimeout(r,5));}throw Error('job not settled');};
 const run=await wb.runs.start(p.id,'application',p.head);for(let n=0;n<100&&wb.runs.get(run.id,'application').status!=='running';n++)await new Promise(r=>setTimeout(r,5));
 const view=await wb.runs.message(run.id,'application',{query:'兑换咖啡'}),frame=view.tasks[0];
 assert.equal(wb.consistency.state(p.id,'application').status,'unchecked');
 const report=await finish((await wb.consistency.check(p.id,'application',p.head)).id);assert.equal(report.status,'analysed',JSON.stringify(report.error));assert.equal(wb.store.get(p.id,'application').head,p.head);assert.deepEqual(report.changes,{});
 assert.equal(wb.consistency.state(p.id,'application').verification,'contract-fixture');assert.equal(wb.consistency.state(p.id,'application').blocked,true);
 verdict='needs-clarification';const ambiguous=await finish((await wb.consistency.check(p.id,'application',p.head)).id);assert.equal(wb.consistency.state(p.id,'application').status,'needs-clarification');await assert.rejects(wb.consistency.repair(ambiguous.id,'application',''),/明确业务取舍/);verdict='conflict';
 await assert.rejects(wb.jobs.apply(report.id,'application'),/不可应用/);
 await assert.rejects(wb.runs.message(run.id,'application',{query:'再次查询'}),/定义冲突/);
 await assert.rejects(wb.runs.command(run.id,'application',view.conversationId,'reply',{taskId:frame.id,token:frame.prompt.token,answer:'确认'}),/定义冲突/);
 await wb.runs.command(run.id,'application',view.conversationId,'reply',{taskId:frame.id,token:frame.prompt.token,answer:'拒绝'});assert.equal(fixture.counters.writes,0);
 const rejected=await finish((await wb.consistency.repair(report.id,'application','保留查询业务')).id);assert.equal(rejected.relatedCheckId,report.id);await wb.jobs.reject(rejected.id,'application');assert.equal(wb.store.get(p.id,'application').head,p.head);assert.equal(wb.consistency.state(p.id,'application').blocked,true);
 const repair=await finish((await wb.consistency.repair(report.id,'application','保留查询业务')).id);assert.equal(repair.status,'awaiting_review');await wb.jobs.apply(repair.id,'application');const fixed=wb.store.get(p.id,'application');assert.notEqual(fixed.head,p.head);assert.equal(wb.consistency.state(p.id,'application').status,'needs-recheck');
 await assert.rejects(wb.consistency.repair(report.id,'application','过期修订'),/诊断来源已变化/);
 verdict='clear';omitRead=true;const failed=await finish((await wb.consistency.check(p.id,'application',fixed.head)).id);assert.equal(failed.error?.code,'CONSISTENCY_SOURCE_NOT_READ');assert.equal(wb.consistency.state(p.id,'application').blocked,true);
 omitRead=false;modifySource=true;const changed=await finish((await wb.consistency.check(p.id,'application',fixed.head)).id);assert.equal(changed.error?.code,'CONSISTENCY_SOURCE_CHANGED');assert.equal(wb.store.get(p.id,'application').head,fixed.head);
 modifySource=false;const clear=await finish((await wb.consistency.check(p.id,'application',fixed.head)).id);assert.equal(clear.status,'analysed');assert.equal(wb.consistency.state(p.id,'application').blocked,false);
 assert.throws(()=>wb.consistency.guard(p.id,'application',p.head),/定义冲突/);
 const next=wb.store.save(p.id,'application',fixed.head,{'tests/notes.json':'{"new":"test only"}'}),state=wb.consistency.state(p.id,'application');assert.equal(state.head,next.head);assert.equal(state.reused,true);assert.equal(state.sourceHead,fixed.head);assert.equal(state.report?.id,clear.id);
 wb.store.save(p.id,'application',next.head,{'instructions.md':'新的业务语义'});assert.equal(wb.consistency.state(p.id,'application').blocked,true);
});

test('semantic reports require exact input identity and traceable unresolved sources',()=>{
 const source=definitionInputs({'application.json':'{}','instructions.md':'one'});
 assert.equal(parseConsistency(JSON.stringify({inputDigest:source.digest,verdict:'clear',issues:[]}),source).verdict,'clear');
 assert.throws(()=>parseConsistency(JSON.stringify({inputDigest:'wrong',verdict:'clear',issues:[]}),source));
 assert.throws(()=>parseConsistency(JSON.stringify({inputDigest:source.digest,verdict:'conflict',issues:[]}),source));
 assert.throws(()=>parseConsistency(JSON.stringify({inputDigest:source.digest,verdict:'conflict',issues:[{paths:['unknown.md'],description:'范围冲突',impact:'误路由',suggestion:'统一指导'}]}),source));
});

test('a project-authored clear JSON cannot be promoted to a fresh assistant diagnosis',async t=>{
 const root=mkdtempSync(join(tmpdir(),'consistency-forged-'));const wb=createWorkbench({root,codingEngine:{kind:'contract-fixture',async run(input){const files=readTree(input.directory);delete files['.git'];return {sessionId:'fixture',model:'fixture',summary:'no report generated',evidence:[{tool:'skill',status:'completed',input:{name:input.skill}},...definitionInputs(files).required.map(filePath=>({tool:'read',status:'completed',input:{filePath}}))]};}}});
 t.after(async()=>{await wb.close();wb.store.close();rmSync(root,{recursive:true,force:true});});
 const release=checkedRelease(wb.store,'moa-platform','platform','1.0.0'),p=wb.store.createApplication(release.id,'伪造报告拒绝','application'),source=definitionInputs(wb.store.snapshot(p.id,p.head));
 const changed=wb.store.save(p.id,'application',p.head,{[consistencyPath]:JSON.stringify({inputDigest:source.digest,verdict:'clear',issues:[]})}),job=await wb.consistency.check(p.id,'application',changed.head);
 for(let n=0;n<100&&wb.jobs.get(job.id,'application').status==='running';n++)await new Promise(r=>setTimeout(r,5));
 const result=wb.jobs.get(job.id,'application');assert.equal(result.error?.code,'CONSISTENCY_REPORT_INVALID');assert.equal(wb.consistency.state(p.id,'application').status,'unchecked');assert.equal(wb.store.get(p.id,'application').head,changed.head);
});
