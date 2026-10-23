import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.NF04_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const origin = process.env.NF04_ORIGIN ?? process.env.APP_ORIGIN ?? base;
if (!process.env.LOCAL_BOOTSTRAP_TOKEN) throw new Error('LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const budgetSeconds = Number(process.env.NF04_BUDGET_SECONDS ?? 20);
if (!Number.isInteger(budgetSeconds) || budgetSeconds < 5 || budgetSeconds > 60) throw new Error('NF04_BUDGET_SECONDS_OUT_OF_RANGE');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200, 'Live platform login must succeed');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf, 'Authenticated session must include cookie and CSRF token');
const headers = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
const draftsResponse = await fetch(`${base}/api/drafts`, { headers: { cookie } });
assert.equal(draftsResponse.status, 200);
let target;
for (const draft of (await draftsResponse.json()).items) {
  const response = await fetch(`${base}/api/drafts/${draft.id}/development`, { headers: { cookie } });
  if (!response.ok) continue;
  const job = (await response.json()).items.find(item => item.status === 'built' && item.bundle);
  if (job) { target = { draftId: draft.id, snapshotId: job.snapshotId, baselineId: job.baselineId }; break; }
}
assert.ok(target, 'A previously built project is required to exercise a new bounded task');

const input = { clientRequestId: randomUUID(), baselineId: target.baselineId,
  generation: { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' },
  maxSeconds: budgetSeconds };
const start = await fetch(`${base}/api/snapshots/${target.snapshotId}/development`, { method: 'POST', headers, body: JSON.stringify(input) });
assert.equal(start.status, 202, `Bounded development task must be accepted (HTTP ${start.status})`);
const admitted = await start.json();
const deadline = Date.now() + 120000;
let job = admitted;
while (Date.now() < deadline && !['built', 'failed', 'cancelled', 'reconciling'].includes(job.status)) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  const response = await fetch(`${base}/api/development/${admitted.id}`, { headers: { cookie } });
  assert.equal(response.status, 200);
  job = await response.json();
}
if (!['built', 'failed', 'cancelled', 'reconciling'].includes(job.status)) {
  await fetch(`${base}/api/development/${admitted.id}/cancel`, { method: 'POST', headers });
  const cancelDeadline = Date.now() + 30000;
  while (Date.now() < cancelDeadline && !['built', 'failed', 'cancelled', 'reconciling'].includes(job.status)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await fetch(`${base}/api/development/${admitted.id}`, { headers: { cookie } });
    job = await response.json();
  }
}
const eventsResponse = await fetch(`${base}/api/development/${admitted.id}/events`, { headers: { cookie } });
assert.equal(eventsResponse.status, 200);
const events = (await eventsResponse.json()).items;
const diagnosticResponse = await fetch(`${base}/api/development/${admitted.id}`, { headers: { cookie } });
assert.equal(diagnosticResponse.status, 200);
const workerStarted = events.length > 0 || job.roles.some(role => ['running', 'completed', 'failed', 'cancelled'].includes(role.status));
const workerStopped = ['failed', 'cancelled'].includes(job.status) && job.roles.every(role => !['running', 'queued', 'cancelling'].includes(role.status));
const report = { schemaVersion: 1, requirement: 'TD-15/NF-04 bounded engineering task timeout', executionMode: process.env.NF04_COMPOSE_PROJECT ? 'isolated-live-docker' : 'live-platform', baseUrl: base, composeProject: process.env.NF04_COMPOSE_PROJECT ?? null, measuredAt: new Date().toISOString(), draftId: target.draftId, snapshotId: target.snapshotId, developmentJobId: admitted.id, budgetSeconds,
  finalStatus: job.status, diagnostic: job.diagnostic ?? null, roles: job.roles.map(role => ({ role: role.role, status: role.status })), eventCount: events.length, eventTypes: [...new Set(events.map(event => event.type))], workerStarted,
  timeoutDetected: job.diagnostic === 'ENGINEERING_BUDGET_EXCEEDED', workerStopped, verdict: job.diagnostic === 'ENGINEERING_BUDGET_EXCEEDED' && workerStarted && workerStopped ? 'passed' : 'failed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF04-budget-live.json', JSON.stringify(report, null, 2) + '\n');
await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } });
process.stdout.write(JSON.stringify(report) + '\n');
if (report.verdict !== 'passed') process.exitCode = 1;
