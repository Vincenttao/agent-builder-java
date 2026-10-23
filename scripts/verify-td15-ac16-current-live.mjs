import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = (process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? base;
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const containers = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
const nf01 = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
assert.deepEqual(targetImageIds, nf01.targetImageIds, 'AC16_TARGET_CHANGED');

const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200, 'AC16_LOGIN_FAILED');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf);
const headers = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function api(path, method = 'GET', body, auth = method === 'GET' ? { origin, cookie } : headers) {
  const response = await fetch(`${base}${path}`, { method, headers: auth, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `HTTP_${method}_${response.status}_${path}:${value?.code ?? 'UNKNOWN'}`);
  return value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitValidation(id) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const current = await api(`/api/validations/${id}`);
    if (['completed', 'failed', 'cancelled'].includes(current.status)) return current;
    await wait(750);
  }
  throw new Error('AC16_VALIDATION_TIMEOUT');
}
async function publish(agentId, snapshotId, validationId, expectedRevision) {
  const started = await api(`/api/drafts/${agentId}/releases`, 'POST', { clientRequestId: randomUUID(), snapshotId, validationId, expectedRevision });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const operation = await api(`/api/releases/${started.id}`);
    if (['succeeded', 'failed'].includes(operation.status)) {
      assert.equal(operation.status, 'succeeded', `AC16_RELEASE_FAILED:${operation.diagnostic ?? ''}`);
      return operation;
    }
    await wait(500);
  }
  throw new Error(`AC16_RELEASE_TIMEOUT:${started.id}`);
}

let evidence;
try {
  const draft = await api('/api/drafts', 'POST', { name: `td15-ac16-${randomUUID().slice(0, 8)}`, brief: {
    audience: { value: '企业 AI 平台开发人员', source: 'user', confirmed: true },
    goal: { value: '查询模拟设备状态；回滚后新请求使用回滚版本', source: 'user', confirmed: true },
    output: { value: '设备状态、温度和来源', source: 'user', confirmed: true }
  } });
  const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly: {
    agentType: 'DeepAgent', systemPrompt: `你是设备运维助手。缺少设备编号时不得猜测或调用工具，输出 JSON：{"kind":"clarification","missingFields":["equipmentId"],"message":"请提供设备编号"}。
有设备编号时必须调用 get_equipment 获取事实。只读查询完成后仅输出一个 JSON 对象（不添加其他字段）：kind 固定为 equipment-report，equipmentId、status、temperatureCelsius、source 原样取自工具结果，recommendation 为基于事实的中文建议。
工具报错、超时或数据缺失时不编造事实，不重试；仅输出 {"kind":"tool-error","code":"TOOL_UNAVAILABLE","message":"说明工具不可用，设备状态未知"}。` ,
    maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1']
  } });
  const preview = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=${encodeURIComponent('equipment-read@1')}`);
  const baseline = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision, templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true });
  const candidate = await api('/api/candidates', 'POST', { snapshotId: snapshot.id });
  const started = await api(`/api/snapshots/${snapshot.id}/validations`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: false, candidateId: candidate.id });
  const validation = await waitValidation(started.id);
  assert.equal(validation.status, 'completed', 'AC16_VALIDATION_NOT_COMPLETED');
  const report = await api(`/api/validations/${started.id}/report`);
  assert.equal(report.verdict, 'passed', 'AC16_BASELINE_VALIDATION_FAILED');
  assert.ok(report.cases.length > 0 && report.cases.every(item => item.status === 'passed'), 'AC16_REQUIRED_CASES_NOT_PASSED');

  let overview = await api(`/api/drafts/${draft.id}/releases`);
  const initialRevision = overview.pointer?.revision ?? 0;
  const v1Operation = await publish(draft.id, snapshot.id, started.id, initialRevision);
  overview = await api(`/api/drafts/${draft.id}/releases`);
  const v1 = overview.versions.find(item => item.operationId === v1Operation.id);
  assert.ok(v1, 'AC16_V1_NOT_RECORDED');
  const v2Operation = await publish(draft.id, snapshot.id, started.id, overview.pointer.revision);
  overview = await api(`/api/drafts/${draft.id}/releases`);
  const v2 = overview.versions.find(item => item.operationId === v2Operation.id);
  assert.ok(v2 && overview.pointer.versionId === v2.id, 'AC16_V2_NOT_CURRENT');
  const historyBefore = [v1, v2].map(item => ({ id: item.id, operationId: item.operationId, reference: item.reference }));

  const rollbackOperation = await api(`/api/drafts/${draft.id}/releases`, 'POST', { clientRequestId: randomUUID(), snapshotId: snapshot.id, validationId: started.id,
    expectedRevision: overview.pointer.revision, rollbackVersionId: v1.id });
  let rollback;
  const rollbackDeadline = Date.now() + 120_000;
  while (Date.now() < rollbackDeadline) {
    rollback = await api(`/api/releases/${rollbackOperation.id}`);
    if (['succeeded', 'failed'].includes(rollback.status)) break;
    await wait(500);
  }
  assert.equal(rollback?.status, 'succeeded', `AC16_ROLLBACK_FAILED:${rollback?.diagnostic ?? ''}`);
  overview = await api(`/api/drafts/${draft.id}/releases`);
  const rollbackVersion = overview.versions.find(item => item.operationId === rollback.id);
  assert.ok(rollbackVersion && overview.pointer.versionId === rollbackVersion.id, 'AC16_ROLLBACK_POINTER_MISMATCH');
  const historyUnchanged = historyBefore.every(before => {
    const current = overview.versions.find(item => item.id === before.id);
    return current?.operationId === before.operationId && JSON.stringify(current.reference) === JSON.stringify(before.reference);
  });
  const rollbackMatchesV1 = rollbackVersion.snapshotId === v1.snapshotId
    && rollbackVersion.reference.binding.artifactDigest === v1.reference.binding.artifactDigest
    && JSON.stringify(rollbackVersion.reference.binding.candidate ?? null) === JSON.stringify(v1.reference.binding.candidate ?? null);
  assert.ok(historyUnchanged && rollbackMatchesV1, 'AC16_HISTORY_OR_TARGET_INVALID');

  const grant = await api('/api/demo-sessions', 'POST', { agentId: draft.id, actorId: 'U1001' });
  const tokenHeaders = { origin, authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' };
  const request = await api(`/agent-api/agents/${draft.id}/messages`, 'POST', { clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态。' }, tokenHeaders);
  assert.equal(request.agentVersion, rollbackVersion.id, 'AC16_NEW_REQUEST_NOT_ROUTED_TO_ROLLED_BACK_VERSION');
  const requestDeadline = Date.now() + 120_000;
  let requestView;
  while (Date.now() < requestDeadline) {
    requestView = await api(`/agent-api/requests/${request.requestId}`, 'GET', undefined, tokenHeaders);
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(requestView.run?.status)) break;
    await wait(500);
  }
  assert.equal(requestView?.run?.status, 'succeeded', 'AC16_POST_ROLLBACK_REQUEST_FAILED');
  assert.equal(requestView.run.artifactDigest, rollbackVersion.reference.binding.artifactDigest, 'AC16_NEW_REQUEST_ARTIFACT_MISMATCH');
  const evidenceFile = 'docs/implementation/evidence/TD15-AC16-rollback-live.json';
  evidence = { schemaVersion: 1, requirement: 'TD-15 P0-A AC-16 v2 release then v1 rollback on current fixed Docker target', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project,
    targetImageIds, appImageId: targetImageIds[0], runnerImageId: targetImageIds[1], agentId: draft.id, snapshotId: snapshot.id, baselineId: baseline.id, candidateId: candidate.id,
    validationId: started.id, validationVerdict: report.verdict, validationCases: report.cases.map(item => ({ caseId: item.caseId, status: item.status })),
    v1: { operationId: v1Operation.id, versionId: v1.id, candidateId: v1.reference.binding.candidate?.id, artifactDigest: v1.reference.binding.artifactDigest },
    v2: { operationId: v2Operation.id, versionId: v2.id, candidateId: v2.reference.binding.candidate?.id, artifactDigest: v2.reference.binding.artifactDigest },
    rollback: { operationId: rollback.id, versionId: rollbackVersion.id, pointerVersionId: overview.pointer.versionId, pointerRevision: overview.pointer.revision },
    newRequestId: request.requestId, newRequestAgentVersion: request.agentVersion, newRequestRunStatus: requestView.run.status,
    newRequestArtifactDigest: requestView.run.artifactDigest, requestUsesV1Candidate: request.agentVersion === rollbackVersion.id && requestView.run.artifactDigest === v1.reference.binding.artifactDigest,
    historyUnchanged, rollbackMatchesV1,
    branches: [
      { caseId: 'AC-16', branchId: 'new-request-rolled-back', status: 'passed', assertions: [{ name: 'new_request_targets_v1_candidate_after_rollback', passed: request.agentVersion === rollbackVersion.id && requestView.run.artifactDigest === v1.reference.binding.artifactDigest }] },
      { caseId: 'AC-16', branchId: 'history-unchanged', status: 'passed', assertions: [{ name: 'prior_v1_v2_versions_retain_identity_and_binding', passed: historyUnchanged && rollbackMatchesV1 }] }
    ], verdict: 'passed' };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: evidence.verdict, validation: evidence.validationVerdict, cases: evidence.validationCases.length, v1: v1.id, v2: v2.id, rollback: rollbackVersion.id, requestRun: requestView.run.status, targetImageIds }));
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers }).catch(() => {});
}
