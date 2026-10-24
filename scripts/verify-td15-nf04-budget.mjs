import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.NF04_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const origin = process.env.NF04_ORIGIN ?? process.env.APP_ORIGIN ?? base;
const project = process.env.NF04_COMPOSE_PROJECT;
const composeArgs = ['compose', '--env-file', '.env.local', ...(project ? ['-p', project] : [])];
const containers = project ? execFileSync('docker', [...composeArgs, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean) : [];
const targetImageIds = containers.length ? execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/) : [];
if (!process.env.LOCAL_BOOTSTRAP_TOKEN) throw new Error('LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const budgetSeconds = Number(process.env.NF04_BUDGET_SECONDS ?? 20);
if (!Number.isInteger(budgetSeconds) || budgetSeconds < 5 || budgetSeconds > 60) throw new Error('NF04_BUDGET_SECONDS_OUT_OF_RANGE');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200, 'Live platform login must succeed');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf, 'Authenticated session must include cookie and CSRF token');
const headers = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
const brief = Object.fromEntries(['audience', 'goal', 'output'].map(key => [key, {
  value: key === 'goal' ? '验证有时限的设备查询 Agent 组件开发任务' : `TD-15 NF-04 bounded task ${key}`,
  source: 'user', confirmed: true
}]));
const draftResponse = await fetch(`${base}/api/drafts`, { method: 'POST', headers, body: JSON.stringify({ name: `td15-nf04-budget-${randomUUID()}`, brief }) });
assert.equal(draftResponse.status, 201);
const draft = await draftResponse.json();
const assembly = { agentType: 'DeepAgent', systemPrompt: '查询设备状态；先调用设备工具，再依据工具结果回答。不得编造设备状态。', maxIterations: 3, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
const snapshotResponse = await fetch(`${base}/api/drafts/${draft.id}/snapshots`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: draft.revision, assembly }) });
assert.equal(snapshotResponse.status, 201);
const snapshot = await snapshotResponse.json();
const previewResponse = await fetch(`${base}/api/drafts/${draft.id}/baseline-preview?templateId=${encodeURIComponent('equipment-read@1')}`, { headers: { cookie } });
assert.equal(previewResponse.status, 200);
const preview = await previewResponse.json();
const baselineResponse = await fetch(`${base}/api/drafts/${draft.id}/baselines`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: draft.revision, templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true }) });
assert.equal(baselineResponse.status, 201);
const baseline = await baselineResponse.json();
const target = { draftId: draft.id, snapshotId: snapshot.id, baselineId: baseline.id };

const input = { clientRequestId: randomUUID(), baselineId: target.baselineId,
  generation: { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' },
  maxSeconds: budgetSeconds };
const start = await fetch(`${base}/api/snapshots/${target.snapshotId}/development`, { method: 'POST', headers, body: JSON.stringify(input) });
const startBody = await start.json();
assert.equal(start.status, 202, `Bounded development task must be accepted (HTTP ${start.status}; ${startBody.code ?? 'no-code'}: ${startBody.message ?? 'no-message'})`);
const admitted = startBody;
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
const report = { schemaVersion: 1, requirement: 'TD-15/NF-04 bounded engineering task timeout', executionMode: project ? 'isolated-live-docker' : 'live-platform', baseUrl: base, composeProject: project ?? null, targetImageIds, measuredAt: new Date().toISOString(), draftId: target.draftId, snapshotId: target.snapshotId, developmentJobId: admitted.id, budgetSeconds,
  finalStatus: job.status, diagnostic: job.diagnostic ?? null, roles: job.roles.map(role => ({ role: role.role, status: role.status })), eventCount: events.length, eventTypes: [...new Set(events.map(event => event.type))], workerStarted,
  timeoutDetected: job.diagnostic === 'ENGINEERING_BUDGET_EXCEEDED', workerStopped, verdict: job.diagnostic === 'ENGINEERING_BUDGET_EXCEEDED' && workerStarted && workerStopped ? 'passed' : 'failed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF04-budget-live.json', JSON.stringify(report, null, 2) + '\n');
await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } });
process.stdout.write(JSON.stringify(report) + '\n');
if (report.verdict !== 'passed') process.exitCode = 1;
