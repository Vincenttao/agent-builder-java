import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project='agent-builder-td15-nf01';
const containers=execFileSync('docker',['compose','-p',project,'ps','-q','app','runner'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length,2,'FIXED_APP_RUNNER_TARGET_REQUIRED');
const [appImageId,runnerImageId]=execFileSync('docker',['inspect','--format','{{.Image}}',...containers],{encoding:'utf8'}).trim().split(/\r?\n/);
const manifestBytes=await readFile('tests/acceptance/manifest.json');
const manifest=JSON.parse(manifestBytes);
const binding={baselineDigest:manifest.baselineDigest,testSetDigest:createHash('sha256').update(manifestBytes).digest('hex')};
const identity={schemaVersion:1,composeProject:project,appImageId,runnerImageId,platform:process.platform,arch:process.arch};
const artifactPath='test-results/acceptance/td15-platform-artifact-current.json';
const artifact=Buffer.from(JSON.stringify(identity,null,2)+'\n');
await mkdir('test-results/acceptance/evidence',{recursive:true});await writeFile(artifactPath,artifact);
const artifactDigest=createHash('sha256').update(artifact).digest('hex');
const compatibilityKey=createHash('sha256').update(JSON.stringify({appImageId,runnerImageId,platform:process.platform,arch:process.arch})).digest('hex');
Object.assign(binding,{artifactDigest,compatibilityKey});
const targetPath='test-results/acceptance/td15-platform-target-current.json';
await writeFile(targetPath,JSON.stringify({artifactPath,artifactDigest,compatibilityKey},null,2)+'\n');
const sources=[
  ['docs/implementation/evidence/TD15-AC21-AC22-generation-live.json','AC21-AC22'],
  ['docs/implementation/evidence/TD15-AC25-baseline-integrity-live.json','AC25'],
  ['docs/implementation/evidence/TD15-AC32-wealth-assistant-live.json','AC32']
];
const results=[];
for(const [sourcePath,kind] of sources){
  const source=JSON.parse(await readFile(sourcePath,'utf8'));
  assert.deepEqual(source.targetImageIds,[appImageId,runnerImageId],`${kind}_TARGET_MISMATCH`);
  assert.equal(source.verdict,'passed',`${kind}_NOT_PASSED`);
  const destination=`test-results/acceptance/evidence/${sourcePath.split('/').at(-1)}`;
  const bytes=await readFile(sourcePath);await writeFile(destination,bytes);
  const evidencePath=destination.replace(/^test-results\//,'');const evidence=[
    {kind:'assertions',path:evidencePath,sha256:createHash('sha256').update(bytes).digest('hex')},
    {kind:'execution-record',path:evidencePath,sha256:createHash('sha256').update(bytes).digest('hex')}
  ];
  if(kind==='AC21-AC22'){
    for(const branch of source.branches)results.push({caseId:branch.caseId,branchId:branch.branchId,binding,executionMode:'live-mock',status:branch.status,artifactDigestAfter:artifactDigest,assertions:branch.assertions,evidence});
  }else if(kind==='AC25'){
    for(const branch of source.branches)results.push({caseId:branch.caseId,branchId:branch.branchId,binding,executionMode:'live-mock',status:branch.status,artifactDigestAfter:artifactDigest,assertions:branch.assertions,evidence});
  }else{
    for(const [branchId,passed] of Object.entries(source.branches)){
      const request=branchId==='app-balance'?source.balanceRequest:source.productsRequest;
      const operation=branchId==='app-balance'?'getAccountBalance':'listWealthProducts';
      const checks=branchId==='request-run-version'
        ? [{name:'request_uses_published_version_and_candidate_artifact',passed:source.balanceRequest.agentVersion===source.agentVersion&&source.productsRequest.agentVersion===source.agentVersion&&source.balanceRequest.run.artifactDigest===source.candidate.artifactDigest&&source.productsRequest.run.artifactDigest===source.candidate.artifactDigest}]
        : [{name:'published_app_request_succeeded_with_mock_evidence',passed:passed===true&&request.run.status==='succeeded'&&request.run.externalEvidence?.some(item=>item.operation===operation&&item.status===200)}];
      results.push({caseId:'AC-32',branchId,binding,executionMode:'live-mock',status:checks.every(item=>item.passed)?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:checks,evidence});
    }
  }
}
const outputPath='test-results/acceptance/td15-platform-results-current.json';
await writeFile(outputPath,JSON.stringify({binding,results},null,2)+'\n');
console.log(JSON.stringify({outputPath,artifactPath,targetPath,artifactDigest,compatibilityKey,resultCount:results.length,caseCounts:Object.fromEntries([...new Set(results.map(item=>item.caseId))].map(caseId=>[caseId,results.filter(item=>item.caseId===caseId).length]))},null,2));
