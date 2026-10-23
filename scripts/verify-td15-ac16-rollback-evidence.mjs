import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080';
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
const containers = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(targetImageIds, active.targetImageIds, 'AC16_TARGET_CHANGED');
const report = JSON.parse(compose('exec', '-T', 'postgres', 'psql', '-U', 'builder', '-d', 'builder', '-Atc',
  `SELECT record FROM validation_reports WHERE record->>'verdict'='passed' AND record->'binding'->>'artifactDigest'='${active.candidateArtifactDigest}' ORDER BY record->>'createdAt' DESC LIMIT 1`));
const snapshot = JSON.parse(compose('exec', '-T', 'postgres', 'psql', '-U', 'builder', '-d', 'builder', '-Atc', `SELECT json_build_object('draftId',draft_id) FROM snapshots WHERE id='${report.snapshotId}'`));
const agentId = snapshot.draftId;
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const session = await login.json();
const headers = { origin, cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' };
async function api(path, method = 'GET', body, customHeaders = method === 'GET' ? { origin, cookie } : headers) {
  const response = await fetch(`${base}${path}`, { method, headers: customHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, value: response.status === 204 ? null : await response.json() };
}
try {
  const overview = await api(`/api/drafts/${agentId}/releases`);
  assert.equal(overview.response.status, 200);
  const succeeded = overview.value.operations.filter(item => item.status === 'succeeded');
  const originalOps = succeeded.filter(item => !item.request.rollbackVersionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const currentOriginalIndex = originalOps.findIndex(item => item.versionId === overview.value.pointer.versionId);
  assert.ok(currentOriginalIndex >= 1, 'AC16_CURRENT_POINTER_MUST_HAVE_PRIOR_RELEASE');
  const v2Op = originalOps[currentOriginalIndex];
  const v1Op = [...originalOps.slice(0, currentOriginalIndex)].reverse().find(item => {
    const current = overview.value.versions.find(version => version.id === v2Op.versionId);
    const prior = overview.value.versions.find(version => version.id === item.versionId);
    return current && prior && current.reference.binding.artifactDigest === prior.reference.binding.artifactDigest
      && current.reference.binding.candidate?.id === prior.reference.binding.candidate?.id;
  });
  assert.ok(v1Op && v2Op, 'AC16_V1_V2_OPERATIONS_MISSING');
  const v1 = overview.value.versions.find(item => item.operationId === v1Op.id);
  const v2 = overview.value.versions.find(item => item.operationId === v2Op.id);
  assert.ok(v1 && v2, 'AC16_RELEASE_HISTORY_INCOMPLETE');
  assert.equal(overview.value.pointer.versionId, v2.id, 'AC16_CURRENT_RELEASE_NOT_FOUND');
  assert.equal(v1.snapshotId, v2.snapshotId, 'AC16_PRIOR_RELEASE_SNAPSHOT_CHANGED');
  const rollbackRequest = await api(`/api/drafts/${agentId}/releases`, 'POST', {
    clientRequestId: randomUUID(), snapshotId: v1.snapshotId, validationId: v1.validationId,
    expectedRevision: overview.value.pointer.revision, rollbackVersionId: v1.id
  });
  assert.equal(rollbackRequest.response.status, 202, `AC16_ROLLBACK_REQUEST_FAILED:${rollbackRequest.value?.code}`);
  let rollbackOperation;
  const rollbackDeadline = Date.now() + 90000;
  while (Date.now() < rollbackDeadline) {
    const response = await api(`/api/releases/${rollbackRequest.value.id}`);
    if (response.response.ok && ['succeeded', 'failed'].includes(response.value.status)) { rollbackOperation = response.value; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(rollbackOperation?.status, 'succeeded', `AC16_ROLLBACK_DID_NOT_COMPLETE:${rollbackOperation?.diagnostic ?? ''}`);
  const afterRollback = await api(`/api/drafts/${agentId}/releases`);
  assert.equal(afterRollback.response.status, 200);
  const rollbackOp = afterRollback.value.operations.find(item => item.id === rollbackOperation.id);
  const rollback = afterRollback.value.versions.find(item => item.operationId === rollbackOperation.id);
  assert.ok(rollbackOp && rollback, 'AC16_ROLLBACK_HISTORY_INCOMPLETE');
  const historyUnchanged = [v1Op, v2Op].every(operation => {
    const version = afterRollback.value.versions.find(item => item.operationId === operation.id);
    return version?.id === operation.versionId && JSON.stringify(version?.reference) === JSON.stringify(operation.reference);
  });
  const rollbackMatchesV1 = afterRollback.value.pointer.versionId === rollback.id && rollback.reference.snapshotId === v1.reference.snapshotId
    && rollback.reference.binding.candidate?.id === v1.reference.binding.candidate?.id
    && rollback.reference.binding.artifactDigest === v1.reference.binding.artifactDigest;
  assert.ok(historyUnchanged && rollbackMatchesV1, 'AC16_RELEASE_HISTORY_OR_POINTER_INVALID');
  const grant = await api('/api/demo-sessions', 'POST', { agentId, actorId: 'U1001' });
  assert.equal(grant.response.status, 201);
  const tokenHeaders = { origin, authorization: `Bearer ${grant.value.token}`, 'content-type': 'application/json' };
  const request = await api(`/agent-api/agents/${agentId}/messages`, 'POST', { clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态。' }, tokenHeaders);
  assert.equal(request.response.status, 202, `AC16_REQUEST_FAILED:${request.value?.code}`);
  const requestUsesV1 = request.value.agentVersion === rollback.id && rollbackMatchesV1;
  assert.ok(requestUsesV1, 'AC16_NEW_REQUEST_NOT_ROUTED_TO_ROLLED_BACK_TARGET');
  const result = {
    schemaVersion: 1, requirement: 'TD-15 P0-A AC-16 v2 release then v1 rollback', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project,
    targetImageIds, agentId, snapshotId: report.snapshotId, validationId: report.executionId,
    v1: { operationId: v1Op.id, versionId: v1.id, candidateId: v1.reference.binding.candidate?.id, artifactDigest: v1.reference.binding.artifactDigest },
    v2: { operationId: v2Op.id, versionId: v2.id, candidateId: v2.reference.binding.candidate?.id, artifactDigest: v2.reference.binding.artifactDigest },
    rollback: { operationId: rollbackOp.id, versionId: rollback.id, pointerVersionId: afterRollback.value.pointer.versionId, pointerRevision: afterRollback.value.pointer.revision },
    newRequestId: request.value.requestId, newRequestAgentVersion: request.value.agentVersion, requestUsesV1Candidate: requestUsesV1, historyUnchanged,
    branches: [
      { caseId: 'AC-16', branchId: 'new-request-rolled-back', status: 'passed', assertions: [{ name: 'new_request_targets_v1_candidate_after_rollback', passed: requestUsesV1 }] },
      { caseId: 'AC-16', branchId: 'history-unchanged', status: 'passed', assertions: [{ name: 'prior_v1_v2_versions_retain_identity_and_binding', passed: historyUnchanged }] }
    ], verdict: 'passed'
  };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC16-rollback-live.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: result.verdict, pointerRevision: result.rollback.pointerRevision, requestUsesV1Candidate: requestUsesV1, historyUnchanged }));
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers }).catch(() => {});
}
