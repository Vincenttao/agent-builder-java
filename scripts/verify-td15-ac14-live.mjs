import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080';
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).trim();
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
const containers = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(targetImageIds, active.targetImageIds, 'AC14_TARGET_CHANGED');
const report = JSON.parse(compose('exec', '-T', 'postgres', 'psql', '-U', 'builder', '-d', 'builder', '-Atc',
  `SELECT record FROM validation_reports WHERE record->>'verdict'='passed' ORDER BY record->>'createdAt' DESC LIMIT 1`));
assert.equal(report.verdict, 'passed', 'AC14_PRIOR_PASSED_REPORT_REQUIRED');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const session = await login.json();
const headers = { origin, cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? { origin, cookie } : headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = response.status === 204 ? null : await response.json();
  return { response, value };
}
async function waitRun(id) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    const current = await api(`/api/runs/${id}`);
    assert.equal(current.response.status, 200);
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(current.value.status)) return current.value;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`AC14_RUN_TIMEOUT:${id}`);
}
try {
  const oldSnapshotResponse = await api(`/api/snapshots/${report.snapshotId}`);
  assert.equal(oldSnapshotResponse.response.status, 200);
  const oldSnapshot = oldSnapshotResponse.value;
  const draftResponse = await api(`/api/drafts/${oldSnapshot.draftId}`);
  assert.equal(draftResponse.response.status, 200);
  const draft = draftResponse.value;
  const releasesBefore = await api(`/api/drafts/${draft.id}/releases`);
  assert.equal(releasesBefore.response.status, 200);
  const oldRunResponse = await api(`/api/snapshots/${oldSnapshot.id}/runs`, 'POST', { clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态、温度和来源。' });
  assert.equal(oldRunResponse.response.status, 202);
  const oldRunId = oldRunResponse.value.id;

  const changedBrief = structuredClone(draft.brief);
  changedBrief.goal = { ...changedBrief.goal, value: '查询设备状态，并为新版本记录一条巡检建议', source: 'user', confirmed: true };
  const updated = await api(`/api/drafts/${draft.id}`, 'PUT', { name: draft.name, brief: changedBrief, expectedRevision: draft.revision });
  assert.equal(updated.response.status, 200);
  const updatedDraft = updated.value;
  const newSnapshotResponse = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: updatedDraft.revision, assembly: oldSnapshot.content.assembly });
  assert.equal(newSnapshotResponse.response.status, 201);
  const newSnapshot = newSnapshotResponse.value;
  assert.notEqual(newSnapshot.id, oldSnapshot.id);
  assert.notEqual(newSnapshot.digest, oldSnapshot.digest);

  const newRunResponse = await api(`/api/snapshots/${newSnapshot.id}/runs`, 'POST', { clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态、温度和来源。' });
  assert.equal(newRunResponse.response.status, 202);
  const [oldRun, newRun] = await Promise.all([waitRun(oldRunId), waitRun(newRunResponse.value.id)]);
  assert.equal(oldRun.snapshotId, oldSnapshot.id);
  assert.equal(oldRun.snapshotDigest, oldSnapshot.digest);
  assert.equal(newRun.snapshotId, newSnapshot.id);
  assert.equal(newRun.snapshotDigest, newSnapshot.digest);
  assert.equal(oldRun.status, 'succeeded');
  assert.equal(newRun.status, 'succeeded');

  const rejectedRelease = await api(`/api/drafts/${draft.id}/releases`, 'POST', { clientRequestId: randomUUID(), snapshotId: newSnapshot.id, validationId: report.executionId, expectedRevision: updatedDraft.revision });
  assert.equal(rejectedRelease.response.status, 409, 'AC14_OLD_REPORT_WAS_NOT_REJECTED');
  assert.equal(rejectedRelease.value.code, 'RELEASE_TARGET_MISMATCH');
  const releasesAfter = await api(`/api/drafts/${draft.id}/releases`);
  assert.deepEqual(releasesAfter.value.operations, releasesBefore.value.operations, 'AC14_REJECTED_REPORT_CREATED_RELEASE_OPERATION');

  const result = {
    schemaVersion: 1, requirement: 'TD-15 P0-A AC-14 old Run pinning, new snapshot, and stale report rejection', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project,
    targetImageIds, draftId: draft.id, oldSnapshotId: oldSnapshot.id, oldSnapshotDigest: oldSnapshot.digest, newSnapshotId: newSnapshot.id, newSnapshotDigest: newSnapshot.digest,
    oldRunId, oldRunStatus: oldRun.status, oldRunSnapshotId: oldRun.snapshotId, newRunId: newRun.id, newRunStatus: newRun.status, newRunSnapshotId: newRun.snapshotId,
    oldValidationId: report.executionId, oldValidationVerdict: report.verdict, staleReportReleaseStatus: rejectedRelease.response.status, staleReportReleaseCode: rejectedRelease.value.code,
    releaseOperationCountBefore: releasesBefore.value.operations.length, releaseOperationCountAfter: releasesAfter.value.operations.length, verdict: 'passed',
    branches: [
      { caseId: 'AC-14', branchId: 'old-run-pinned', status: 'passed', assertions: [{ name: 'old_run_retains_original_snapshot', passed: oldRun.snapshotId === oldSnapshot.id && oldRun.snapshotDigest === oldSnapshot.digest }] },
      { caseId: 'AC-14', branchId: 'new-snapshot', status: 'passed', assertions: [{ name: 'new_revision_has_distinct_snapshot_and_run', passed: newSnapshot.id !== oldSnapshot.id && newSnapshot.digest !== oldSnapshot.digest && newRun.snapshotId === newSnapshot.id && newRun.status === 'succeeded' }] },
      { caseId: 'AC-14', branchId: 'old-test-invalid', status: 'passed', assertions: [{ name: 'old_report_cannot_start_release_for_new_snapshot', passed: rejectedRelease.response.status === 409 && rejectedRelease.value.code === 'RELEASE_TARGET_MISMATCH' && releasesAfter.value.operations.length === releasesBefore.value.operations.length }] }
    ]
  };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC14-snapshot-change-live.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: result.verdict, oldRunSnapshotId: oldRun.snapshotId, newRunSnapshotId: newRun.snapshotId, staleReportReleaseCode: rejectedRelease.value.code }));
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers }).catch(() => {});
}
