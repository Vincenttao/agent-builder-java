import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.NF04_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const origin = process.env.NF04_ORIGIN ?? process.env.APP_ORIGIN ?? base;
const budgetSeconds = Number(process.env.NF04_PREPARE_BUDGET_SECONDS ?? 600);
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200, 'Live platform login must succeed');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf);
const readHeaders = { cookie };
const writeHeaders = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? readHeaders : writeHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status} ${value?.code ?? ''}`);
  return value;
}

let job;
let report;
try {
  const keys = ['audience', 'goal', 'output'];
  const brief = Object.fromEntries(keys.map(key => [key, { value: key === 'goal' ? '生成用于查询设备状态的 Tool、Skill 和 Rail，并通过设备查询验收' : `TD-15 NF-04 budget seed ${key}`, source: 'user', confirmed: true }]));
  const draft = await api('/api/drafts', 'POST', { name: `td15-nf04-budget-seed-${randomUUID()}`, brief });
  const assembly = { agentType: 'DeepAgent', systemPrompt: '查询设备状态；先调用设备工具，再依据工具结果回答。不得编造设备状态。', maxIterations: 3, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
  const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly });
  const preview = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=${encodeURIComponent('equipment-read@1')}`);
  const baseline = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision, templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true });
  const input = { clientRequestId: randomUUID(), baselineId: baseline.id,
    generation: { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' },
    maxSeconds: budgetSeconds };
  job = await api(`/api/snapshots/${snapshot.id}/development`, 'POST', input);
  const deadline = Date.now() + budgetSeconds * 1000 + 120000;
  while (Date.now() < deadline && !['built', 'failed', 'cancelled', 'reconciling'].includes(job.status)) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    job = await api(`/api/development/${job.id}`);
  }
  if (job.status !== 'built' || !job.bundle) {
    await fetch(`${base}/api/development/${job.id}/cancel`, { method: 'POST', headers: writeHeaders }).catch(() => {});
    throw new Error(`SEED_BUILD_NOT_BUILT:${job.status}:${job.diagnostic ?? 'no-diagnostic'}`);
  }
  report = { schemaVersion: 1, requirement: 'TD-15/NF-04 built DevelopmentJob prerequisite', executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(), baseUrl: base,
    draftId: draft.id, snapshotId: snapshot.id, baselineId: baseline.id, developmentJobId: job.id, status: job.status,
    roleStatuses: job.roles.map(role => ({ role: role.role, status: role.status })), bundleDigest: job.bundle.digest, verdict: 'passed' };
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: writeHeaders }).catch(() => {});
}
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF04-budget-target.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');
