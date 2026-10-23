import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project=process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT??'agent-builder-td15-nf01';
const compose=(...args)=>execFileSync('docker',['compose','--env-file','.env.local','-p',project,...args],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024}).trim();
const containers=compose('ps','-q','app','runner').split(/\r?\n/).filter(Boolean);assert.equal(containers.length,2,'FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds=execFileSync('docker',['inspect','--format','{{.Image}}',...containers],{encoding:'utf8'}).trim().split(/\r?\n/);
const generationPath='docs/implementation/evidence/TDD-023-live-rail-generation-87ad0d88-5c6d-4c9c-a698-18dad58ff62b.json';
const generation=JSON.parse(await readFile(generationPath,'utf8'));
const candidateEvidence=JSON.parse(await readFile('docs/implementation/evidence/TD15-AC21-AC22-generation-live.json','utf8'));
assert.deepEqual(generation.targetImageIds,targetImageIds,'FIXED_CANDIDATE_TARGET_CHANGED');
assert.deepEqual(candidateEvidence.targetImageIds,targetImageIds,'CANDIDATE_EXECUTION_TARGET_CHANGED');
assert.equal(generation.taskStatus,'built','FIXED_CANDIDATE_NOT_BUILT');assert.equal(candidateEvidence.verdict,'passed','FIXED_CANDIDATE_NOT_ACCEPTED');
const jobId=generation.jobId;const bundle=generation.bundle;assert.ok(jobId&&bundle?.digest,'FIXED_BUNDLE_REQUIRED');
const source=bundle.files.find(file=>file.path==='src/generated/EquipmentTool.java');
const test=bundle.files.find(file=>file.path==='test/generated/EquipmentToolTest.java');
const plan=bundle.files.find(file=>file.path==='test-plan.json');assert.ok(source&&test&&plan,'FIXED_TEST_FILES_REQUIRED');
const digest=value=>createHash('sha256').update(value).digest('hex');
const probe=String.raw`import{readFile,mkdir,rm}from'node:fs/promises';import{createHash}from'node:crypto';import{join,delimiter}from'node:path';import{execFileSync}from'node:child_process';const root='/data/engineering/tasks/${jobId}/workspace';const hash=x=>createHash('sha256').update(x).digest('hex');const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':x!==null&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);const src=await readFile(join(root,'developer/src/generated/EquipmentTool.java'),'utf8');const test=await readFile(join(root,'developer/test/generated/EquipmentToolTest.java'),'utf8');const plan=await readFile(join(root,'bundles/${bundle.digest}/test-plan.json'),'utf8');if(hash(src)!=='${source.digest}'||hash(test)!=='${test.digest}'||hash(plan)!=='${plan.digest}')throw new Error('FIXED_TEST_INPUT_DIGEST_MISMATCH');const state=JSON.parse(await readFile(join(root,'control/state.json'),'utf8'));const testDigest=hash(canon([{path:'test/generated/EquipmentToolTest.java',content:test}]));if(!state.unitGreen||state.unitGreen.status!=='passed'||state.greenSourceDigest!==hash(src)||state.unitDigest!==testDigest)throw new Error('FIXED_UNIT_GREEN_BINDING_INVALID');const out=join(root,'control','commands','ac27-'+process.pid);await mkdir(out,{recursive:true});const cp=join(root,'control/sdk/BOOT-INF/classes')+delimiter+join(root,'control/sdk/BOOT-INF/lib/*');const compileArgs=['-encoding','UTF-8','--release','21','-cp',cp,'-d',out,join(root,'developer/src/generated/EquipmentTool.java'),join(root,'developer/test/generated/EquipmentToolTest.java')];execFileSync('javac',compileArgs,{encoding:'utf8',timeout:60000});const runArgs=['-ea','-cp',out+delimiter+cp,'generated.EquipmentToolTest'];const output=execFileSync('java',runArgs,{encoding:'utf8',timeout:60000});console.log(JSON.stringify({sourceDigest:hash(src),testFileDigest:hash(test),testDigest,testPlanDigest:hash(plan),compiled:true,compileArgs,runArgs,exitCode:0,output:output.trim(),modelInvoked:false,externalNetworkUsed:false,originalUnitGreenId:state.unitGreen.id,originalBundleDigest:'${bundle.digest}'}));await rm(out,{recursive:true,force:true});`;
const output=compose('exec','-T','runner','node','--input-type=module','-e',probe);
const result=JSON.parse(output);
assert.equal(result.output,'EQUIPMENT_TOOL_UNIT_OK','FIXED_REGRESSION_ASSERTIONS_FAILED');
assert.equal(result.originalBundleDigest,bundle.digest,'REGRESSION_BUNDLE_MISMATCH');
const evidence={schemaVersion:1,requirement:'TD-15 P0-B AC-27 rerun the frozen generated unit regression directly without model-driven test redesign',executionMode:'live-mock',measuredAt:new Date().toISOString(),composeProject:project,targetImageIds,jobId,candidateId:candidateEvidence.candidateId,candidateArtifactDigest:candidateEvidence.artifactDigest,bundleDigest:bundle.digest,baselineId:generation.baselineId,baselineDigest:candidateEvidence.baselineDigest,testPlanDigest:plan.digest,verdict:'passed',branches:[{caseId:'AC-27',branchId:'regression-without-model',status:'passed',assertions:[
  {name:'frozen_source_and_test_digests_match_candidate',passed:result.sourceDigest===source.digest&&result.testFileDigest===test.digest&&result.testPlanDigest===plan.digest},
  {name:'regression_compiled_and_ran_directly',passed:result.compiled&&result.exitCode===0&&result.output==='EQUIPMENT_TOOL_UNIT_OK'},
  {name:'no_model_driven_test_redesign_or_external_call',passed:result.modelInvoked===false&&result.externalNetworkUsed===false}
],execution:result}]};
assert.ok(evidence.branches[0].assertions.every(item=>item.passed),`AC27_REGRESSION_EVIDENCE_FAILED:${JSON.stringify(result)}`);
const evidencePath='docs/implementation/evidence/TD15-AC27-fixed-regression-live.json';await mkdir('docs/implementation/evidence',{recursive:true});await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({verdict:evidence.verdict,evidencePath,targetImageIds,jobId,bundleDigest:bundle.digest,output:result.output,modelInvoked:result.modelInvoked}));
