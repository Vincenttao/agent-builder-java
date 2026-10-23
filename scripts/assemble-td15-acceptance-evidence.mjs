import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const imageIds = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(imageIds.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
const currentImages = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...imageIds], { encoding: 'utf8' }).trim().split(/\r?\n/);
const nf01 = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
const nf01Validation = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-validation-branches.json', 'utf8'));
const ac11 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC11-duplicates-live.json', 'utf8'));
const ac42a = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC42a-trusted-local-live.json', 'utf8'));
const ac14 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC14-snapshot-change-live.json', 'utf8'));
const ac16 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC16-rollback-live.json', 'utf8'));
const ac21ac22 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC21-AC22-generation-live.json', 'utf8'));
const ac22dRailBoundaryXml = await readFile('java/runtime-bridge/target/surefire-reports/TEST-local.agentbuilder.bridge.AgentAssemblerTest.xml', 'utf8');
const ac22dRailBoundarySource = await readFile('java/runtime-bridge/src/test/java/local/agentbuilder/bridge/AgentAssemblerTest.java', 'utf8');
const nf01Restart = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-restart-snapshot-events.json', 'utf8'));
const nf01TwoSessions = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-two-sessions.json', 'utf8'));
const nf01Sse = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-sse-reconnect.json', 'utf8'));
const nf05 = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF05-workspace.json', 'utf8'));
const ac24 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC24-candidate-integrity-live.json', 'utf8'));
const ac26 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC26-docker-live.json', 'utf8'));
const ac23 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC23-policy-audit-live.json', 'utf8'));
const ac30 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC30-mock-isolation-live.json', 'utf8'));
const ac31 = JSON.parse(await readFile('docs/implementation/evidence/TDD-086/finance-generation-live.json', 'utf8'));
const ac29aBudgetRestart = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC29a-budget-restart-live.json', 'utf8'));
const ac01 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC01-no-model.json', 'utf8'));
const ac02 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC02-mode-switch.json', 'utf8'));
const ac03 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC03-requirement-impact.json', 'utf8'));
const ac04 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC04-invalid-assembly.json', 'utf8'));
const ac06 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC06-incompatible-assembly.json', 'utf8'));
const ac05 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC05-two-rails-live.json', 'utf8'));
const ac07 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC07-http-mcp-live.json', 'utf8'));
const nf02 = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF02-live.json', 'utf8'));
const nf03 = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF03-benchmark.json', 'utf8'));
const nf04Iteration = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF04-iterations-live.json', 'utf8'));
const nf04Errors = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF04-errors-live.json', 'utf8'));
const nf04Budget = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF04-budget-live.json', 'utf8'));
const nf04Retention = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF04-retention-config.json', 'utf8'));
const nf04EventRetention = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF04-event-retention-live.json', 'utf8'));
const nf06Cancel = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF06-cancel-child-process-live.json', 'utf8'));
const eq02Unavailable = JSON.parse(await readFile('docs/implementation/evidence/TD15-EQ02-tool-unavailable-live.json', 'utf8'));
const ac20TestLog = await readFile('docs/implementation/evidence/TD15-AC20-simulation-not-publishable.test.log', 'utf8');
const ac15 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC15-startup-failure-live.json', 'utf8'));
const ac19 = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC19-cancel-unknown-write-live.json', 'utf8'));
const eq01 = JSON.parse(await readFile('docs/implementation/evidence/TD15-EQ01-empty-retrieval-live.json', 'utf8'));
const manifestBytes = await readFile('tests/acceptance/manifest.json');
const manifest = JSON.parse(manifestBytes.toString());
assert.equal(nf01.verdict, 'passed-safety-with-expected-interruption');
assert.equal(nf01.composeProject, project);
assert.deepEqual(nf01.targetImageIds, currentImages, 'NF01_EVIDENCE_TARGET_CHANGED');
assert.equal(nf01Validation.validationId, nf01.validationId, 'NF01_BRANCH_VALIDATION_MISMATCH');
assert.equal(nf01Validation.candidateId, nf01.candidateId, 'NF01_BRANCH_CANDIDATE_MISMATCH');
assert.deepEqual(nf01Validation.targetImageIds, currentImages, 'NF01_BRANCH_TARGET_CHANGED');
assert.equal(ac11.composeProject, project);
assert.equal(ac11.candidateId, nf01.candidateId, 'AC11_CANDIDATE_CHANGED');
assert.deepEqual(ac11.targetImageIds, currentImages, 'AC11_TARGET_CHANGED');
assert.equal(ac42a.composeProject, project);
assert.deepEqual(ac42a.targetImageIds, currentImages, 'AC42A_TARGET_CHANGED');
assert.equal(ac14.verdict, 'passed');
assert.deepEqual(ac14.targetImageIds, currentImages, 'AC14_TARGET_CHANGED');
assert.equal(ac16.verdict, 'passed');
assert.deepEqual(ac16.targetImageIds, currentImages, 'AC16_TARGET_CHANGED');
assert.equal(ac21ac22.verdict, 'passed', 'AC21_AC22_GENERATION_NOT_PASSED');
assert.deepEqual(ac21ac22.targetImageIds, currentImages, 'AC21_AC22_TARGET_CHANGED');
assert.ok(ac21ac22.branches.length === 11 && ac21ac22.branches.every(branch => branch.status === 'passed' && branch.assertions.every(item => item.passed)), 'AC21_AC22_BRANCH_ASSERTION_FAILED');
const railBoundarySuite = ac22dRailBoundaryXml.match(/<testsuite\b[^>]*>/)?.[0];
assert.ok(railBoundarySuite && Number(railBoundarySuite.match(/\btests="(\d+)"/)?.[1]) >= 7
  && Number(railBoundarySuite.match(/\bfailures="(\d+)"/)?.[1]) === 0
  && Number(railBoundarySuite.match(/\berrors="(\d+)"/)?.[1]) === 0, 'AC22D_RAIL_BOUNDARY_TEST_NOT_GREEN');
assert.match(ac22dRailBoundaryXml, /name="generatedToolCallLimitRailHonorsBelowAtAndAboveLimitAcrossRuns"/, 'AC22D_RAIL_BOUNDARY_TEST_MISSING');
assert.ok(ac22dRailBoundarySource.includes('assertThat(calls.get()).isEqualTo(2)')
  && ac22dRailBoundarySource.includes('assertThat(calls.get()).isEqualTo(5)')
  && ac22dRailBoundarySource.includes('assertThat(calls.get()).isEqualTo(8)')
  && ac22dRailBoundarySource.includes('assertThat(modelCalls.get()).isEqualTo(11)'), 'AC22D_RAIL_BOUNDARY_ASSERTIONS_MISSING');
assert.equal(nf01Restart.verdict, 'passed');
assert.equal(nf01Restart.composeProject, project);
assert.equal(nf01Restart.runId, nf01.runId, 'NF01_RESTART_EVIDENCE_RUN_MISMATCH');
assert.equal(nf01TwoSessions.verdict, 'passed');
assert.equal(nf01TwoSessions.cleanupStatus, 'stopped');
assert.deepEqual(nf01TwoSessions.targetImageIds, currentImages, 'NF01_TWO_SESSION_EVIDENCE_TARGET_CHANGED');
assert.equal(nf01Sse.verdict, 'passed');
assert.equal(nf01Sse.composeProject, project);
assert.deepEqual(nf01Sse.targetImageIds, currentImages, 'NF01_SSE_EVIDENCE_TARGET_CHANGED');
assert.equal(ac01.verdict, 'passed');
assert.ok(typeof ac01.composeProject === 'string' && ac01.composeProject.startsWith('agent-builder-td15-ac01'), 'AC01_MUST_USE_ISOLATED_NO_MODEL_STACK');
assert.deepEqual(ac01.targetImageIds, currentImages, 'AC01_EVIDENCE_TARGET_CHANGED');
assert.equal(ac02.verdict, 'passed');
assert.equal(ac02.composeProject, project);
assert.equal(ac02.browserComposeProject, 'agent-builder-td15-ac01', 'AC02_BROWSER_PROJECT_MISSING');
assert.equal(ac02.servedAppImageId, currentImages[0], 'AC02_SERVED_APP_TARGET_CHANGED');
assert.deepEqual(ac02.targetImageIds, currentImages, 'AC02_EVIDENCE_TARGET_CHANGED');
assert.equal(ac03.verdict, 'passed');
assert.equal(ac03.composeProject, project);
assert.equal(ac03.browserComposeProject, 'agent-builder-td15-ac01', 'AC03_BROWSER_PROJECT_MISSING');
assert.equal(ac03.servedAppImageId, currentImages[0], 'AC03_SERVED_APP_TARGET_CHANGED');
assert.deepEqual(ac03.targetImageIds, currentImages, 'AC03_EVIDENCE_TARGET_CHANGED');
assert.equal(ac04.verdict, 'passed');
assert.equal(ac04.composeProject, project);
assert.deepEqual(ac04.targetImageIds, currentImages, 'AC04_EVIDENCE_TARGET_CHANGED');
assert.equal(ac06.verdict, 'passed');
assert.equal(ac06.composeProject, project);
assert.deepEqual(ac06.targetImageIds, currentImages, 'AC06_EVIDENCE_TARGET_CHANGED');
assert.equal(ac05.verdict, 'passed');
assert.equal(ac05.composeProject, project);
assert.deepEqual(ac05.targetImageIds, currentImages, 'AC05_EVIDENCE_TARGET_CHANGED');
assert.equal(ac07.verdict, 'passed');
assert.equal(ac07.composeProject, project);
assert.deepEqual(ac07.targetImageIds, currentImages, 'AC07_EVIDENCE_TARGET_CHANGED');
assert.equal(nf02.appImageId, currentImages[0], 'NF02_EVIDENCE_TARGET_CHANGED');
assert.equal(nf03.runtime.appImageId, currentImages[0], 'NF03_EVIDENCE_TARGET_CHANGED');
assert.equal(nf04Iteration.composeProject, project, 'NF04_ITERATION_PROJECT_CHANGED');
assert.equal(nf04Iteration.appImageId, currentImages[0], 'NF04_ITERATION_TARGET_CHANGED');
assert.equal(nf04Errors.composeProject, project, 'NF04_ERROR_PROJECT_CHANGED');
assert.equal(nf04Budget.composeProject, project, 'NF04_BUDGET_PROJECT_CHANGED');
assert.equal(nf04Retention.composeProject, project, 'NF04_RETENTION_PROJECT_CHANGED');
assert.ok(nf04Retention.containers.some(item => item.service === 'app' && item.imageId === currentImages[0])
  && nf04Retention.containers.some(item => item.service === 'runner' && item.imageId === currentImages[1]), 'NF04_RETENTION_TARGET_CHANGED');
assert.deepEqual(nf06Cancel.targetImageIds, currentImages, 'NF06_CANCEL_TARGET_CHANGED');
assert.equal(nf06Cancel.verdict, 'passed', 'NF06_CANCEL_NOT_PASSED');
assert.ok(nf06Cancel.assertions.runningChildObserved && nf06Cancel.assertions.cancellationAccepted && nf06Cancel.assertions.taskReachedCancelled
  && nf06Cancel.assertions.childTerminated && nf06Cancel.assertions.historyRetained, 'NF06_CANCEL_ASSERTION_FAILED');
assert.equal(eq02Unavailable.verdict, 'passed', 'EQ02_TOOL_UNAVAILABLE_NOT_PASSED');
assert.deepEqual(eq02Unavailable.targetImageIds, currentImages, 'EQ02_UNAVAILABLE_TARGET_CHANGED');
assert.ok(ac20TestLog.includes('does not accept simulated or unverified reports as permission to publish') && ac20TestLog.includes('Tests  4 passed'), 'AC20_SIMULATION_TEST_NOT_PASSED');
assert.equal(ac15.verdict, 'passed', 'AC15_STARTUP_FAILURE_NOT_PASSED');
assert.deepEqual(ac15.targetImageIds, currentImages, 'AC15_TARGET_CHANGED');
assert.deepEqual(ac19.targetImageIds, currentImages, 'AC19_TARGET_CHANGED');
assert.equal(ac19.verdict, 'passed', 'AC19_CANCEL_RECONCILIATION_NOT_PASSED');
assert.deepEqual(eq01.targetImageIds, currentImages, 'EQ01_TARGET_CHANGED');
assert.equal(eq01.verdict, 'passed', 'EQ01_EMPTY_RETRIEVAL_NOT_PASSED');
assert.equal(nf04EventRetention.composeProject, project, 'NF04_EVENT_RETENTION_PROJECT_CHANGED');
assert.deepEqual(nf04EventRetention.targetImageIds, currentImages, 'NF04_EVENT_RETENTION_TARGET_CHANGED');
assert.equal(nf05.verdict, 'passed');
assert.equal(nf05.targetStackRemoved, true);
assert.ok(nf05.targetImageIds.includes(currentImages[0]) && nf05.targetImageIds.includes(currentImages[1]), 'NF05_EVIDENCE_TARGET_CHANGED');
assert.equal(ac24.verdict, 'passed', 'AC24_CANDIDATE_INTEGRITY_NOT_PASSED');
assert.deepEqual(ac24.targetImageIds, currentImages, 'AC24_TARGET_CHANGED');
assert.ok(ac24.workingCopyRestored && ac24.deploymentCleanupStatus === 'stopped', 'AC24_CLEANUP_NOT_CONFIRMED');
assert.ok(Object.values(ac24.assertions).every(Boolean), 'AC24_ASSERTION_FAILED');
assert.equal(ac23.verdict, 'passed', 'AC23_POLICY_AUDIT_NOT_PASSED');
assert.deepEqual(ac23.targetImageIds, currentImages, 'AC23_TARGET_CHANGED');
assert.equal(ac30.composeProject, project, 'AC30_PROJECT_CHANGED');
assert.deepEqual(ac30.targetImageIds, currentImages, 'AC30_TARGET_CHANGED');
assert.ok(Object.values(ac30.assertions).every(Boolean), 'AC30_ASSERTION_FAILED');
assert.ok(ac23.results.find(item => item.name === 'directory')?.mcp?.rejectedEvent === true, 'AC23_DIRECTORY_NOT_REJECTED');
assert.ok(ac23.results.find(item => item.name === 'command')?.mcp?.diagnostic === 'COMMAND_NOT_ALLOWED', 'AC23_COMMAND_NOT_REJECTED');

const platformIdentity = { schemaVersion: 1, composeProject: project, appImageId: currentImages[0], runnerImageId: currentImages[1], platform: process.platform, arch: process.arch };
const artifactPath = 'test-results/acceptance/td15-platform-artifact.json';
const identityBytes = Buffer.from(JSON.stringify(platformIdentity, null, 2) + '\n');
await mkdir('test-results/acceptance/evidence', { recursive: true });
await writeFile(artifactPath, identityBytes);
const artifactDigest = createHash('sha256').update(identityBytes).digest('hex');
const compatibilityKey = createHash('sha256').update(JSON.stringify({ appImageId: currentImages[0], runnerImageId: currentImages[1], platform: process.platform, arch: process.arch })).digest('hex');
const target = { artifactPath, artifactDigest, compatibilityKey };
assert.equal(ac30.artifactDigest, artifactDigest, 'AC30_ARTIFACT_CHANGED');
assert.equal(ac30.compatibilityKey, target.compatibilityKey, 'AC30_COMPATIBILITY_CHANGED');
assert.equal(ac31.verdict, 'passed', 'AC31_FINANCE_GENERATION_NOT_PASSED');
assert.deepEqual(ac31.targetImageIds, currentImages, 'AC31_GENERATION_TARGET_CHANGED');
assert.deepEqual(ac31.finalTargetImageIds, currentImages, 'AC31_FINAL_TARGET_CHANGED');
assert.equal(ac31.requestFixture?.assembly?.generationProfileVersion, 'wealth-balance-java@1', 'AC31_PROFILE_FIXTURE_MISSING');
assert.deepEqual(ac31.requestFixture?.assembly?.generationScope, ['tool', 'skill'], 'AC31_SCOPE_FIXTURE_MISMATCH');
assert.deepEqual(ac31.requestFixture?.assembly?.toolIds, [], 'AC31_MUST_GENERATE_TOOL_FROM_EMPTY_ASSEMBLY');
assert.equal(ac31.development.status, 'built', 'AC31_GENERATION_NOT_BUILT');
assert.ok(ac31.development.roles.length === 2 && ac31.development.roles.every(role => role.status === 'completed'), 'AC31_TWO_ROLES_NOT_COMPLETED');
assert.equal(ac31.candidate.provenance, 'generated-component', 'AC31_CANDIDATE_NOT_GENERATED');
assert.ok(ac31.generatedFiles.some(file => file.path === 'src/generated/AccountBalanceTool.java')
  && ac31.generatedFiles.some(file => file.path === 'skills/balance-query/SKILL.md'), 'AC31_GENERATED_TOOL_SKILL_MISSING');
assert.equal(ac31.commands.find(command => command.id === ac31.development.bundle.unitRedId)?.exitCode, 1, 'AC31_TEST_FIRST_RED_MISSING');
assert.equal(ac31.commands.find(command => command.id === ac31.development.bundle.unitGreenId)?.exitCode, 0, 'AC31_UNIT_GREEN_MISSING');
assert.equal(ac31.commands.find(command => command.id === ac31.development.bundle.contractCheckId)?.exitCode, 0, 'AC31_CONTRACT_CHECK_FAILED');
assert.equal(ac31.commands.find(command => command.id === ac31.development.bundle.buildId)?.exitCode, 0, 'AC31_COMPONENT_BUILD_FAILED');
assert.equal(ac31.report.verdict, 'passed', 'AC31_VALIDATION_FAILED');
assert.ok(ac31.report.cases.length === 3 && ac31.report.cases.every(item => item.status === 'passed'), 'AC31_CASES_NOT_GREEN');
assert.ok(ac31.validationEvidence[0].events.some(item => item.data?.event?.event === 'skill_loaded' && item.data.event.skill === 'balance-query')
  && ac31.validationEvidence[0].events.some(item => item.data?.event?.event === 'generated_tool_invoked'), 'AC31_RUNTIME_TRACE_MISSING');
assert.equal(ac31.validationEvidence[0].calls.length, 1, 'AC31_BALANCE_CALL_MISSING');
assert.equal(ac31.validationEvidence[1].calls.length, 0, 'AC31_MISSING_ACCOUNT_MUST_NOT_CALL');
assert.ok(ac31.validationEvidence[2].events.some(item => item.data?.event?.errorCode === 'TOOL_TIMEOUT')
  && ac31.validationEvidence[2].run.result.result.content.includes('"code":"TOOL_TIMEOUT"'), 'AC31_TIMEOUT_NOT_VERIFIED');
assert.deepEqual(ac26.targetImageIds, currentImages, 'AC26_REPAIR_TARGET_CHANGED');
assert.equal(ac26.verdict, 'passed', 'AC26_REPAIR_NOT_PASSED');
assert.deepEqual(ac26.branches, { defectObserved: true, newCandidate: true, sameAssertion: true, failureHistoryRetained: true }, 'AC26_REPAIR_BRANCH_ASSERTIONS_FAILED');
assert.equal(ac26.firstVerdict, 'failed', 'AC26_ORIGINAL_DEFECT_NOT_OBSERVED');
assert.ok(ac26.repairAttempts.length > 0 && ac26.repairAttempts.every(attempt => attempt.verdict === 'passed'), 'AC26_REPAIR_ATTEMPT_FAILED');
assert.equal(ac26.releaseStatus, 'succeeded', 'AC26_REPAIRED_CANDIDATE_NOT_RELEASED');
assert.equal(ac26.businessRunStatus, 'succeeded', 'AC26_REPAIRED_AGENT_NOT_INVOKED');
assert.equal(ac26.businessExternalEvidenceCount, 1, 'AC26_EXTERNAL_BUSINESS_EVIDENCE_MISSING');
assert.equal(ac29aBudgetRestart.verdict, 'passed', 'AC29A_BUDGET_RESTART_NOT_PASSED');
assert.equal(ac29aBudgetRestart.composeProject, 'agent-builder-td15-ac29a', 'AC29A_MUST_USE_ISOLATED_STACK');
assert.deepEqual(ac29aBudgetRestart.targetImageIds, currentImages, 'AC29A_BUDGET_TARGET_CHANGED');
assert.deepEqual(ac29aBudgetRestart.finalTargetImageIds, currentImages, 'AC29A_RESTART_TARGET_CHANGED');
assert.equal(ac29aBudgetRestart.budgetResult.diagnostic, 'ENGINEERING_BUDGET_EXCEEDED', 'AC29A_BUDGET_DIAGNOSTIC_MISSING');
assert.equal(ac29aBudgetRestart.budgetResult.runningRoleObserved, true, 'AC29A_BUDGET_ROLE_NOT_OBSERVED');
assert.ok(ac29aBudgetRestart.budgetResult.maxOpenCodeProcessesDuring > 0, 'AC29A_BUDGET_CHILD_NOT_OBSERVED');
assert.equal(ac29aBudgetRestart.budgetResult.processCountAfter, 0, 'AC29A_BUDGET_CHILD_NOT_TERMINATED');
assert.equal(ac29aBudgetRestart.restart.appRunnerHealthy, true, 'AC29A_STACK_NOT_HEALTHY_AFTER_RESTART');
assert.deepEqual(ac29aBudgetRestart.restart.statusAfter, ac29aBudgetRestart.restart.statusBefore, 'AC29A_TERMINAL_JOB_CHANGED_AFTER_RESTART');
assert.deepEqual(ac29aBudgetRestart.restart.eventSequencesAfter, ac29aBudgetRestart.restart.eventSequencesBefore, 'AC29A_EVENT_HISTORY_CHANGED_AFTER_RESTART');
assert.deepEqual(ac29aBudgetRestart.restart.eventSequencesAfterStabilityWindow, ac29aBudgetRestart.restart.eventSequencesAfter, 'AC29A_TASK_REPLAYED_AFTER_RESTART');
assert.equal(ac29aBudgetRestart.restart.processCountAfter, 0, 'AC29A_RESTART_STARTED_CHILD_PROCESS');
assert.ok(ac29aBudgetRestart.finalHealth.every(status => status === 'healthy'), 'AC29A_FINAL_STACK_UNHEALTHY');
await writeFile('test-results/acceptance/td15-platform-target.json', JSON.stringify(target, null, 2) + '\n');
const binding = { baselineDigest: manifest.baselineDigest, artifactDigest, testSetDigest: createHash('sha256').update(manifestBytes).digest('hex'), compatibilityKey };

async function managedEvidence(source, destination) {
  const bytes = await readFile(source);
  await writeFile(destination, bytes);
  const path = destination.replace(/^test-results\//, '').replaceAll('\\', '/');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return [{ kind: 'assertions', path, sha256 }, { kind: 'execution-record', path, sha256 }];
}
const nf01Evidence = await managedEvidence('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'test-results/acceptance/evidence/TD15-NF01-active-write-restart.json');
const nf01ValidationEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF01-validation-branches.json', 'test-results/acceptance/evidence/TD15-NF01-validation-branches.json');
const ac11Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC11-duplicates-live.json', 'test-results/acceptance/evidence/TD15-AC11-duplicates-live.json');
const ac42aEvidence = await managedEvidence('docs/implementation/evidence/TD15-AC42a-trusted-local-live.json', 'test-results/acceptance/evidence/TD15-AC42a-trusted-local-live.json');
const ac14Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC14-snapshot-change-live.json', 'test-results/acceptance/evidence/TD15-AC14-snapshot-change-live.json');
const ac16Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC16-rollback-live.json', 'test-results/acceptance/evidence/TD15-AC16-rollback-live.json');
const ac21ac22Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC21-AC22-generation-live.json', 'test-results/acceptance/evidence/TD15-AC21-AC22-generation-live.json');
const ac22dRailBoundaryEvidence = await managedEvidence('java/runtime-bridge/target/surefire-reports/TEST-local.agentbuilder.bridge.AgentAssemblerTest.xml', 'test-results/acceptance/evidence/TD15-AC22d-rail-boundaries.xml');
const nf01RestartEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF01-restart-snapshot-events.json', 'test-results/acceptance/evidence/TD15-NF01-restart-snapshot-events.json');
const nf01TwoSessionEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF01-two-sessions.json', 'test-results/acceptance/evidence/TD15-NF01-two-sessions.json');
const nf01SseEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF01-sse-reconnect.json', 'test-results/acceptance/evidence/TD15-NF01-sse-reconnect.json');
const nf05Evidence = await managedEvidence('docs/implementation/evidence/TD15-NF05-workspace.json', 'test-results/acceptance/evidence/TD15-NF05-workspace.json');
const ac24Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC24-candidate-integrity-live.json', 'test-results/acceptance/evidence/TD15-AC24-candidate-integrity-live.json');
const ac26Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC26-docker-live.json', 'test-results/acceptance/evidence/TD15-AC26-docker-live.json');
const ac23Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC23-policy-audit-live.json', 'test-results/acceptance/evidence/TD15-AC23-policy-audit-live.json');
const ac30Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC30-mock-isolation-live.json', 'test-results/acceptance/evidence/TD15-AC30-mock-isolation-live.json');
const ac31Evidence = await managedEvidence('docs/implementation/evidence/TDD-086/finance-generation-live.json', 'test-results/acceptance/evidence/TDD-086-finance-generation-live.json');
const ac29aBudgetEvidence = await managedEvidence('docs/implementation/evidence/TD15-AC29a-budget-restart-live.json', 'test-results/acceptance/evidence/TD15-AC29a-budget-restart-live.json');
const ac01Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC01-no-model.json', 'test-results/acceptance/evidence/TD15-AC01-no-model.json');
const ac02Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC02-mode-switch.json', 'test-results/acceptance/evidence/TD15-AC02-mode-switch.json');
const ac03Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC03-requirement-impact.json', 'test-results/acceptance/evidence/TD15-AC03-requirement-impact.json');
const ac04Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC04-invalid-assembly.json', 'test-results/acceptance/evidence/TD15-AC04-invalid-assembly.json');
const ac06Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC06-incompatible-assembly.json', 'test-results/acceptance/evidence/TD15-AC06-incompatible-assembly.json');
const ac05Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC05-two-rails-live.json', 'test-results/acceptance/evidence/TD15-AC05-two-rails-live.json');
const ac07Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC07-http-mcp-live.json', 'test-results/acceptance/evidence/TD15-AC07-http-mcp-live.json');
const nf02Evidence = await managedEvidence('docs/implementation/evidence/TD15-NF02-live.json', 'test-results/acceptance/evidence/TD15-NF02-live.json');
const nf03Evidence = await managedEvidence('docs/implementation/evidence/TD15-NF03-benchmark.json', 'test-results/acceptance/evidence/TD15-NF03-benchmark.json');
const nf04IterationEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF04-iterations-live.json', 'test-results/acceptance/evidence/TD15-NF04-iterations-live.json');
const nf04ErrorEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF04-errors-live.json', 'test-results/acceptance/evidence/TD15-NF04-errors-live.json');
const nf04BudgetEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF04-budget-live.json', 'test-results/acceptance/evidence/TD15-NF04-budget-live.json');
const nf04RetentionEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF04-retention-config.json', 'test-results/acceptance/evidence/TD15-NF04-retention-config.json');
const nf04EventRetentionEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF04-event-retention-live.json', 'test-results/acceptance/evidence/TD15-NF04-event-retention-live.json');
const nf06CancelEvidence = await managedEvidence('docs/implementation/evidence/TD15-NF06-cancel-child-process-live.json', 'test-results/acceptance/evidence/TD15-NF06-cancel-child-process-live.json');
const eq02UnavailableEvidence = await managedEvidence('docs/implementation/evidence/TD15-EQ02-tool-unavailable-live.json', 'test-results/acceptance/evidence/TD15-EQ02-tool-unavailable-live.json');
const ac20Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC20-simulation-not-publishable.test.log', 'test-results/acceptance/evidence/TD15-AC20-simulation-not-publishable.test.log');
const ac15Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC15-startup-failure-live.json', 'test-results/acceptance/evidence/TD15-AC15-startup-failure-live.json');
const ac19Evidence = await managedEvidence('docs/implementation/evidence/TD15-AC19-cancel-unknown-write-live.json', 'test-results/acceptance/evidence/TD15-AC19-cancel-unknown-write-live.json');
const eq01Evidence = await managedEvidence('docs/implementation/evidence/TD15-EQ01-empty-retrieval-live.json', 'test-results/acceptance/evidence/TD15-EQ01-empty-retrieval-live.json');
const results = [
  ...ac21ac22.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest, assertions: branch.assertions, evidence: ac21ac22Evidence })),
  { caseId: 'AC-22d', branchId: 'at-limit', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'sdk_run_allows_exactly_three_generated_rail_tool_calls', passed: ac22dRailBoundaryXml.includes('failures="0"') && ac22dRailBoundarySource.includes('assertThat(calls.get()).isEqualTo(5)') && ac22dRailBoundarySource.includes('.containsEntry("count", 3)') }], evidence: [...ac21ac22Evidence, ...ac22dRailBoundaryEvidence] },
  { caseId: 'AC-22d', branchId: 'above-limit', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'sdk_run_blocks_fourth_tool_call_and_preserves_per_run_budget', passed: ac22dRailBoundaryXml.includes('failures="0"') && ac22dRailBoundarySource.includes('assertThat(calls.get()).isEqualTo(8)') && ac22dRailBoundarySource.includes('assertThat(modelCalls.get()).isEqualTo(11)') && ac22dRailBoundarySource.includes('.containsEntry("event", "limit_reached")') }], evidence: [...ac21ac22Evidence, ...ac22dRailBoundaryEvidence] },
  { caseId: 'AC-01', branchId: 'save-without-model', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'model_not_configured', passed: ac01.model === 'not_configured' }, { name: 'draft_save_enabled', passed: ac01.canSaveDraft }, { name: 'draft_persisted', passed: ac01.draftPersisted }], evidence: ac01Evidence },
  { caseId: 'AC-01', branchId: 'run-blocked', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'run_disabled_without_model', passed: !ac01.canRun }, { name: 'run_rejected_before_execution', passed: ac01.runAttemptHttpStatus === 409 && ac01.runAttemptCode === 'ENVIRONMENT_BLOCKED' }, { name: 'model_blocker_reported', passed: ac01.blockerCodes.includes('MODEL_NOT_CONFIGURED') }], evidence: ac01Evidence },
  { caseId: 'AC-02', branchId: 'guided-to-form', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'requirement_values_preserved', passed: ac02.assertions.guidedToFormPreservedValues }, { name: 'confirmation_preserved', passed: ac02.assertions.guidedToFormPreservedConfirmation }], evidence: ac02Evidence },
  { caseId: 'AC-02', branchId: 'form-to-guided', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'edits_preserved', passed: ac02.assertions.formToGuidedPreservedEdits }, { name: 'edited_field_confirmation_reset', passed: ac02.assertions.editedFieldConfirmationReset }, { name: 'saved_draft_survived_reload', passed: ac02.assertions.savedDraftSurvivedReload }], evidence: ac02Evidence },
  ...ac03.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'write_impact_and_unrelated_fields_asserted', passed: ac03.verdict === 'passed' && ac03.assertions.confirmationRequirementShown && ac03.assertions.missingWriteInterfaceShown && ac03.assertions.audienceRetained && ac03.assertions.outputRetained && ac03.assertions.hintSurvivedFormSwitch }], evidence: ac03Evidence })),
  { caseId: 'AC-04', branchId: 'unknown-tool', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'unknown_tool_rejected', passed: ac04.unknownToolRejected && ac04.unknownToolReasons.length > 0 }], evidence: ac04Evidence },
  { caseId: 'AC-04', branchId: 'invalid-rail-parameter', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'invalid_rail_parameter_rejected', passed: ac04.invalidRailRejected && ac04.invalidRailReasons.length > 0 }], evidence: ac04Evidence },
  { caseId: 'AC-04', branchId: 'invalid-change-not-applied', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'draft_unchanged', passed: ac04.draftUnchanged }, { name: 'no_partial_snapshot_created', passed: ac04.snapshotCountAfterRejectedChanges === 0 }], evidence: ac04Evidence },
  { caseId: 'AC-06', branchId: 'conflicting-rails', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'conflicting_rails_rejected', passed: ac06.conflictingRailReasons.includes('CONFLICTING_RAILS') }], evidence: ac06Evidence },
  { caseId: 'AC-06', branchId: 'unsupported-agent', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'unsupported_agent_rejected', passed: ac06.unsupportedAgentReasons.includes('UNSUPPORTED_AGENT_TYPE') }, { name: 'draft_unchanged', passed: ac06.draftUnchanged }], evidence: ac06Evidence },
  { caseId: 'AC-05', branchId: 'two-rails-loaded', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'versioned_and_runtime_rails_bound', passed: ac05.railsLoaded }, { name: 'deepagent_run_succeeded', passed: ac05.runStatus === 'succeeded' }], evidence: ac05Evidence },
  { caseId: 'AC-05', branchId: 'two-rails-triggered', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'audit_rail_observed_tool_call', passed: ac05.auditBeforeTool }, { name: 'allowlist_rail_allowed_tool', passed: ac05.allowlistAllowed },
      { name: 'mock_tool_called_once', passed: ac05.mockCalls.length === 1 && ac05.mockCalls[0].operation === 'equipment-status' }], evidence: ac05Evidence },
  { caseId: 'AC-07', branchId: 'http-tool', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'http_run_succeeded', passed: ac07.http.runStatus === 'succeeded' },
      { name: 'http_connection_and_tool_version_recorded', passed: ac07.http.httpCall?.connectionRef === 'enterprise-mock-http@1' && ac07.http.httpCall?.toolVersion === 'equipment-status-http@1' },
      { name: 'http_parameters_result_and_duration_recorded', passed: Boolean(ac07.http.httpCall?.parameterDigest && ac07.http.httpCall?.resultDigest && typeof ac07.http.httpCall?.durationMs === 'number') },
      { name: 'http_mock_call_confirmed', passed: ac07.http.mockCalls.length === 1 && ac07.http.mockCalls[0].operation === 'equipment-status' && ac07.http.mockCalls[0].status === 200 }], evidence: ac07Evidence },
  { caseId: 'AC-07', branchId: 'mcp-tool', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'mcp_run_succeeded', passed: ac07.mcp.runStatus === 'succeeded' },
      { name: 'mcp_connection_and_tool_version_recorded', passed: ac07.mcp.mcpCall?.connectionRef === 'enterprise-mock-mcp@1' && ac07.mcp.mcpCall?.toolVersion === 'equipment-status-mcp@1' && ac07.mcp.mcpCall?.serverVersion === '1.0.0' },
      { name: 'mcp_parameters_result_and_duration_recorded', passed: Boolean(ac07.mcp.mcpCall?.parameterDigest && ac07.mcp.mcpCall?.resultDigest && typeof ac07.mcp.mcpCall?.durationMs === 'number') },
      { name: 'mcp_mock_call_confirmed', passed: ac07.mcp.mockCalls.length === 1 && ac07.mcp.mockCalls[0].operation === 'equipment-status' && ac07.mcp.mockCalls[0].status === 200 }], evidence: ac07Evidence },
  { caseId: 'AC-18', branchId: 'export-no-secrets', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'credential_scan_clean', passed: nf05.credentialsAbsent }, { name: 'generated_source_exported', passed: nf05.exportedGeneratedFiles.length > 0 }], evidence: nf05Evidence },
  { caseId: 'AC-18', branchId: 'fresh-directory-import', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'fresh_compose_started', passed: nf05.targetComposeRunningServices === 4 }, { name: 'candidate_rebuilt', passed: Boolean(nf05.restoredDevelopmentJobId && nf05.restoredArtifactDigest) }, { name: 'restored_run_succeeded', passed: nf05.restoreVerdict === 'passed' }, { name: 'recovery_survived_restart', passed: nf05.recoveryPackageSurvivedAppRestart === true }], evidence: nf05Evidence },
  { caseId: 'AC-18', branchId: 'rebind-required', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'connection_rebind_required', passed: nf05.connectionRebindRequired.length > 0 }], evidence: nf05Evidence },
  { caseId: 'NF-05', branchId: 'fresh-directory-start', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'fresh_compose_and_restored_run_succeeded', passed: nf05.targetStackRemoved && nf05.targetComposeRunningServices === 4 && nf05.restoreVerdict === 'passed' }], evidence: nf05Evidence },
  { caseId: 'NF-05', branchId: 'export-import', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'source_without_credentials_rebuilt_and_ran', passed: nf05.credentialsAbsent && nf05.exportedGeneratedFiles.length > 0 && Boolean(nf05.restoredDevelopmentJobId && nf05.restoredArtifactDigest) }], evidence: nf05Evidence },
  { caseId: 'NF-05', branchId: 'configurable-ports', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'isolated_workspace_uses_distinct_configured_port', passed: Number.isInteger(Number(new URL(nf05.targetBase).port)) && Number(new URL(nf05.targetBase).port) > 0 && nf05.targetBase !== nf05.sourceBase }], evidence: nf05Evidence },
  { caseId: 'NF-05', branchId: 'rebind', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'import_requires_mock_connection_rebind', passed: nf05.connectionRebindRequired.includes('equipment-mock@1') }], evidence: nf05Evidence },
  { caseId: 'AC-24', branchId: 'dev-copy-changed', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'development_copy_change_does_not_change_or_replace_fixed_candidate', passed: ac24.assertions.developmentCopyChanged && ac24.assertions.fixedBundleUnaffected && ac24.assertions.mutatedCopyCandidateStillRuns }], evidence: ac24Evidence },
  { caseId: 'AC-24', branchId: 'tester-write-denied', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'tester_mcp_write_to_implementation_is_rejected_and_audited', passed: ac24.assertions.testerWriteRejected }], evidence: ac24Evidence },
  { caseId: 'AC-24', branchId: 'digest-before', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'candidate_digest_is_recorded_before_test', passed: /^[a-f0-9]{64}$/.test(ac24.candidateArtifactDigestBefore) && /^[a-f0-9]{64}$/.test(ac24.candidateBundleDigestBefore) }], evidence: ac24Evidence },
  { caseId: 'AC-24', branchId: 'digest-after', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'candidate_tampering_is_detected_and_original_digest_remains_fixed', passed: ac24.assertions.tamperedCandidateDigestRejected && ac24.assertions.candidateDigestStable }], evidence: ac24Evidence },
  { caseId: 'AC-26', branchId: 'defect-observed', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'failing_candidate_preserves_fixed_assertion_failure', passed: ac26.firstVerdict === 'failed' && ac26.failedCaseId === 'TC-001' && ac26.failedRuleId === 'equipment-facts' && ac26.expectedTemperatureCelsius !== ac26.actualTemperatureCelsius }], evidence: ac26Evidence },
  { caseId: 'AC-26', branchId: 'new-candidate', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'repair_creates_distinct_candidate_with_passing_validation', passed: ac26.firstCandidateId !== ac26.repairedCandidateId && ac26.repairAttempts.length > 0 && ac26.repairAttempts.every(attempt => attempt.verdict === 'passed') }], evidence: ac26Evidence },
  { caseId: 'AC-26', branchId: 'same-assertion', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'repair_retests_same_case_and_rule_against_expected_value', passed: ac26.failedCaseId === ac26.repairedCaseId && ac26.failedRuleId === ac26.repairedRuleId && ac26.repairedTemperatureCelsius === ac26.expectedTemperatureCelsius }], evidence: ac26Evidence },
  { caseId: 'AC-26', branchId: 'failure-history-retained', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'original_failure_report_is_retained_after_successful_repair', passed: ac26.failureHistoryRetained && /^[a-f0-9]{64}$/.test(ac26.originalReportDigest) && ac26.firstValidationId !== ac26.repairValidationId }], evidence: ac26Evidence },
  { caseId: 'AC-29a', branchId: 'budget', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'running_generated_task_exceeds_budget_and_stops_managed_child_without_bundle', passed: ac29aBudgetRestart.budgetResult.diagnostic === 'ENGINEERING_BUDGET_EXCEEDED' && ac29aBudgetRestart.budgetResult.runningRoleObserved && ac29aBudgetRestart.budgetResult.maxOpenCodeProcessesDuring > 0 && ac29aBudgetRestart.budgetResult.processCountAfter === 0 && !ac29aBudgetRestart.budgetResult.bundleExists }], evidence: ac29aBudgetEvidence },
  { caseId: 'AC-29a', branchId: 'restart-no-replay', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'platform_restart_preserves_terminal_task_and_does_not_replay_child_or_events', passed: ac29aBudgetRestart.restart.appRunnerHealthy && ac29aBudgetRestart.restart.statusAfter.status === 'failed' && ac29aBudgetRestart.restart.statusAfter.diagnostic === 'ENGINEERING_BUDGET_EXCEEDED' && JSON.stringify(ac29aBudgetRestart.restart.eventSequencesBefore) === JSON.stringify(ac29aBudgetRestart.restart.eventSequencesAfterStabilityWindow) && ac29aBudgetRestart.restart.processCountAfter === 0 }], evidence: ac29aBudgetEvidence },
  { caseId: 'AC-23', branchId: 'directory', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'runner_mcp_rejects_traversal_path_and_audits_it', passed: ac23.results.find(item => item.name === 'directory')?.mcp?.text === 'FILE_OPERATION_NOT_ALLOWED' && ac23.results.find(item => item.name === 'directory')?.mcp?.rejectedEvent === true }], evidence: ac23Evidence },
  { caseId: 'AC-23', branchId: 'dependency', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'unapproved_dependency_is_rejected_before_runner_execution', passed: ac23.results.find(item => item.name === 'dependency')?.code === 'DEPENDENCY_NOT_ALLOWED' && ac23.results.find(item => item.name === 'dependency')?.runnerStatus === 404 }], evidence: ac23Evidence },
  { caseId: 'AC-23', branchId: 'command', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'runner_mcp_rejects_unapproved_command_and_retains_diagnostic', passed: ac23.results.find(item => item.name === 'command')?.mcp?.text === 'COMMAND_NOT_ALLOWED' && ac23.results.find(item => item.name === 'command')?.mcp?.diagnostic === 'COMMAND_NOT_ALLOWED' }], evidence: ac23Evidence },
  { caseId: 'AC-23', branchId: 'connection', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'production_business_connection_is_rejected_before_runner_execution', passed: ac23.results.find(item => item.name === 'connection')?.code === 'BUSINESS_CONNECTION_NOT_ALLOWED' && ac23.results.find(item => item.name === 'connection')?.runnerStatus === 404 }], evidence: ac23Evidence },
  { caseId: 'AC-30', branchId: 'same-seed', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'same_seed_and_clock_produce_identical_initial_state', passed: ac30.assertions.sameSeed && ac30.seed === 'enterprise-default@1' }], evidence: ac30Evidence },
  { caseId: 'AC-30', branchId: 'independent-instances', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'write_in_one_environment_does_not_change_other_instance', passed: ac30.assertions.independentInstances && ac30.observations.firstBefore - ac30.observations.firstAfterWrite === 10000 && ac30.observations.secondAfterFirstWrite === ac30.observations.firstBefore }], evidence: ac30Evidence },
  { caseId: 'AC-30', branchId: 'active-run-reset-denied', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'reset_is_denied_while_run_reservation_active', passed: ac30.assertions.activeRunResetDenied }], evidence: ac30Evidence },
  { caseId: 'AC-30', branchId: 'unknown-write-reset-denied', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'reset_is_denied_and_timed_out_write_is_observed', passed: ac30.assertions.unknownWriteResetDenied && ac30.assertions.unknownWriteCommittedAndObserved }], evidence: ac30Evidence },
  { caseId: 'AC-30', branchId: 'history-after-reset', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'reset_restores_seed_without_removing_execution_history', passed: ac30.assertions.historyRetainedAfterReset && ac30.observations.firstRevisionAfterReset >= 2 && ac30.observations.firstCallCountAfterReset >= 2 }], evidence: ac30Evidence },
  { caseId: 'AC-31', branchId: 'generate-empty-assets', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'two_roles_generate_tool_and_skill_from_empty_component_selection', passed: ac31.development.roles.length === 2 && ac31.development.roles.every(role => role.status === 'completed') && ac31.candidate.provenance === 'generated-component' && ac31.generatedFiles.length === 2 }], evidence: ac31Evidence },
  { caseId: 'AC-31', branchId: 'load-and-query', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'generated_skill_tool_query_clarification_and_timeout_are_checked', passed: ac31.report.cases.every(item => item.status === 'passed') && ac31.validationEvidence[0].calls.length === 1 && ac31.validationEvidence[1].calls.length === 0 && ac31.validationEvidence[2].events.some(item => item.data?.event?.errorCode === 'TOOL_TIMEOUT') }], evidence: ac31Evidence },
  { caseId: 'NF-01', branchId: 'no-replay-unknown-reconcile', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'unknown_run_remains_interrupted', passed: nf01.expectedInterruption && nf01.afterRestart.runStatus === 'interrupted' },
      { name: 'original_key_reconciled', passed: nf01.validationReport.tc008Assertions.some(item => item.ruleId === 'original-key-reconciliation' && item.status === 'passed') },
      { name: 'write_not_replayed', passed: nf01.noDuplicateExternalWrite && nf01.afterRestart.duplicateWrites === 0 }], evidence: nf01Evidence }
  ,{ caseId: 'NF-01', branchId: 'restart-snapshots-events', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'snapshot_binding_survived_restart', passed: nf01Restart.snapshotBindingMatches }, { name: 'run_events_retained_without_duplicates', passed: nf01Restart.eventLogRetained && nf01Restart.eventSequenceUnique }], evidence: nf01RestartEvidence },
  { caseId: 'AC-17', branchId: 'interleaved-sessions', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'distinct_actor_conversations', passed: nf01TwoSessions.conversationsDistinct && nf01TwoSessions.actorsBoundToSeparateConversations },
      { name: 'stateful_rail_count_isolated_per_run', passed: nf01TwoSessions.isolatedRailCounts }, { name: 'cross_actor_conversation_rejected', passed: nf01TwoSessions.crossActorConversationRejected }], evidence: nf01TwoSessionEvidence },
  { caseId: 'NF-01', branchId: 'two-sessions', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'separate_actor_state_and_counts', passed: nf01TwoSessions.conversationsDistinct && nf01TwoSessions.actorsBoundToSeparateConversations && nf01TwoSessions.isolatedRailCounts },
      { name: 'cross_actor_conversation_rejected', passed: nf01TwoSessions.crossActorConversationRejected }], evidence: nf01TwoSessionEvidence }
  ,{ caseId: 'AC-13', branchId: 'refresh', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'run_found_after_refresh', passed: nf01Sse.runFoundAfterRefresh }, { name: 'snapshot_binding_stable', passed: nf01Sse.snapshotDigestBefore === nf01Sse.snapshotDigestAfter }], evidence: nf01SseEvidence },
  { caseId: 'AC-13', branchId: 'sse-reconnect', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'cursor_resumed', passed: nf01Sse.cursorResumed }, { name: 'no_missing_events', passed: nf01Sse.noGaps }], evidence: nf01SseEvidence },
  { caseId: 'AC-13', branchId: 'duplicate-events', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'no_duplicate_events', passed: nf01Sse.noDuplicates }], evidence: nf01SseEvidence },
  { caseId: 'NF-01', branchId: 'refresh-reconnect', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'run_found_after_refresh', passed: nf01Sse.runFoundAfterRefresh }, { name: 'cursor_resumed', passed: nf01Sse.cursorResumed }, { name: 'event_sequence_complete_and_unique', passed: nf01Sse.noGaps && nf01Sse.noDuplicates }], evidence: nf01SseEvidence },
  { caseId: 'NF-02', branchId: 'sentinel-logs', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'sentinel_absent_from_logs', passed: nf02.verdict === 'passed' && nf02.checks.containerLogs && nf02.scannedLogBytes > 0 }], evidence: nf02Evidence },
  { caseId: 'NF-02', branchId: 'sentinel-errors', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'sentinel_absent_from_error_response', passed: nf02.verdict === 'passed' && nf02.checks.errorResponse }], evidence: nf02Evidence },
  { caseId: 'NF-02', branchId: 'sentinel-export', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'sentinel_absent_from_export', passed: nf02.verdict === 'passed' && nf02.checks.export }], evidence: nf02Evidence },
  { caseId: 'NF-03', branchId: 'reference-workload', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'reference_machine_and_workload_recorded', passed: nf03.verdict === 'passed' && nf03.runtime.cpuModel !== 'unknown' && nf03.workload.sampleCount === 100 && nf03.workload.concurrency === 5 && nf03.workload.modelCalls === 0 }], evidence: nf03Evidence },
  { caseId: 'NF-03', branchId: 'save-p95', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'save_p95_under_target', passed: nf03.save.count === 100 && nf03.save.p95Ms < nf03.targetP95Ms }], evidence: nf03Evidence },
  { caseId: 'NF-03', branchId: 'list-p95', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'list_p95_under_target', passed: nf03.list.count === 100 && nf03.list.p95Ms < nf03.targetP95Ms }], evidence: nf03Evidence },
  { caseId: 'NF-03', branchId: 'error-rate', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'zero_failures_and_data_cleaned', passed: nf03.failures === 0 && nf03.savedRecords === 100 && nf03.cleanup === 'complete' }], evidence: nf03Evidence },
  { caseId: 'NF-04', branchId: 'iteration-limit', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'iteration_limit_is_terminal_and_bounded', passed: nf04Iteration.verdict === 'passed' && nf04Iteration.limitRespected && nf04Iteration.modelCallCount === 1 && nf04Iteration.runStatus === 'failed' && nf04Iteration.diagnostic === 'ITERATION_LIMIT_REACHED' }], evidence: nf04IterationEvidence },
  { caseId: 'NF-04', branchId: 'timeout', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'budget_timeout_stops_worker', passed: nf04Budget.verdict === 'passed' && nf04Budget.timeoutDetected && nf04Budget.workerStopped && nf04Budget.roles.some(role => role.role === 'tester' && role.status === 'cancelled') && nf04Budget.roles.some(role => role.role === 'developer' && role.status === 'skipped') }], evidence: nf04BudgetEvidence },
  { caseId: 'NF-04', branchId: 'error-classification', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'requirement_assembly_connection_runtime_errors_distinct', passed: nf04Errors.verdict === 'passed' && nf04Errors.categoriesDistinct && nf04Errors.errors.runtime.code === 'ENGINEERING_BUDGET_EXCEEDED' }], evidence: nf04ErrorEvidence },
  { caseId: 'NF-04', branchId: 'event-retention', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'expired_terminal_event_removed', passed: nf04EventRetention.verdict === 'passed' && nf04EventRetention.cleanupResult.eventCount === 1 && nf04EventRetention.observed.expiredSentinelCount === 0 },
      { name: 'history_gap_marker_persisted', passed: nf04EventRetention.observed.markerCount === 1 && nf04EventRetention.observed.markerData.removedCount === 1 && nf04EventRetention.observed.markerData.throughSeq > 0 },
      { name: 'retention_policy_effective', passed: nf04EventRetention.retentionDays === 90 && nf04EventRetention.cleanupResult.cutoff === nf04EventRetention.cutoff }], evidence: nf04EventRetentionEvidence },
  { caseId: 'AC-29a', branchId: 'cancel-child-process', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'running_child_observed_and_cancel_accepted', passed: nf06Cancel.assertions.runningChildObserved && nf06Cancel.assertions.cancellationAccepted },
      { name: 'cancelled_task_terminates_managed_process', passed: nf06Cancel.assertions.taskReachedCancelled && nf06Cancel.assertions.childTerminated }], evidence: nf06CancelEvidence },
  { caseId: 'AC-29a', branchId: 'history-retained', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'cancelled_task_retains_request_and_history', passed: nf06Cancel.assertions.historyRetained && nf06Cancel.finalStatus === 'cancelled' }], evidence: nf06CancelEvidence },
  { caseId: 'NF-06', branchId: 'runner-constraints', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'normal_task_entrypoints_enforce_allowlists_and_candidate_integrity', passed: ac23.verdict === 'passed' && ac23.results.some(item => item.name === 'directory' && item.mcp?.text === 'FILE_OPERATION_NOT_ALLOWED') && ac23.results.some(item => item.name === 'command' && item.mcp?.text === 'COMMAND_NOT_ALLOWED') && ac23.results.some(item => item.name === 'dependency' && item.code === 'DEPENDENCY_NOT_ALLOWED') && ac24.assertions.testerWriteRejected && ac24.assertions.tamperedCandidateDigestRejected }], evidence: [...ac23Evidence, ...ac24Evidence] },
  { caseId: 'NF-06', branchId: 'independent-environments', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'seeded_mock_instances_are_independent_and_reset_keeps_history', passed: ac30.assertions.sameSeed && ac30.assertions.independentInstances && ac30.assertions.activeRunResetDenied && ac30.assertions.unknownWriteResetDenied && ac30.assertions.historyRetainedAfterReset }], evidence: ac30Evidence },
  { caseId: 'NF-06', branchId: 'cancel', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'cancel_terminates_managed_opencode_child_and_retains_task', passed: nf06Cancel.assertions.cancellationAccepted && nf06Cancel.assertions.childTerminated && nf06Cancel.assertions.historyRetained }], evidence: nf06CancelEvidence },
  { caseId: 'EQ-02', branchId: 'tool-unavailable', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'unavailable_tool_returns_unknown_fact_error', passed: eq02Unavailable.runStatus === 'succeeded' && eq02Unavailable.toolError?.kind === 'tool-error'
      && eq02Unavailable.toolError?.code === 'TOOL_UNAVAILABLE' && eq02Unavailable.externalEvidenceCount === 0 }], evidence: eq02UnavailableEvidence },
  { caseId: 'AC-20', branchId: 'simulation-not-publishable', binding, executionMode: 'simulated', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'simulated_validation_rejected_for_publish', passed: ac20TestLog.includes('does not accept simulated or unverified reports as permission to publish') && ac20TestLog.includes('Tests  4 passed') }], evidence: ac20Evidence },
  { caseId: 'AC-15', branchId: 'startup-failure-keeps-release', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [{ name: 'runner_startup_failure_reason_recorded', passed: ac15.failedOperation.status === 'failed' && ac15.failedOperation.diagnostic === 'DEPENDENCY_UNAVAILABLE' },
      { name: 'published_v1_pointer_unchanged', passed: ac15.pointerUnchanged }, { name: 'previous_v1_serves_after_runner_recovery', passed: ac15.runnerRecovered && ac15.readOnlyRun.status === 'succeeded' }], evidence: ac15Evidence },
  ...ac19.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest, assertions: branch.assertions, evidence: ac19Evidence })),
  ...eq01.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest, assertions: branch.assertions, evidence: eq01Evidence })),
  ...nf01Validation.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest, assertions: branch.assertions, evidence: nf01ValidationEvidence })),
  ...ac11.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest, assertions: branch.assertions, evidence: ac11Evidence })),
  ...ac42a.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest, assertions: branch.assertions, evidence: ac42aEvidence })),
  ...ac14.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest, assertions: branch.assertions, evidence: ac14Evidence })),
  ...ac16.branches.map(branch => ({ caseId: branch.caseId, branchId: branch.branchId, binding, executionMode: 'live-mock', status: branch.status, artifactDigestAfter: artifactDigest, assertions: branch.assertions, evidence: ac16Evidence }))
];
for (const result of results) assert.ok(result.assertions.every(item => item.passed), `ASSERTION_FAILED:${result.caseId}/${result.branchId}`);
const reportPath = 'test-results/acceptance/td15-platform-results.json';
await writeFile(reportPath, JSON.stringify({ binding, results }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ verdict: 'assembled', target, resultCount: results.length, cases: results.map(({ caseId, branchId }) => `${caseId}/${branchId}`) }) + '\n');
