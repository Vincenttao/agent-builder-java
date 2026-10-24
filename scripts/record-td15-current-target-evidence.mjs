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
if(process.argv.includes('--target-only')){
  console.log(JSON.stringify({artifactPath,targetPath,artifactDigest,compatibilityKey,appImageId,runnerImageId},null,2));
  process.exit(0);
}
const sources=[
  ['docs/implementation/evidence/TD15-AC01-no-model.json','AC01'],
  ['docs/implementation/evidence/TD15-AC02-mode-switch.json','AC02'],
  ['docs/implementation/evidence/TD15-AC03-requirement-impact.json','AC03'],
  ['docs/implementation/evidence/TD15-NF01-sse-reconnect.json','AC13-NF01'],
  ['docs/implementation/evidence/TD15-NF01-two-sessions.json','NF01-two-sessions'],
  ['docs/implementation/evidence/TD15-NF02-live.json','NF02'],
  ['docs/implementation/evidence/TD15-NF05-workspace.json','AC18-NF05'],
  ['docs/implementation/evidence/TD15-AC04-invalid-assembly.json','AC04'],
  ['docs/implementation/evidence/TD15-AC06-incompatible-assembly.json','AC06'],
  ['docs/implementation/evidence/TD15-AC07-http-mcp-live.json','AC07'],
  ['docs/implementation/evidence/TD15-AC05-two-rails-live.json','AC05'],
  ['docs/implementation/evidence/TD15-AC11-duplicates-live.json','AC11'],
  ['docs/implementation/evidence/TD15-AC14-snapshot-change-live.json','AC14'],
  ['docs/implementation/evidence/TD15-AC15-startup-failure-live.json','AC15'],
  ['docs/implementation/evidence/TD15-AC16-rollback-live.json','AC16'],
  ['docs/implementation/evidence/TD15-AC19-cancel-unknown-write-live.json','AC19'],
  ['docs/implementation/evidence/TD15-AC20-simulation-not-publishable.json','AC20'],
  ['docs/implementation/evidence/TD15-EQ01-empty-retrieval-live.json','EQ01'],
  ['docs/implementation/evidence/TD15-EQ02-tool-unavailable-live.json','EQ02'],
  ['docs/implementation/evidence/TD15-NF01-restart-snapshot-events.json','NF01-restart'],
  ['docs/implementation/evidence/TD15-NF03-benchmark.json','NF03'],
  ['docs/implementation/evidence/TD15-NF04-iterations-live.json','NF04-iterations'],
  ['docs/implementation/evidence/TD15-NF04-budget-live.json','NF04-budget'],
  ['docs/implementation/evidence/TD15-NF04-errors-live.json','NF04-errors'],
  ['docs/implementation/evidence/TD15-NF04-event-retention-live.json','NF04-retention'],
  ['docs/implementation/evidence/TD15-AC23-policy-audit-live.json','AC23'],
  ['docs/implementation/evidence/TD15-AC24-candidate-integrity-live.json','AC24'],
  ['docs/implementation/evidence/TD15-AC30-mock-isolation-live.json','AC30'],
  ['docs/implementation/evidence/TD15-AC26-docker-live.json','AC26'],
  ['docs/implementation/evidence/TD15-AC42a-trusted-local-live.json','AC42a'],
  ['docs/implementation/evidence/TD15-NF01-validation-branches.json','NF01-validation'],
  ['docs/implementation/evidence/TD15-AC21-AC22-generation-live.json','AC21-AC22'],
  ['docs/implementation/evidence/TD15-AC21-current-live.json','AC21-current'],
  ['docs/implementation/evidence/TD15-AC25-baseline-integrity-live.json','AC25'],
  ['docs/implementation/evidence/TD15-AC27-fixed-regression-live.json','AC27'],
  ['docs/implementation/evidence/TD15-AC32-wealth-assistant-live.json','AC32']
];
const results=[];
const skippedSources=[];
for(const [sourcePath,kind] of sources){
  const source=JSON.parse(await readFile(sourcePath,'utf8'));
  const expectedIds=JSON.stringify([appImageId,runnerImageId]);
  const sourceTargetMatches=kind==='AC01'?source.targetImageIds?.[0]===appImageId
    :kind==='NF02'?source.appImageId===appImageId
    :kind==='AC18-NF05'?source.targetImageIds?.[0]===appImageId&&source.targetImageIds?.[1]===appImageId&&source.targetImageIds?.[3]===runnerImageId
    :kind==='NF03'?source.runtime?.appImageId===appImageId
    :JSON.stringify(source.targetImageIds)===expectedIds;
  if(!sourceTargetMatches&&process.argv.includes('--skip-stale-target')){
    skippedSources.push({kind,sourcePath,targetImageIds:source.targetImageIds??[source.appImageId??source.runtime?.appImageId]});
    continue;
  }
  if(kind==='AC01')assert.equal(source.targetImageIds?.[0],appImageId,'AC01_APP_TARGET_MISMATCH');
  else if(kind==='NF02')assert.equal(source.appImageId,appImageId,'NF02_APP_TARGET_MISMATCH');
  else if(kind==='AC20')assert.deepEqual(source.targetImageIds,[appImageId,runnerImageId],'AC20_TARGET_MISMATCH');
  else if(kind==='EQ01'||kind==='EQ02'||kind==='NF01-restart')assert.deepEqual(source.targetImageIds,[appImageId,runnerImageId],`${kind}_TARGET_MISMATCH`);
  else if(kind.startsWith('NF04-'))assert.deepEqual(source.targetImageIds,[appImageId,runnerImageId],`${kind}_TARGET_MISMATCH`);
  else if(kind==='AC23'||kind==='AC24'||kind==='AC30'||kind==='AC26')assert.deepEqual(source.targetImageIds,[appImageId,runnerImageId],`${kind}_TARGET_MISMATCH`);
  else if(kind==='NF03')assert.equal(source.runtime.appImageId,appImageId,'NF03_APP_TARGET_MISMATCH');
  else if(kind==='AC18-NF05'){
    assert.equal(source.targetImageIds?.[0],appImageId,'NF05_TARGET_APP_IMAGE_MISMATCH');
    assert.equal(source.targetImageIds?.[1],appImageId,'NF05_TARGET_MOCK_IMAGE_MISMATCH');
    assert.equal(source.targetImageIds?.[3],runnerImageId,'NF05_TARGET_RUNNER_IMAGE_MISMATCH');
  }
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
  }else if(kind==='NF02'){
    const checks={
      'sentinel-logs':source.checks.containerLogs&&source.checks.logChannelPresent&&source.scannedLogBytes>0,
      'sentinel-errors':source.checks.errorResponse&&source.invalidCredentialField.status===400,
      'sentinel-export':source.checks.export
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'NF-02',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed},{name:'app_image_matches_current_target',passed:source.appImageId===appImageId}],evidence});
  }else if(kind==='AC20'){
    const logBytes=await readFile(source.testLogPath);
    const logDigest=createHash('sha256').update(logBytes).digest('hex');
    assert.equal(logDigest,source.testLogSha256,'AC20_TEST_LOG_DIGEST_MISMATCH');
    assert.match(logBytes.toString('utf8'),/4 passed/,'AC20_TEST_LOG_NOT_PASSED');
    const logDestination=`test-results/acceptance/evidence/${source.testLogPath.split('/').at(-1)}`;
    await writeFile(logDestination,logBytes);
    const checks=[
      {name:'simulated_report_rejected',passed:source.assertions.simulatedReportRejected===true},
      {name:'unverified_report_rejected',passed:source.assertions.unverifiedReportRejected===true},
      {name:'current_app_and_runner_match',passed:source.targetImageIds[0]===appImageId&&source.targetImageIds[1]===runnerImageId},
      {name:'tests_passed',passed:source.passedTests===4}
    ];
    const logEvidence={kind:'execution-record',path:logDestination.slice('test-results/'.length),sha256:logDigest};
    results.push({caseId:'AC-20',branchId:'simulation-not-publishable',binding,executionMode:'simulated',status:checks.every(item=>item.passed)?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:checks,evidence:[...evidence,logEvidence]});
  }else if(kind==='EQ01'||kind==='EQ02'){
    assert.equal(source.verdict,'passed',`${kind}_NOT_PASSED`);
    for(const branch of source.branches)results.push({caseId:branch.caseId,branchId:branch.branchId,binding,executionMode:'live-mock',status:branch.status,artifactDigestAfter:artifactDigest,assertions:branch.assertions,evidence});
  }else if(kind==='NF01-restart'){
    const active=JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json','utf8'));
    const restartPassed=source.verdict==='passed'&&source.snapshotBindingMatches&&source.eventLogRetained&&source.eventSequenceUnique;
    const reconciliationPassed=active.verdict==='passed-safety-with-expected-interruption'&&active.afterRestart.duplicateWrites===0&&active.afterRestart.workOrderCount===1&&active.afterRestart.mock.operations.includes('work-order-by-key');
    results.push({caseId:'NF-01',branchId:'restart-snapshots-events',binding,executionMode:'live-mock',status:restartPassed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'snapshot_and_event_log_survive_restart',passed:restartPassed}],evidence});
    results.push({caseId:'NF-01',branchId:'no-replay-unknown-reconcile',binding,executionMode:'live-mock',status:reconciliationPassed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'unknown_write_reconciled_without_replay',passed:reconciliationPassed}],evidence});
  }else if(kind==='NF03'){
    const common=source.verdict==='passed'&&source.workload.sampleCount===100&&source.workload.concurrency===5&&source.workload.modelCalls===0&&source.cleanup==='complete';
    const checks={
      'reference-workload':common&&source.save.count===100&&source.list.count===100,
      'save-p95':common&&source.save.p95Ms<source.targetP95Ms,
      'list-p95':common&&source.list.p95Ms<source.targetP95Ms,
      'error-rate':common&&source.failures===0&&source.savedRecords===100
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'NF-03',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed},{name:'current_app_image_matches',passed:source.runtime.appImageId===appImageId}],evidence});
  }else if(kind==='NF04-iterations'){
    const passed=source.verdict==='passed'&&source.limitRespected===true&&source.maxIterations===1&&source.modelCallCount<=1&&source.cleanupStatus==='stopped';
    results.push({caseId:'NF-04',branchId:'iteration-limit',binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'deployed_run_respects_iteration_limit',passed}],evidence});
  }else if(kind==='NF04-budget'){
    const passed=source.verdict==='passed'&&source.timeoutDetected===true&&source.workerStarted===true&&source.workerStopped===true&&source.targetImageIds[0]===appImageId&&source.targetImageIds[1]===runnerImageId;
    results.push({caseId:'NF-04',branchId:'timeout',binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'engineering_worker_stops_at_budget',passed}],evidence});
  }else if(kind==='NF04-errors'){
    const codes=Object.values(source.errors).map(item=>item.code);
    const passed=source.verdict==='passed'&&source.categoriesDistinct&&new Set(codes).size===4;
    results.push({caseId:'NF-04',branchId:'error-classification',binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'error_categories_are_distinct_and_classified',passed}],evidence});
  }else if(kind==='NF04-retention'){
    const passed=source.verdict==='passed'&&source.observed.expiredSentinelCount===0&&source.observed.markerCount===1&&source.targetImageIds[0]===appImageId&&source.targetImageIds[1]===runnerImageId;
    results.push({caseId:'NF-04',branchId:'event-retention',binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'expired_events_removed_with_gap_marker',passed}],evidence});
  }else if(kind==='AC23'){
    const checks={
      directory:source.results.some(item=>item.name==='directory'&&item.code==='FILE_OPERATION_NOT_ALLOWED'),
      dependency:source.results.some(item=>item.name==='dependency'&&item.code==='DEPENDENCY_NOT_ALLOWED'),
      command:source.results.some(item=>item.name==='command'&&item.code==='COMMAND_NOT_ALLOWED'),
      connection:source.results.some(item=>item.name==='connection'&&item.code==='BUSINESS_CONNECTION_NOT_ALLOWED')
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-23',branchId,binding,executionMode:'live-mock',status:source.verdict==='passed'&&passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});
  }else if(kind==='AC24'){
    const checks={
      'dev-copy-changed':source.assertions.developmentCopyChanged,
      'tester-write-denied':source.assertions.testerWriteRejected,
      'digest-before':source.candidateArtifactDigestBefore===source.candidateArtifactDigestAfterRun&&Boolean(source.candidateBundleDigestBefore),
      'digest-after':source.assertions.fixedBundleUnaffected&&source.assertions.candidateDigestStable&&source.assertions.tamperedCandidateDigestRejected
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-24',branchId,binding,executionMode:'live-mock',status:source.verdict==='passed'&&passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed:passed===true}],evidence});
  }else if(kind==='AC30'){
    const checks={'same-seed':'sameSeed','independent-instances':'independentInstances','active-run-reset-denied':'activeRunResetDenied','unknown-write-reset-denied':'unknownWriteResetDenied','history-after-reset':'historyRetainedAfterReset'};
    for(const [branchId,key] of Object.entries(checks)){const passed=source.assertions[key]===true;results.push({caseId:'AC-30',branchId,binding,executionMode:'live-mock',status:source.verdict==='passed'&&passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});}
  }else if(kind==='AC26'){
    const checks={'defect-observed':source.branches.defectObserved&&source.firstVerdict==='failed'&&source.actualTemperatureCelsius===87,
      'new-candidate':source.branches.newCandidate&&source.firstArtifactDigest!==source.repairedArtifactDigest,
      'same-assertion':source.branches.sameAssertion&&source.failedRuleId===source.repairedRuleId&&source.repairVerdict==='passed',
      'failure-history-retained':source.branches.failureHistoryRetained&&source.failureHistoryRetained===true&&source.releaseStatus==='succeeded'&&source.businessRunStatus==='succeeded'};
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-26',branchId,binding,executionMode:'live-mock',status:source.verdict==='passed'&&passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed:passed===true}],evidence});
  }else if(kind==='AC18-NF05'){
    const files=source.exportedGeneratedFiles??[];
    const checks={
      'export-no-secrets':source.credentialsAbsent===true&&files.length>0,
      'fresh-directory-import':source.targetComposeRunningServices===4&&Boolean(source.importedDraftId&&source.restoredDevelopmentJobId&&source.restoredArtifactDigest)&&source.restoreVerdict==='passed'&&source.recoveryPackageSurvivedAppRestart===true,
      'rebind-required':(source.connectionRebindRequired?.length??0)>0,
      'fresh-directory-start':source.targetBase!==source.sourceBase&&source.targetComposeRunningServices===4&&source.targetStackRemoved===true,
      'export-import':source.credentialsAbsent===true&&files.length>0&&source.generatedArtifactsToRebuild?.some(item=>item.reason==='SOURCE_INCLUDED_BINARY_NOT_PACKAGED')&&source.restoreVerdict==='passed',
      'configurable-ports':source.targetBase?.endsWith(':18081')&&source.targetComposeRunningServices===4,
      'rebind':(source.connectionRebindRequired?.length??0)>0&&source.restoreVerdict==='passed'
    };
    const caseByBranch={'export-no-secrets':'AC-18','fresh-directory-import':'AC-18','rebind-required':'AC-18','fresh-directory-start':'NF-05','export-import':'NF-05','configurable-ports':'NF-05','rebind':'NF-05'};
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:caseByBranch[branchId],branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed},{name:'target_app_and_runner_match_current_images',passed:source.targetImageIds[0]===appImageId&&source.targetImageIds[3]===runnerImageId}],evidence});
  }else if(kind==='AC13-NF01'){
    const checks={
      'refresh':source.runFoundAfterRefresh&&source.snapshotDigestBefore===source.snapshotDigestAfter,
      'sse-reconnect':source.cursorResumed&&source.resumedEventIds.length>0,
      'duplicate-events':source.noDuplicates&&source.noGaps
    };
    for(const [branchId,passed] of Object.entries(checks))results.push({caseId:'AC-13',branchId,binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:branchId,passed}],evidence});
    const nf01Passed=source.verdict==='passed'&&source.runFoundAfterRefresh&&source.cursorResumed&&source.noDuplicates&&source.noGaps;
    results.push({caseId:'NF-01',branchId:'refresh-reconnect',binding,executionMode:'live-mock',status:nf01Passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'run_and_event_stream_resume_without_gaps',passed:nf01Passed}],evidence});
  }else if(kind==='NF01-two-sessions'){
    const runs=source.interleavedRuns??[];
    const passed=source.verdict==='passed'&&runs.length===4&&runs.every(item=>item.assertionPassed&&item.runStatus==='succeeded')
      &&source.conversationsDistinct&&source.actorsBoundToSeparateConversations&&source.crossActorConversationRejected&&source.isolatedRailCounts;
    results.push({caseId:'AC-17',branchId:'interleaved-sessions',binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'actors_conversations_tools_and_rails_are_isolated',passed}],evidence});
    results.push({caseId:'NF-01',branchId:'two-sessions',binding,executionMode:'live-mock',status:passed?'passed':'failed',artifactDigestAfter:artifactDigest,assertions:[{name:'parallel_actor_state_isolation',passed}],evidence});
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
  }else if(kind==='AC21-current'){
    for(const branch of source.branches)results.push({caseId:'AC-21',branchId:branch.branchId,binding,executionMode:'live-mock',status:branch.status,artifactDigestAfter:artifactDigest,assertions:branch.assertions,evidence});
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
await writeFile(outputPath,JSON.stringify({binding,results,skippedSources},null,2)+'\n');
console.log(JSON.stringify({outputPath,artifactPath,targetPath,artifactDigest,compatibilityKey,resultCount:results.length,skippedSourceCount:skippedSources.length,caseCounts:Object.fromEntries([...new Set(results.map(item=>item.caseId))].map(caseId=>[caseId,results.filter(item=>item.caseId===caseId).length]))},null,2));
