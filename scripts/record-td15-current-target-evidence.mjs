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
  ['docs/implementation/evidence/TD15-AC01-no-model.json','AC01'],
  ['docs/implementation/evidence/TD15-AC02-mode-switch.json','AC02'],
  ['docs/implementation/evidence/TD15-AC03-requirement-impact.json','AC03'],
  ['docs/implementation/evidence/TD15-AC04-invalid-assembly.json','AC04'],
  ['docs/implementation/evidence/TD15-AC06-incompatible-assembly.json','AC06'],
  ['docs/implementation/evidence/TD15-AC07-http-mcp-live.json','AC07'],
  ['docs/implementation/evidence/TD15-AC05-two-rails-live.json','AC05'],
  ['docs/implementation/evidence/TD15-AC11-duplicates-live.json','AC11'],
  ['docs/implementation/evidence/TD15-AC14-snapshot-change-live.json','AC14'],
  ['docs/implementation/evidence/TD15-AC15-startup-failure-live.json','AC15'],
  ['docs/implementation/evidence/TD15-AC16-rollback-live.json','AC16'],
  ['docs/implementation/evidence/TD15-AC19-cancel-unknown-write-live.json','AC19'],
  ['docs/implementation/evidence/TD15-AC42a-trusted-local-live.json','AC42a'],
  ['docs/implementation/evidence/TD15-NF01-validation-branches.json','NF01-validation'],
  ['docs/implementation/evidence/TD15-AC21-AC22-generation-live.json','AC21-AC22'],
  ['docs/implementation/evidence/TD15-AC25-baseline-integrity-live.json','AC25'],
  ['docs/implementation/evidence/TD15-AC27-fixed-regression-live.json','AC27'],
  ['docs/implementation/evidence/TD15-AC32-wealth-assistant-live.json','AC32']
];
const results=[];
for(const [sourcePath,kind] of sources){
  const source=JSON.parse(await readFile(sourcePath,'utf8'));
  if(kind==='AC01')assert.equal(source.targetImageIds?.[0],appImageId,'AC01_APP_TARGET_MISMATCH');
  else assert.deepEqual(source.targetImageIds,[appImageId,runnerImageId],`${kind}_TARGET_MISMATCH`);
  if(kind==='AC11'||kind==='AC14'||kind==='AC16'||kind==='AC19'||kind==='AC42a'||kind==='NF01-validation'){
    assert.ok(source.branches.length>0&&source.branches.every(branch=>branch.status==='passed'&&branch.assertions.every(item=>item.passed===true)),`${kind}_BRANCH_NOT_PASSED`);
  }else if(kind==='AC15'){
    assert.equal(source.verdict,'passed','AC15_NOT_PASSED');
  }else assert.equal(source.verdict,'passed',`${kind}_NOT_PASSED`);
  const destination=`test-results/acceptance/evidence/${sourcePath.split('/').at(-1)}`;
  const bytes=await readFile(sourcePath);await writeFile(destination,bytes);
  const evidencePath=destination.replace(/^test-results\//,'');const evidence=[
    {kind:'assertions',path:evidencePath,sha256:createHash('sha256').update(bytes).digest('hex')},
    {kind:'execution-record',path:evidencePath,sha256:createHash('sha256').update(bytes).digest('hex')}
  ];
  if(kind==='AC01'){
    const checks={
      'save-without-model':source.model==='not_configured'&&source.canSaveDraft===true&&source.draftPersisted===true,
      'run-blocked':source.model==='not_configured'&&source.canRun===false&&source.blockerCodes.includes('MODEL_NOT_CONFIGURED')&&source.runAttemptHttpStatus===409&&source.runAttemptCode==='ENVIRONMENT_BLOCKED'
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-01',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed},{name:'app_image_matches_current_target',passed:source.targetImageIds[0]===appImageId}],evidence});
  }else if(kind==='AC04'){
    const checks={
      'unknown-tool':source.unknownToolRejected&&source.unknownToolReasons.includes('UNKNOWN_TOOL:unknown-business-tool@1'),
      'invalid-rail-parameter':source.invalidRailRejected&&source.invalidRailReasons.includes(`UNKNOWN_RAIL:${source.invalidRailId}`),
      'invalid-change-not-applied':source.draftUnchanged&&source.snapshotCountAfterRejectedChanges===0
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-04',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});
  }else if(kind==='AC02'){
    const checks={
      'guided-to-form':source.assertions.guidedToFormPreservedValues&&source.assertions.guidedToFormPreservedConfirmation,
      'form-to-guided':source.assertions.formToGuidedPreservedEdits&&source.assertions.editedFieldConfirmationReset&&source.assertions.savedDraftSurvivedReload
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-02',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});
  }else if(kind==='AC03'){
    const checks={
      'write-confirmation-added':source.assertions.confirmationRequirementShown&&source.assertions.hintSurvivedFormSwitch,
      'resource-gap':source.assertions.missingWriteInterfaceShown,
      'unrelated-fields-retained':source.assertions.audienceRetained&&source.assertions.outputRetained
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-03',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});
  }else if(kind==='AC06'){
    const checks={
      'conflicting-rails':source.conflictingRailReasons.includes('CONFLICTING_RAILS'),
      'unsupported-agent':source.unsupportedAgentReasons.includes('UNSUPPORTED_AGENT_TYPE')
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-06',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});
  }else if(kind==='AC07'){
    const checks={
      'http-tool':source.http.runStatus==='succeeded'&&source.http.httpCall?.status==='succeeded'&&source.http.mockCalls?.some(call=>call.operation==='equipment-status'&&call.status===200),
      'mcp-tool':source.mcp.runStatus==='succeeded'&&source.mcp.mcpCall?.status==='succeeded'&&source.mcp.mockCalls?.some(call=>call.operation==='equipment-status'&&call.status===200)
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-07',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});
  }else if(kind==='AC05'){
    const checks={
      'two-rails-loaded':source.railsLoaded&&['audit','tool-allowlist'].every(name=>source.runtimeRailNames.includes(name)),
      'two-rails-triggered':source.auditBeforeTool&&source.allowlistAllowed&&source.mockCalls?.some(call=>call.operation==='equipment-status'&&call.status===200)
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-05',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});
  }else if(kind==='AC11'||kind==='AC14'||kind==='AC16'||kind==='AC19'||kind==='AC42a'||kind==='NF01-validation'){
    for(const branch of source.branches)results.push({caseId:branch.caseId,branchId:branch.branchId,binding,executionMode:'live-mock',status:branch.status,artifactDigestAfter:artifactDigest,assertions:branch.assertions,evidence});
  }else if(kind==='AC15'){
    const passed=source.pointerUnchanged===true&&source.failedOperation?.status==='failed'&&source.runnerRecovered===true&&source.readOnlyRun?.status==='succeeded';
    results.push({caseId:'AC-15',branchId:'startup-failure-keeps-release',binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'failed_startup_preserves_previous_release',passed}],evidence});
  }else if(kind==='AC21-AC22'){
    for(const branch of source.branches)results.push({caseId:branch.caseId,branchId:branch.branchId,binding,executionMode:'live-mock',status:branch.status,artifactDigestAfter:artifactDigest,assertions:branch.assertions,evidence});
  }else if(kind==='AC25'||kind==='AC27'){
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
