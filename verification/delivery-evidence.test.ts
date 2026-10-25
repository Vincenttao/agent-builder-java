import {deliveryProofFixture} from './fixtures/delivery-proof.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';import {join,dirname} from 'node:path';
import {businessTestFixture} from './fixtures/business-workbench.js';
import {consistencyPath,definitionInputs} from '../workbench-server/consistency-contract.js';
import {readTree} from '../workbench-server/files.js';

test('delivery candidates bind exact checks, tests, run and package without promoting fixtures or changing old archives',async t=>{
 const {wb,call,project,run,input,exported,bytes,diagnosis,testRun,check,setVerdict}=await deliveryProofFixture(t);
 assert.equal((await call('/projects/'+project.id+'/delivery-candidates','platform','POST',input)).status,403);
 const created=await call('/projects/'+project.id+'/delivery-candidates','application','POST',input);assert.equal(created.status,201);const candidate=created.body.candidate;
 assert.equal(candidate.verification,'contract-only');assert.equal(candidate.business,'not-verified');assert.equal(candidate.runId,run.id);assert.equal(candidate.exportId,exported.id);assert.equal(candidate.testId,testRun.id);assert.equal(candidate.consistencyId,diagnosis.id);assert.deepEqual(candidate.artifacts,exported.artifacts);
 assert.equal((await call('/business-tests/'+testRun.id,'application','DELETE')).body.error.code,'TEST_REFERENCED');
 assert.equal((await call('/exports/'+exported.id,'application','DELETE')).body.error.code,'EXPORT_REFERENCED');
 const registration=await call('/delivery-candidates/'+candidate.id+'/registrations','application','POST',{kind:'acceptance',outcome:'passed',owner:'测试负责人',title:'企业验收登记示例',url:'https://example.com/acceptance/123',note:'用户登记，非工作台执行'});assert.equal(registration.status,201);assert.equal(registration.body.registration.source,'user-declared');
 const current=(await call('/projects/'+project.id+'/delivery-candidates')).body.candidates[0];assert.equal(current.business,'not-verified');assert.equal(current.registrations.length,1);assert.equal(current.publication,'not-published');assert.deepEqual(readFileSync(join(wb.exports.directory(exported.id),'application.tar.gz')),bytes);
 assert.equal((await call('/delivery-candidates/'+candidate.id+'/registrations','platform','POST',{kind:'handoff'})).status,403);
 assert.equal((await call('/delivery-candidates/'+candidate.id+'/registrations','application','POST',{kind:'handoff',outcome:'passed',owner:'负责人',title:'非法依据',note:'不能执行链接',url:'javascript:alert(1)'})).status,400);
 const archive=join(wb.exports.directory(exported.id),'application.tar.gz');writeFileSync(archive,'altered');assert.equal((await call('/projects/'+project.id+'/delivery-candidates','application','POST',input)).body.error.code,'EXPORT_CHANGED');writeFileSync(archive,bytes);
 await wb.runs.stop(run.id,'application');const another=await wb.runs.start(project.id,'application',project.head);for(let n=0;n<100&&wb.runs.get(another.id,'application').status!=='running';n++)await new Promise(r=>setTimeout(r,5));const otherPackage=(await wb.exports.create(project.id,'application',another.id)).record;
 assert.equal((await call('/projects/'+project.id+'/delivery-candidates','application','POST',{...input,exportId:otherPackage.id})).body.error.code,'EVIDENCE_MISMATCH');assert.equal((await call('/projects/'+project.id+'/delivery-candidates','application','POST',{...input,runId:another.id,exportId:otherPackage.id})).body.error.code,'EVIDENCE_MISMATCH');
 setVerdict('conflict');const conflict=await wb.consistency.check(project.id,'application',project.head);for(let n=0;n<100&&wb.jobs.get(conflict.id,'application').status==='running';n++)await new Promise(r=>setTimeout(r,5));assert.equal(wb.deliveryEvidence.get(candidate.id,'application').blocked,true);
 assert.equal((await call('/projects/'+project.id+'/delivery-candidates','application','POST',input)).body.error.code,'DEFINITION_CONFLICT_REQUIRES_CODING');
 assert.equal((await call('/projects/'+project.id+'/candidates','application','POST',{checkId:check.id})).body.error.code,'DEFINITION_CONFLICT_REQUIRES_CODING');
 assert.equal((await call('/delivery-candidates/'+candidate.id+'/registrations','application','POST',{kind:'acceptance',outcome:'passed',owner:'负责人',title:'冲突未解决',note:'不能登记通过'})).body.error.code,'DEFINITION_CONFLICT_REQUIRES_CODING');
 setVerdict('clear');const recheck=await wb.consistency.check(project.id,'application',project.head);for(let n=0;n<100&&wb.jobs.get(recheck.id,'application').status==='running';n++)await new Promise(r=>setTimeout(r,5));assert.equal(wb.deliveryEvidence.get(candidate.id,'application').blocked,false);
 wb.store.save(project.id,'application',project.head,{'tests/new-case.json':'{}'});assert.equal((await call('/projects/'+project.id+'/delivery-candidates')).body.candidates[0].stale,true);assert.equal((await call('/projects/'+project.id+'/delivery-candidates','application','POST',input)).status,409);assert.equal((await call('/projects/'+project.id+'/delivery-candidates','application','POST',{...input,baseHead:wb.store.get(project.id,'application').head})).body.error.code,'EVIDENCE_MISMATCH');
});
