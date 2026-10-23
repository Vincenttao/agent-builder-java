import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const snapshotId = process.env.NF01_SSE_SNAPSHOT_ID ?? '777fc6e8-e579-4c28-921d-35381ade9046';
const evidencePath = 'docs/implementation/evidence/TD15-NF01-sse-reconnect.json';
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf);
const readHeaders = { origin, cookie };
const writeHeaders = { ...readHeaders, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? readHeaders : writeHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${value?.code ?? path}`);
  return value;
}
function eventIds(text) { return [...text.matchAll(/^id: (\d+)$/gm)].map(match => Number(match[1])); }
async function collectReconnect(runId, cursor) {
  const response = await fetch(`${base}/api/runs/${runId}/events/stream?after=${cursor}`, { headers: readHeaders, signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-type')?.includes('text/event-stream'));
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
  return eventIds(buffer);
}
let result;
try {
  const snapshot = await api(`/api/snapshots/${snapshotId}`);
  const created = await api(`/api/snapshots/${snapshotId}/runs`, 'POST', { clientRequestId: randomUUID(), input: '请查询 PUMP-001 的状态、温度和来源。' });
  const runId = created.id;
  const firstAbort = new AbortController();
  const firstResponse = await fetch(`${base}/api/runs/${runId}/events/stream?after=0`, { headers: readHeaders, signal: firstAbort.signal });
  assert.equal(firstResponse.status, 200);
  const reader = firstResponse.body.getReader(); const decoder = new TextDecoder(); let firstBuffer = '';
  const firstDeadline = Date.now() + 30000;
  while (Date.now() < firstDeadline) {
    const pending = await Promise.race([reader.read(), new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
    if (pending === null) continue;
    if (pending.done) break;
    firstBuffer += decoder.decode(pending.value, { stream: true });
    if (eventIds(firstBuffer).length) break;
  }
  const firstIds = eventIds(firstBuffer);
  assert.ok(firstIds.length > 0, 'FIRST_STREAM_DID_NOT_DELIVER_EVENTS');
  const cursor = Math.max(...firstIds);
  firstAbort.abort();
  await reader.cancel().catch(() => {});
  const resumedIds = await collectReconnect(runId, cursor);

  const deadline = Date.now() + 120000; let run;
  do { run = await api(`/api/runs/${runId}`); if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)) break; await new Promise(resolve => setTimeout(resolve, 700)); } while (Date.now() < deadline);
  const [eventPage, runList, snapshotAfter] = await Promise.all([
    api(`/api/runs/${runId}/events`), api(`/api/snapshots/${snapshotId}/runs`), api(`/api/snapshots/${snapshotId}`)
  ]);
  const authoritativeIds = eventPage.items.map(item => item.seq);
  const expectedResumed = authoritativeIds.filter(seq => seq > cursor);
  const restored = runList.items.some(item => item.id === runId);
  const allSeen = [...firstIds, ...resumedIds].sort((a, b) => a - b);
  const noDuplicates = new Set(allSeen).size === allSeen.length && new Set(authoritativeIds).size === authoritativeIds.length;
  const noGaps = JSON.stringify(allSeen) === JSON.stringify(authoritativeIds);
  const cursorResumed = resumedIds.length > 0 && JSON.stringify(resumedIds) === JSON.stringify(expectedResumed);
  const resultDigest = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(JSON.stringify(eventPage.items)).digest('hex'));
  result = { schemaVersion: 1, requirement: 'TD-15/NF-01 Run refresh and SSE reconnect continuity', executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(), composeProject: project,
    draftId: snapshot.draftId, snapshotId, snapshotDigestBefore: snapshot.digest, snapshotDigestAfter: snapshotAfter.digest, runId, runStatus: run.status,
    firstStreamEventIds: firstIds, reconnectCursor: cursor, resumedEventIds: resumedIds, authoritativeEventIds: authoritativeIds,
    runFoundAfterRefresh: restored, cursorResumed, noDuplicates, noGaps, eventDigest: resultDigest,
    verdict: run.status === 'succeeded' && restored && snapshot.digest === snapshotAfter.digest && cursorResumed && noDuplicates && noGaps ? 'passed' : 'failed' };
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: writeHeaders }).catch(() => {});
}
result.targetImageIds = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
  .map(id => execFileSync('docker', ['inspect', '--format', '{{.Image}}', id], { encoding: 'utf8' }).trim());
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
if (result.verdict !== 'passed') process.exitCode = 1;
