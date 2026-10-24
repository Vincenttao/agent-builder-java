import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const crashEvidence = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf);
const headers = { cookie };
async function get(path) {
  const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  assert.equal(response.status, 200, `GET_${path}_${response.status}`);
  return body;
}
let result;
try {
  const [snapshot, run, validation, events] = await Promise.all([
    get(`/api/snapshots/${crashEvidence.snapshotId}`),
    get(`/api/runs/${crashEvidence.runId}`),
    get(`/api/validations/${crashEvidence.validationId}/report`),
    get(`/api/runs/${crashEvidence.runId}/events`)
  ]);
  const runtimeEvents = events.items.filter(item => item.type === 'runtime.event');
  const sequences = events.items.map(item => item.seq);
  const bindingMatches = snapshot.id === crashEvidence.snapshotId && snapshot.digest === validation.binding.snapshotDigest
    && run.snapshotDigest === snapshot.digest && validation.snapshotId === snapshot.id;
  const eventLogRetained = runtimeEvents.length >= crashEvidence.beforeRestart.runtimeEvents
    && runtimeEvents.length === crashEvidence.afterRestart.runtimeEventCount
    && new Set(sequences).size === sequences.length;
  result = { schemaVersion: 1, requirement: 'TD-15/NF-01 snapshot and event persistence after App/Runner restart', executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(),
    composeProject: crashEvidence.composeProject, targetImageIds: crashEvidence.targetImageIds, draftId: crashEvidence.draftId, snapshotId: snapshot.id, snapshotDigest: snapshot.digest,
    validationId: crashEvidence.validationId, runId: run.id, runStatus: run.status, beforeRestartRuntimeEventCount: crashEvidence.beforeRestart.runtimeEvents,
    afterRestartRuntimeEventCount: runtimeEvents.length, totalEventCount: events.items.length, eventSequenceUnique: new Set(sequences).size === sequences.length,
    snapshotBindingMatches: bindingMatches, eventLogRetained,
    verdict: bindingMatches && eventLogRetained ? 'passed' : 'failed' };
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
}
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF01-restart-snapshot-events.json', JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
if (result.verdict !== 'passed') process.exitCode = 1;
