import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = (process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.NF01_ORIGIN ?? new URL(base).origin;
const draftId = process.env.TD15_AC16_DRAFT_ID;
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
assert.ok(draftId, 'TD15_AC16_DRAFT_ID_REQUIRED');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
const containers = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(targetImageIds, active.targetImageIds, 'AC16_TARGET_CHANGED');

const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200, 'AC16_LOGIN_FAILED');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf);
const headers = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
const readHeaders = { origin, cookie };
async function api(path, method = 'GET', body, auth = method === 'GET' ? readHeaders : headers) {
  const response = await fetch(`${base}${path}`, { method, headers: auth, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `HTTP_${method}_${response.status}_${path}:${value?.code ?? 'UNKNOWN'}`);
  return value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitRelease(id) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const current = await api(`/api/releases/${id}`);
    if (['succeeded', 'failed'].includes(current.status)) {
      assert.equal(current.status, 'succeeded', `AC16_RELEASE_FAILED:${current.diagnostic ?? ''}`);
      return current;
    }
    await wait(500);
  }
  throw new Error(`AC16_RELEASE_TIMEOUT:${id}`);
}

try {
  const draft = await api(`/api/drafts/${draftId}`);
  const overview = await api(`/api/drafts/${draftId}/releases`);
  const originals = overview.operations.filter(item => item.status === 'succeeded' && !item.request.rollbackVersionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  assert.ok(originals.length >= 1, 'AC16_V1_RELEASE_MISSING');
  const v1Operation = originals.at(-1);
  const v1 = overview.versions.find(item => item.operationId === v1Operation.id);
  assert.ok(v1 && overview.pointer?.versionId === v1.id, 'AC16_V1_MUST_BE_CURRENT_BEFORE_RESUME');
  const snapshotId = v1.snapshotId;
  const validationId = v1Operation.request.validationId;
  const report = await api(`/api/validations/${validationId}/report`);
  assert.equal(report.verdict, 'passed', 'AC16_VALIDATION_MUST_BE_PASSED');
  assert.ok(report.cases.length > 0 && report.cases.every(item => item.status === 'passed'), 'AC16_REQUIRED_CASES_NOT_PASSED');

  const v2Operation = await api(`/api/drafts/${draftId}/releases`, 'POST', { clientRequestId: randomUUID(), snapshotId, validationId, expectedRevision: overview.pointer.revision });
  await waitRelease(v2Operation.id);
  let current = await api(`/api/drafts/${draftId}/releases`);
  const v2 = current.versions.find(item => item.operationId === v2Operation.id);
  assert.ok(v2 && current.pointer.versionId === v2.id, 'AC16_V2_NOT_CURRENT');
  const historyBefore = [v1, v2].map(item => ({ id: item.id, operationId: item.operationId, reference: item.reference }));

  const rollbackOperation = await api(`/api/drafts/${draftId}/releases`, 'POST', { clientRequestId: randomUUID(), snapshotId, validationId,
    expectedRevision: current.pointer.revision, rollbackVersionId: v1.id });
  await waitRelease(rollbackOperation.id);
  current = await api(`/api/drafts/${draftId}/releases`);
  const rollbackVersion = current.versions.find(item => item.operationId === rollbackOperation.id);
  assert.ok(rollbackVersion && current.pointer.versionId === rollbackVersion.id, 'AC16_ROLLBACK_POINTER_MISMATCH');
  const historyUnchanged = historyBefore.every(before => {
    const latest = current.versions.find(item => item.id === before.id);
    return latest?.operationId === before.operationId && JSON.stringify(latest.reference) === JSON.stringify(before.reference);
  });
  const rollbackMatchesV1 = rollbackVersion.snapshotId === v1.snapshotId
    && rollbackVersion.reference.binding.artifactDigest === v1.reference.binding.artifactDigest
    && JSON.stringify(rollbackVersion.reference.binding.candidate ?? null) === JSON.stringify(v1.reference.binding.candidate ?? null);
  assert.ok(historyUnchanged && rollbackMatchesV1, 'AC16_HISTORY_OR_TARGET_INVALID');

  const grant = await api('/api/demo-sessions', 'POST', { agentId: draftId, actorId: 'U1001' });
  const tokenHeaders = { origin, authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' };
  const request = await api(`/agent-api/agents/${draftId}/messages`, 'POST', { clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态。' }, tokenHeaders);
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

  const evidence = { schemaVersion: 1, requirement: 'TD-15 P0-A AC-16 v2 release then v1 rollback on current fixed Docker target', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project,
    targetImageIds, appImageId: targetImageIds[0], runnerImageId: targetImageIds[1], agentId: draft.id, snapshotId, baselineId: report.baselineId,
    candidateId: report.binding.candidate?.id ?? v1.reference.binding.candidate?.id, validationId, validationVerdict: report.verdict,
    validationCases: report.cases.map(item => ({ caseId: item.caseId, status: item.status })),
    v1: { operationId: v1Operation.id, versionId: v1.id, candidateId: v1.reference.binding.candidate?.id, artifactDigest: v1.reference.binding.artifactDigest },
    v2: { operationId: v2Operation.id, versionId: v2.id, candidateId: v2.reference.binding.candidate?.id, artifactDigest: v2.reference.binding.artifactDigest },
    rollback: { operationId: rollbackOperation.id, versionId: rollbackVersion.id, pointerVersionId: current.pointer.versionId, pointerRevision: current.pointer.revision },
    newRequestId: request.requestId, newRequestAgentVersion: request.agentVersion, newRequestRunStatus: requestView.run.status,
    newRequestArtifactDigest: requestView.run.artifactDigest, requestUsesV1Candidate: request.agentVersion === rollbackVersion.id && requestView.run.artifactDigest === v1.reference.binding.artifactDigest,
    historyUnchanged, rollbackMatchesV1,
    branches: [
      { caseId: 'AC-16', branchId: 'new-request-rolled-back', status: 'passed', assertions: [{ name: 'new_request_targets_v1_candidate_after_rollback', passed: request.agentVersion === rollbackVersion.id && requestView.run.artifactDigest === v1.reference.binding.artifactDigest }] },
      { caseId: 'AC-16', branchId: 'history-unchanged', status: 'passed', assertions: [{ name: 'prior_v1_v2_versions_retain_identity_and_binding', passed: historyUnchanged && rollbackMatchesV1 }] }
    ], verdict: 'passed' };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC16-rollback-live.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: evidence.verdict, v1: v1.id, v2: v2.id, rollback: rollbackVersion.id, requestRun: requestView.run.status, targetImageIds }));
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers }).catch(() => {});
}
