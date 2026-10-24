import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = (process.env.TD15_AC26_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.TD15_AC26_ORIGIN ?? 'http://127.0.0.1:8080';
const containers = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
const reference = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC23-policy-audit-live.json', 'utf8'));
assert.equal(reference.composeProject, project, 'REFERENCE_PROJECT_CHANGED');
assert.deepEqual(targetImageIds, reference.targetImageIds, 'TARGET_IMAGE_CHANGED');
const target = JSON.parse(await readFile('test-results/acceptance/td15-platform-target-current.json', 'utf8'));
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
const baselineGoal = '查询模拟设备 PUMP-001 的真实设备状态、温度和来源。验收夹具说明：初始生成候选必须含已知缺陷，仅当响应 source 为 seed-equipment-001@1 时把 temperatureCelsius 从上游值 86 错映射为 87；单元测试的模拟 source 使用 seed@1，因此单测保持绿色。不要在初始任务中移除该夹具缺陷。收到关联失败报告的 repairExecutionId 后，再按失败证据修复为原样透传。';
const systemPrompt = `你是设备运维助手。读取 equipment-query Skill 并调用 get_equipment。
缺少 equipmentId 时不得调用工具，直接输出 JSON：{"kind":"clarification","missingFields":["equipmentId"],"message":"请提供设备编号"}。
有 equipmentId 时只输出一个 JSON 对象，不要 Markdown、表格或代码围栏。字段固定为：kind="equipment-report"、equipmentId、status、temperatureCelsius、source、recommendation。设备事实字段必须逐项原样取自工具响应，不得改写。`;
let draft; let snapshot; let baseline; let firstJob; let firstCandidate; let firstValidation; let repairJob; let repairCandidate; let repairValidation;
let firstReport; let repairedReport; let release; let business; const deploymentIds = new Set();
const measuredAt = new Date().toISOString();
try {
  draft = await api('/api/drafts', 'POST', { name: `TD15-AC26-${randomUUID().slice(0, 8)}`, brief: {
    audience: { value: '企业 Agent 平台开发人员', source: 'user', confirmed: true },
    goal: { value: baselineGoal, source: 'user', confirmed: true },
    output: { value: '设备状态、温度、来源及建议', source: 'user', confirmed: true }
  } });
  snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly: {
    agentType: 'DeepAgent', systemPrompt, maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1']
  } });
  const preview = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=equipment-read%401`);
  baseline = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision,
    templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true });

  firstJob = await api(`/api/snapshots/${snapshot.id}/development`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id, generation, maxSeconds: 900 });
  firstJob = await waitJob(firstJob.id);
  assert.equal(firstJob.status, 'built', `SEEDED_CANDIDATE_NOT_BUILT:${firstJob.diagnostic ?? ''}`);
  const firstToolFile = await api(`/api/development/${firstJob.id}/file?path=src%2Fgenerated%2FEquipmentTool.java`);
  firstCandidate = await api('/api/candidates', 'POST', { snapshotId: snapshot.id, developmentJobId: firstJob.id });
  firstValidation = await api(`/api/snapshots/${snapshot.id}/validations`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id,
    allowMockWrites: false, candidateId: firstCandidate.id });
  firstValidation = await waitValidation(firstValidation.id);
  firstReport = await api(`/api/validations/${firstValidation.id}/report`);
  for (const item of firstReport.cases ?? []) if (item.testDeploymentId) deploymentIds.add(item.testDeploymentId);
  const failedCase = firstReport.cases.find(item => item.caseId === 'TC-001');
  const failedFact = failedCase?.assertions.find(item => item.ruleId === 'equipment-facts');
  const initialEvidence = failedCase?.evidenceId ? await api(`/api/validations/${firstValidation.id}/evidence/${failedCase.evidenceId}`) : null;
  const rawOutput = initialEvidence?.run?.result?.result?.content;
  const actualOutput = typeof rawOutput === 'string' ? JSON.parse(rawOutput) : rawOutput;
  assert.equal(firstReport.verdict, 'failed', 'SEEDED_CANDIDATE_DID_NOT_FAIL');
  assert.equal(failedCase?.status, 'failed', 'SEEDED_CASE_NOT_FAILED');
  assert.equal(failedFact?.status, 'failed', 'SEEDED_FACT_ASSERTION_NOT_FAILED');
  assert.equal(actualOutput?.temperatureCelsius, 87, 'SEEDED_DEFECT_NOT_OBSERVED_AS_87');
  assert.equal(actualOutput?.source, 'seed-equipment-001@1', 'SEEDED_SOURCE_MISMATCH');
  const originalPlanDigest = firstJob.bundle.planDigest;
  const originalBaselineDigest = firstReport.binding.baselineDigest;
  const originalTestSetDigest = firstReport.binding.testSetDigest;
  const originalReportDigest = createHash('sha256').update(JSON.stringify(firstReport)).digest('hex');

  const repairAttempts = [];
  let parentJob = firstJob; let parentCandidate = firstCandidate;
  let currentValidation = firstValidation; let currentReport = firstReport;
  for (let attempt = 1; attempt <= 3 && currentReport.verdict !== 'passed'; attempt++) {
    repairJob = await api(`/api/snapshots/${snapshot.id}/development`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id,
      generation, maxSeconds: 900, repairExecutionId: currentValidation.id });
    repairJob = await waitJob(repairJob.id);
    assert.equal(repairJob.status, 'built', `REPAIR_CANDIDATE_NOT_BUILT:${repairJob.diagnostic ?? ''}`);
    assert.equal(repairJob.repair?.parentJobId, parentJob.id, 'REPAIR_PARENT_MISMATCH');
    assert.equal(repairJob.bundle.planDigest, originalPlanDigest, 'REPAIR_CHANGED_FIXED_TEST_PLAN');
    assert.ok(repairJob.roles.some(item => item.role === 'tester' && item.status === 'reused'), 'TESTER_PLAN_NOT_REUSED');
    assert.notEqual(repairJob.bundle.digest, parentJob.bundle.digest, 'REPAIR_BUNDLE_NOT_NEW');
    repairCandidate = await api('/api/candidates', 'POST', { snapshotId: snapshot.id, developmentJobId: repairJob.id });
    assert.notEqual(repairCandidate.artifactDigest, parentCandidate.artifactDigest, 'REPAIR_ARTIFACT_NOT_NEW');
    repairValidation = await api(`/api/snapshots/${snapshot.id}/validations`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id,
      allowMockWrites: false, candidateId: repairCandidate.id });
    repairValidation = await waitValidation(repairValidation.id);
    repairedReport = await api(`/api/validations/${repairValidation.id}/report`);
    for (const item of repairedReport.cases ?? []) if (item.testDeploymentId) deploymentIds.add(item.testDeploymentId);
    repairAttempts.push({ attempt, jobId: repairJob.id, parentJobId: repairJob.repair.parentJobId, candidateId: repairCandidate.id,
      bundleDigest: repairJob.bundle.digest, artifactDigest: repairCandidate.artifactDigest, validationId: repairValidation.id,
      verdict: repairedReport.verdict, failedRules: repairedReport.cases.flatMap(item => item.assertions.filter(a => a.status === 'failed').map(a => ({ caseId: item.caseId, ruleId: a.ruleId }))) });
    parentJob = repairJob; parentCandidate = repairCandidate; currentValidation = repairValidation; currentReport = repairedReport;
  }
  const repairedCase = repairedReport.cases.find(item => item.caseId === 'TC-001');
  const repairedFact = repairedCase?.assertions.find(item => item.ruleId === 'equipment-facts');
  assert.equal(repairedReport.verdict, 'passed', 'FIXED_CANDIDATE_REGRESSION_FAILED');
  assert.equal(repairedCase?.status, 'passed', 'SAME_TC001_NOT_PASSED');
  assert.equal(repairedFact?.status, 'passed', 'SAME_FACT_ASSERTION_NOT_PASSED');
  assert.equal(repairedFact?.actual?.temperatureCelsius, 86, 'FIXED_CANDIDATE_STILL_INCORRECT');
  assert.equal(repairedReport.binding.baselineDigest, originalBaselineDigest, 'REPAIR_BASELINE_CHANGED');
  assert.equal(repairedReport.binding.testSetDigest, originalTestSetDigest, 'REPAIR_TEST_SET_CHANGED');
  assert.equal(repairedReport.binding.candidate.id, repairCandidate.id, 'REGRESSION_CANDIDATE_BINDING_WRONG');
  const retainedFailure = await api(`/api/validations/${firstValidation.id}/report`);
  assert.equal(retainedFailure.verdict, 'failed', 'ORIGINAL_FAILURE_OVERWRITTEN');
  assert.equal(createHash('sha256').update(JSON.stringify(retainedFailure)).digest('hex'), originalReportDigest, 'ORIGINAL_FAILURE_REPORT_MUTATED');

  const releaseStart = await api(`/api/drafts/${draft.id}/releases`, 'POST', { clientRequestId: randomUUID(), snapshotId: snapshot.id,
    validationId: repairValidation.id, expectedRevision: 0 });
  const releaseDeadline = Date.now() + 180_000; release = releaseStart;
  while (Date.now() < releaseDeadline && !['succeeded', 'failed'].includes(release.status)) { await wait(500); release = await api(`/api/releases/${release.id}`); }
  assert.equal(release.status, 'succeeded', `REPAIRED_CANDIDATE_RELEASE_FAILED:${release.diagnostic ?? ''}`);
  const grant = await api('/api/demo-sessions', 'POST', { agentId: draft.id, actorId: 'U1001' });
  const businessHeaders = { authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' };
  const invocationResponse = await fetch(`${base}/agent-api/agents/${draft.id}/messages`, { method: 'POST', headers: businessHeaders,
    body: JSON.stringify({ clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态、温度和来源。' }), signal: AbortSignal.timeout(30_000) });
  assert.equal(invocationResponse.status, 202, 'REPAIRED_BUSINESS_INVOCATION_NOT_ACCEPTED');
  let invocation = await invocationResponse.json();
  const businessDeadline = Date.now() + 120_000;
  while (Date.now() < businessDeadline) {
    const response = await fetch(`${base}/agent-api/requests/${invocation.requestId}`, { headers: { authorization: `Bearer ${grant.token}` } });
    assert.equal(response.status, 200, 'BUSINESS_RUN_LOOKUP_FAILED'); invocation = await response.json();
    if (invocation.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(invocation.run.status)) break;
    await wait(500);
  }
  assert.equal(invocation.run?.status, 'succeeded', 'REPAIRED_BUSINESS_RUN_FAILED');
  assert.equal(invocation.run?.artifactDigest, repairCandidate.artifactDigest, 'BUSINESS_RUN_NOT_ON_REPAIRED_ARTIFACT');
  assert.equal(invocation.run?.externalEvidence?.length, 1, 'BUSINESS_RUN_EXTERNAL_EVIDENCE_MISSING');

  for (const report of [firstReport, repairedReport]) for (const item of report.cases ?? []) if (item.testDeploymentId) deploymentIds.add(item.testDeploymentId);
  const finalFailure = await api(`/api/validations/${firstValidation.id}/report`);
  const finalFailureDigest = createHash('sha256').update(JSON.stringify(finalFailure)).digest('hex');
  assert.equal(finalFailureDigest, originalReportDigest, 'ORIGINAL_REPORT_CHANGED_AFTER_RELEASE');
  const evidence = { schemaVersion: 1, requirement: 'TD-15 P0-B AC-26 seeded defect, failure-evidence repair, fixed regression and retained history',
    executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, base, targetImageIds,
    artifactDigest: target.artifactDigest, compatibilityKey: target.compatibilityKey, draftId: draft.id, snapshotId: snapshot.id,
    baselineId: baseline.id, baselineDigest: baseline.digest, originalJobId: firstJob.id,
    originalBundleDigest: firstJob.bundle.digest, originalPlanDigest, firstCandidateId: firstCandidate.id,
    firstArtifactDigest: firstCandidate.artifactDigest, firstValidationId: firstValidation.id, firstVerdict: firstReport.verdict,
    failedCaseId: failedCase.caseId, failedRuleId: failedFact.ruleId, expectedTemperatureCelsius: 86,
    actualTemperatureCelsius: actualOutput.temperatureCelsius, actualSource: actualOutput.source,
    originalReportDigest, repairAttempts, repairJobId: repairJob.id, repairParentJobId: repairJob.repair.parentJobId,
    repairTesterStatus: repairJob.roles.find(item => item.role === 'tester')?.status, repairBundleDigest: repairJob.bundle.digest,
    repairPlanDigest: repairJob.bundle.planDigest, repairedCandidateId: repairCandidate.id,
    repairedArtifactDigest: repairCandidate.artifactDigest, repairValidationId: repairValidation.id,
    repairVerdict: repairedReport.verdict, repairedCaseId: repairedCase.caseId, repairedRuleId: repairedFact.ruleId,
    repairedTemperatureCelsius: repairedFact.actual.temperatureCelsius, failureHistoryRetained: finalFailure.verdict === 'failed' && finalFailureDigest === originalReportDigest,
    releaseId: release.id, releaseStatus: release.status, businessRunId: invocation.run.id,
    businessRunStatus: invocation.run.status, businessRunArtifactDigest: invocation.run.artifactDigest,
    businessExternalEvidenceCount: invocation.run.externalEvidence.length,
    branches: { defectObserved: true, newCandidate: true, sameAssertion: true, failureHistoryRetained: true }, verdict: 'passed' };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC26-docker-live.json', JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ verdict: evidence.verdict, targetImageIds, draftId: draft.id, firstValidationId: firstValidation.id,
    repairValidationId: repairValidation.id, originalVerdict: firstReport.verdict, repairedVerdict: repairedReport.verdict,
    releaseStatus: release.status, businessRunStatus: invocation.run.status }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'AC26_DOCKER_FAILED'}\n`);
  throw error;
} finally {
  for (const id of deploymentIds) await api(`/api/test-deployments/${id}/stop`, 'POST', {}).catch(() => {});
  if (cookie) await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { ...readHeaders, 'x-csrf-token': csrf } }).catch(() => {});
}
