import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.AC29A_BASE_URL ?? 'http://127.0.0.1:18080';
const origin = process.env.AC29A_ORIGIN ?? new URL(base).origin;
const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
assert.ok(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY_REQUIRED');
const json = async (response, expected, label) => {
  const value = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${label}:${response.status}:${value.code ?? ''}`);
  return value;
};
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).trim();
const runnerContainer = compose('ps', '-q', 'runner');
assert.ok(runnerContainer, 'RUNNER_CONTAINER_REQUIRED');
const appContainer = compose('ps', '-q', 'app');
assert.ok(appContainer, 'APP_CONTAINER_REQUIRED');
const targetImageIds = [appContainer, runnerContainer].map(id => execFileSync('docker', ['inspect', '--format', '{{.Image}}', id], { encoding: 'utf8' }).trim());
const top = () => execFileSync('docker', ['top', runnerContainer], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).split(/\r?\n/).filter(line => /opencode/i.test(line));
let cookie;
let csrf;
let jobId;
let cancelAccepted = false;
let processBefore = [];
let processAfter = [];
let finalJob;
let finalEvents = [];
let verdict = 'failed';
let failure;
try {
  const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
  const session = await json(login, 200, 'AUTH_FAILED');
  cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
  csrf = session.csrfToken;
  assert.ok(cookie && csrf, 'SESSION_CONTEXT_REQUIRED');
  const read = { origin, cookie };
  const write = { ...read, 'x-csrf-token': csrf, 'content-type': 'application/json' };
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? read : write,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    return json(response, [200, 201, 202].includes(response.status) ? response.status : 599, `${method}_${path}`);
  };
  const draft = await api('/api/drafts', 'POST', { name: `TD15-NF06-cancel-${randomUUID().slice(0, 8)}`, brief: {
    audience: { value: '企业 Agent 平台开发人员', source: 'user', confirmed: true },
    goal: { value: '只读查询模拟设备状态', source: 'user', confirmed: true },
    output: { value: '设备状态和来源', source: 'user', confirmed: true }
  } });
  const assembly = { agentType: 'DeepAgent', systemPrompt: '按设备编号查询状态，只读并保留来源。', maxIterations: 4,
    railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
  const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly });
  const preview = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=equipment-read@1`);
  const baseline = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision, templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true });
  const generation = { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' };
  const queued = await api(`/api/snapshots/${snapshot.id}/development`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id, generation, maxSeconds: 900 });
  jobId = queued.id;
  const deadline = Date.now() + 120000;
  let current = queued;
  while (Date.now() < deadline) {
    current = await api(`/api/development/${jobId}`);
    processBefore = top();
    if (current.status === 'running' && processBefore.length > 0) break;
    if (['built', 'failed', 'cancelled', 'reconciling'].includes(current.status)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(current.status, 'running', `ENGINEERING_TASK_NOT_RUNNING:${current.status}:${current.diagnostic ?? ''}`);
  assert.ok(processBefore.length > 0, 'OPENCODE_CHILD_PROCESS_NOT_OBSERVED');
  const cancelling = await api(`/api/development/${jobId}/cancel`, 'POST', {});
  cancelAccepted = cancelling.status === 'cancelling' || cancelling.status === 'cancelled';
  assert.ok(cancelAccepted, `CANCEL_NOT_ACCEPTED:${cancelling.status}`);
  const stopDeadline = Date.now() + 60000;
  while (Date.now() < stopDeadline) {
    finalJob = await api(`/api/development/${jobId}`);
    processAfter = top();
    if (finalJob.status === 'cancelled' && processAfter.length === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(finalJob?.status, 'cancelled', `TASK_NOT_CANCELLED:${finalJob?.status}:${finalJob?.diagnostic ?? ''}`);
  assert.equal(processAfter.length, 0, `MANAGED_OPENCODE_PROCESS_REMAINS:${processAfter.join('|')}`);
  const eventResponse = await fetch(`${base}/api/development/${jobId}/events`, { headers: read });
  finalEvents = (await json(eventResponse, 200, 'DEVELOPMENT_EVENTS_UNAVAILABLE')).items;
  assert.equal(finalJob.id, jobId, 'TASK_HISTORY_NOT_RETAINED');
  verdict = 'passed';
} catch (error) {
  failure = String(error?.stack ?? error);
} finally {
  if (jobId && cookie && csrf && !['built', 'failed', 'cancelled'].includes(finalJob?.status ?? '')) {
    const headers = { origin, cookie, 'x-csrf-token': csrf };
    await fetch(`${base}/api/development/${jobId}/cancel`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
    const cleanupDeadline = Date.now() + 60000;
    while (Date.now() < cleanupDeadline) {
      try {
        const response = await fetch(`${base}/api/development/${jobId}`, { headers });
        if (response.ok) finalJob = await response.json();
        processAfter = top();
        if (['built', 'failed', 'cancelled', 'reconciling'].includes(finalJob?.status ?? '') && processAfter.length === 0) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (cookie) await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) } }).catch(() => {});
  const evidence = { schemaVersion: 1, requirement: 'TD-15/NF-06 AC-29a engineering task cancellation terminates its managed OpenCode child process',
    executionMode: 'live-mock', engine: 'OpenCode 1.19.3 / deepseek-v4-flash', businessBackend: 'isolated PostgreSQL Mock; no business Tool was invoked',
    measuredAt: new Date().toISOString(), composeProject: project, base, targetImageIds, runnerContainer,
    jobId: jobId ?? null, inputDigest: finalJob?.inputDigest ?? null, baselineDigest: finalJob?.baselineDigest ?? null,
    cancelAccepted, processBefore, processAfter, finalStatus: finalJob?.status ?? null, finalRoles: finalJob?.roles ?? [],
    eventSummary: finalEvents.map(event => ({ sequence: event.sequence, type: event.type, role: event.role })),
    assertions: { runningChildObserved: processBefore.length > 0, cancellationAccepted: cancelAccepted, taskReachedCancelled: finalJob?.status === 'cancelled', childTerminated: processAfter.length === 0,
      historyRetained: finalJob?.id === jobId && Boolean(finalJob?.inputDigest && finalJob?.baselineDigest) },
    verdict, ...(failure ? { failure } : {}) };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-NF06-cancel-child-process-live.json', JSON.stringify(evidence, null, 2) + '\n');
  if (verdict !== 'passed') process.stderr.write(`${failure ?? 'NF06_CANCEL_FAILED'}\n`);
}
assert.equal(verdict, 'passed', failure ?? 'NF06_CANCEL_FAILED');
const evidenceBytes = await import('node:fs/promises').then(fs => fs.readFile('docs/implementation/evidence/TD15-NF06-cancel-child-process-live.json'));
console.log(JSON.stringify({ verdict, targetImageIds, jobId, evidenceSha256: createHash('sha256').update(evidenceBytes).digest('hex') }));
