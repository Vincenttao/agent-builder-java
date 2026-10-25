import test from 'node:test';import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';import {join,dirname} from 'node:path';
import {businessTestFixture} from './business-workbench.js';
import {consistencyPath,definitionInputs} from '../../workbench-server/consistency-contract.js';
import {readTree} from '../../workbench-server/files.js';

export async function deliveryProofFixture(t:test.TestContext){
let verdict:'clear'|'conflict'='clear';
 const suite={schemaVersion:1,family:'moa',mockConnection:'idou',cases:[{id:'read',title:'零写入拒绝',steps:[{id:'ask',type:'message',query:'兑换咖啡'},{id:'no',type:'reply',answer:'拒绝',assertions:[{source:'delta',path:'writes',operator:'equals',value:0}]}]}]};
 const f=await businessTestFixture(t,suite,{codingEngine:{kind:'contract-fixture',async run(input){const files=readTree(input.directory);delete files['.git'];const source=definitionInputs(files);mkdirSync(dirname(join(input.directory,consistencyPath)),{recursive:true});writeFileSync(join(input.directory,consistencyPath),JSON.stringify({inputDigest:source.digest,verdict,issues:verdict==='clear'?[]:[{paths:['instructions.md'],description:'业务定义存在冲突',impact:'可能错误处理',suggestion:'关联修订'}]}));return {sessionId:'fixture',model:'fixture',summary:'fixture',evidence:[{tool:'skill',status:'completed',input:{name:input.skill}},...source.required.map(filePath=>({tool:'read',status:'completed',input:{filePath}}))]};}}});
 const {wb,call,project,run}=f;
 const diagnosis=await wb.consistency.check(project.id,'application',project.head);for(let n=0;n<100&&wb.jobs.get(diagnosis.id,'application').status==='running';n++)await new Promise(r=>setTimeout(r,5));assert.equal(wb.jobs.get(diagnosis.id,'application').status,'analysed');
 const check=(await call('/projects/'+project.id+'/checks','application','POST',{})).body.report;assert.equal(check.passed,true);
 const testRun=await wb.businessTests.start(project.id,'application',{baseHead:project.head,runId:run.id,allowMockWrites:true});for(let n=0;n<100&&wb.businessTests.get(testRun.id,'application').status==='running';n++)await new Promise(r=>setTimeout(r,10));assert.equal(wb.businessTests.get(testRun.id,'application').status,'passed');
 const {record:exported}=await wb.exports.create(project.id,'application',run.id),bytes=readFileSync(join(wb.exports.directory(exported.id),'application.tar.gz'));
 const input={baseHead:project.head,checkId:check.id,testId:testRun.id,runId:run.id,exportId:exported.id,consistencyId:diagnosis.id};
return {...f,input,exported,bytes,diagnosis,testRun,check,setVerdict:(value:'clear'|'conflict')=>{verdict=value;}};
}
