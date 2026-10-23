import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = (process.env.TD15_AC26_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.TD15_AC26_ORIGIN ?? 'http://127.0.0.1:8080';
const draftId = 'ab2e1ca0-becc-4a03-a716-c11b9bd80ba2';
const snapshotId = '2322594a-49b0-47e9-bebf-e681409f27ae';
const originalValidationId = '3ac4774d-1cec-4b0b-a45d-5d8d94c4f1dd';
const repairOneValidationId = 'e9673ea2-70f0-41b9-8cd5-4e590029cf35';
const repairOneCandidateId = 'ec73fec7-b7c5-41fa-ae37-42e3e57e482d';
const currentValidationId = repairOneValidationId;
const containers = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
const reference = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC23-policy-audit-live.json', 'utf8'));
assert.equal(reference.composeProject, project, 'REFERENCE_PROJECT_CHANGED');
assert.deepEqual(targetImageIds, reference.targetImageIds, 'TARGET_IMAGE_CHANGED');
const target = JSON.parse(await readFile('test-results/acceptance/td15-platform-target.json', 'utf8'));
assert.equal(createHash('sha256').update(await readFile(target.artifactPath)).digest('hex'), target.artifactDigest, 'TARGET_ARTIFACT_CHANGED');
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');

const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200, 'LOGIN_FAILED');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf, 'SESSION_CONTEXT_REQUIRED');
const readHeaders = { origin, cookie };
const writeHeaders = { ...readHeaders, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? readHeaders : writeHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `API_${method}_${response.status}_${path}:${value?.code ?? 'UNKNOWN'}`);
  return value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitJob(id) {
  const deadline = Date.now() + 15 * 60_000; let job;
  while (Date.now() < deadline) {
    job = await api(`/api/development/${id}`);
    if (['built', 'failed', 'cancelled', 'reconciling'].includes(job.status)) return job;
    await wait(1000);
  }
  throw new Error(`DEVELOPMENT_TIMEOUT:${id}`);
}
async function waitValidation(id) {
  const deadline = Date.now() + 15 * 60_000; let validation;
  while (Date.now() < deadline) {
    validation = await api(`/api/validations/${id}`);
    if (['completed', 'failed', 'cancelled'].includes(validation.status)) return validation;
    await wait(1000);
  }
  throw new Error(`VALIDATION_TIMEOUT:${id}`);
}
const generation = { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'],
  dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' };
const deploymentIds = new Set();
const attempts = [];
let repairJob; let repairCandidate; let repairValidation; let report; let release; let invocation;
try {
  const jobsResponse = await api(`/api/drafts/${draftId}/development`);
  const jobs = jobsResponse.items;
  assert.ok(Array.isArray(jobs), 'DRAFT_DEVELOPMENT_JOBS_UNAVAILABLE');
  const rootJob = jobs.find(job => job.id === '2be9e1f5-3f8a-4957-9b1a-7144ee493b01');
  const priorRepair = jobs.find(job => job.id === '8873a0d4-72d9-4e3a-8138-5421d1c14ef3');
  assert.ok(rootJob && priorRepair, 'AC26_PRIOR_JOBS_MISSING');
  assert.equal(priorRepair.status, 'built', 'AC26_PRIOR_REPAIR_NOT_BUILT');
  const rootPlanDigest = rootJob.bundle.planDigest;
  const originalReport = await api(`/api/validations/${originalValidationId}/report`);
  const priorReport = await api(`/api/validations/${repairOneValidationId}/report`);
  for (const caseRun of [...originalReport.cases, ...priorReport.cases]) if (caseRun.testDeploymentId) deploymentIds.add(caseRun.testDeploymentId);
  assert.equal(originalReport.verdict, 'failed', 'ORIGINAL_FAILURE_NOT_RETAINED');
  assert.equal(priorReport.verdict, 'failed', 'REPAIR_ONE_FAILURE_NOT_RETAINED');
  assert.equal(priorReport.binding.candidate.id, repairOneCandidateId, 'REPAIR_ONE_REPORT_BINDING_MISMATCH');
  assert.deepEqual(priorReport.cases.filter(item => item.status === 'failed').map(item => item.caseId), ['TC-003'], 'REPAIR_ONE_FAILURE_NOT_EXPECTED');
  const baselineId = priorRepair.baselineId;
  assert.equal(priorRepair.bundle.planDigest, rootPlanDigest, 'REPAIR_ONE_CHANGED_FIXED_TEST_PLAN');

  for (let attempt = 2; attempt <= 3; attempt++) {
    repairJob = await api(`/api/snapshots/${snapshotId}/development`, 'POST', { clientRequestId: randomUUID(), baselineId,
      generation, maxSeconds: 900, repairExecutionId: currentValidationId });
    repairJob = await waitJob(repairJob.id);
    assert.equal(repairJob.status, 'built', `REPAIR_${attempt}_CANDIDATE_NOT_BUILT:${repairJob.diagnostic ?? ''}`);
    assert.equal(repairJob.repair?.rootJobId, rootJob.id, `REPAIR_${attempt}_ROOT_MISMATCH`);
    assert.equal(repairJob.repair?.attempt, attempt, `REPAIR_${attempt}_ATTEMPT_NUMBER_MISMATCH`);
    assert.equal(repairJob.bundle.planDigest, rootPlanDigest, `REPAIR_${attempt}_CHANGED_FIXED_TEST_PLAN`);
    assert.ok(repairJob.roles.some(item => item.role === 'tester' && item.status === 'reused'), `REPAIR_${attempt}_TESTER_PLAN_NOT_REUSED`);
    repairCandidate = await api('/api/candidates', 'POST', { snapshotId, developmentJobId: repairJob.id });
    repairValidation = await api(`/api/snapshots/${snapshotId}/validations`, 'POST', { clientRequestId: randomUUID(), baselineId,
      allowMockWrites: false, candidateId: repairCandidate.id });
    await waitValidation(repairValidation.id);
    report = await api(`/api/validations/${repairValidation.id}/report`);
    for (const item of report.cases ?? []) if (item.testDeploymentId) deploymentIds.add(item.testDeploymentId);
    attempts.push({ attempt, jobId: repairJob.id, parentJobId: repairJob.repair.parentJobId, candidateId: repairCandidate.id,
      bundleDigest: repairJob.bundle.digest, planDigest: repairJob.bundle.planDigest, artifactDigest: repairCandidate.artifactDigest,
      validationId: repairValidation.id, verdict: report.verdict,
      failedRules: report.cases.flatMap(item => item.assertions.filter(assertion => assertion.status === 'failed').map(assertion => ({ caseId: item.caseId, ruleId: assertion.ruleId }))) });
    if (report.verdict === 'passed') break;
    assert.ok(attempt < 3, 'AC26_REPAIR_BUDGET_EXHAUSTED');
  }
  assert.equal(report?.verdict, 'passed', 'FIXED_CANDIDATE_REGRESSION_FAILED');
  const equipmentCase = report.cases.find(item => item.caseId === 'TC-001');
  const facts = equipmentCase?.assertions.find(item => item.ruleId === 'equipment-facts');
  assert.equal(equipmentCase?.status, 'passed', 'SAME_TC001_NOT_PASSED');
  assert.equal(facts?.status, 'passed', 'SAME_FACT_ASSERTION_NOT_PASSED');
  assert.equal(facts?.actual?.temperatureCelsius, 86, 'FIXED_CANDIDATE_STILL_INCORRECT');
  assert.equal(report.binding.baselineDigest, originalReport.binding.baselineDigest, 'REPAIR_BASELINE_CHANGED');
  assert.equal(report.binding.testSetDigest, originalReport.binding.testSetDigest, 'REPAIR_TEST_SET_CHANGED');
  assert.equal(report.binding.candidate.id, repairCandidate.id, 'REGRESSION_CANDIDATE_BINDING_WRONG');
  assert.equal((await api(`/api/validations/${originalValidationId}/report`)).verdict, 'failed', 'ORIGINAL_FAILURE_OVERWRITTEN');
  assert.equal((await api(`/api/validations/${repairOneValidationId}/report`)).verdict, 'failed', 'INTERMEDIATE_FAILURE_OVERWRITTEN');

  release = await api(`/api/drafts/${draftId}/releases`, 'POST', { clientRequestId: randomUUID(), snapshotId,
    validationId: repairValidation.id, expectedRevision: 0 });
  const releaseDeadline = Date.now() + 180_000;
  while (Date.now() < releaseDeadline && !['succeeded', 'failed'].includes(release.status)) { await wait(500); release = await api(`/api/releases/${release.id}`); }
  assert.equal(release.status, 'succeeded', `REPAIRED_CANDIDATE_RELEASE_FAILED:${release.diagnostic ?? ''}`);
  const grant = await api('/api/demo-sessions', 'POST', { agentId: draftId, actorId: 'U1001' });
  const businessHeaders = { authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' };
  const response = await fetch(`${base}/agent-api/agents/${draftId}/messages`, { method: 'POST', headers: businessHeaders,
    body: JSON.stringify({ clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态、温度和来源。' }), signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 202, 'REPAIRED_BUSINESS_INVOCATION_NOT_ACCEPTED');
  invocation = await response.json();
  const runDeadline = Date.now() + 120_000;
  while (Date.now() < runDeadline) {
    const runResponse = await fetch(`${base}/agent-api/requests/${invocation.requestId}`, { headers: { authorization: `Bearer ${grant.token}` } });
    assert.equal(runResponse.status, 200, 'BUSINESS_RUN_LOOKUP_FAILED'); invocation = await runResponse.json();
    if (invocation.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(invocation.run.status)) break;
    await wait(500);
  }
  assert.equal(invocation.run?.status, 'succeeded', 'REPAIRED_BUSINESS_RUN_FAILED');
  assert.equal(invocation.run?.artifactDigest, repairCandidate.artifactDigest, 'BUSINESS_RUN_NOT_ON_REPAIRED_ARTIFACT');
  assert.equal(invocation.run?.externalEvidence?.length, 1, 'BUSINESS_RUN_EXTERNAL_EVIDENCE_MISSING');

  for (const candidateId of [rootJob.repair?.candidateId, repairOneCandidateId, ...attempts.map(item => item.candidateId)]) {
    if (!candidateId) continue;
    const deployments = await api(`/api/candidates/${candidateId}/test-deployments`);
    for (const deployment of deployments) if (deployment.status === 'active') deploymentIds.add(deployment.id);
  }
  for (const caseRun of report.cases ?? []) if (caseRun.testDeploymentId) deploymentIds.add(caseRun.testDeploymentId);
  const evidence = { schemaVersion: 1, requirement: 'TD-15 P0-B AC-26 seeded defect, failure-evidence repair, fixed regression and retained history',
    executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, base, targetImageIds,
    artifactDigest: target.artifactDigest, compatibilityKey: target.compatibilityKey, draftId, snapshotId, baselineId,
    originalValidationId, originalVerdict: originalReport.verdict, originalReportDigest: createHash('sha256').update(JSON.stringify(originalReport)).digest('hex'),
    firstRepair: { jobId: priorRepair.id, candidateId: repairOneCandidateId, validationId: repairOneValidationId, verdict: priorReport.verdict,
      failedRules: priorReport.cases.flatMap(item => item.assertions.filter(assertion => assertion.status === 'failed').map(assertion => ({ caseId: item.caseId, ruleId: assertion.ruleId }))) },
    repairs: attempts, finalCandidateId: repairCandidate.id, finalArtifactDigest: repairCandidate.artifactDigest,
    finalValidationId: repairValidation.id, finalVerdict: report.verdict, finalTemperatureCelsius: facts.actual.temperatureCelsius,
    releaseId: release.id, releaseStatus: release.status, businessRunId: invocation.run.id, businessRunStatus: invocation.run.status,
    businessRunArtifactDigest: invocation.run.artifactDigest, businessExternalEvidenceCount: invocation.run.externalEvidence.length,
    failureHistoryRetained: true, verdict: 'passed' };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC26-docker-live.json', JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ verdict: evidence.verdict, repairs: attempts.map(item => ({ attempt: item.attempt, verdict: item.verdict, validationId: item.validationId })), releaseStatus: release.status, businessRunStatus: invocation.run.status }));
} finally {
  for (const id of deploymentIds) await api(`/api/test-deployments/${id}/stop`, 'POST', {}).catch(() => {});
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { ...readHeaders, 'x-csrf-token': csrf } }).catch(() => {});
}
