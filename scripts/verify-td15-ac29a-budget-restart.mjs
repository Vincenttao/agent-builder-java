import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const base = (process.env.AC29A_BASE_URL ?? 'http://127.0.0.1:18084').replace(/\/$/, '');
const origin = process.env.AC29A_ORIGIN ?? new URL(base).origin;
const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-ac29a';
const evidencePath = process.env.AC29A_EVIDENCE_PATH ?? 'docs/implementation/evidence/TD15-AC29a-budget-restart-live.json';
const expectedImages = [
  'sha256:8b5b659b612616c33504bea9f9c03c624dcd9afba2f76110eaa13a353b19c9ab',
  'sha256:39720f36e29dbfc06f311fdfc11cc3febcc64bc1ce23a1b9d8d5a4beed2880b9'
];
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], {
  encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024
}).trim();
const ids = () => {
  const containers = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
  assert.equal(containers.length, 2, 'AC29A_ISOLATED_APP_RUNNER_REQUIRED');
  return containers;
};
const imageIds = () => execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...ids()], { encoding: 'utf8' }).trim().split(/\r?\n/);
const health = container => execFileSync('docker', ['inspect', '--format', '{{.State.Health.Status}}', container], { encoding: 'utf8' }).trim();
const openCodeProcesses = () => execFileSync('docker', ['top', ids()[1]], { encoding: 'utf8' }).split(/\r?\n/).filter(line => /opencode/i.test(line));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const budgetSeconds = 30;
const evidence = { schemaVersion: 1, requirement: 'TD-15 AC-29a generation budget termination and restart without replay',
  executionMode: 'live-mock', composeProject: project, base, budgetSeconds, verdict: 'running', startedAt: new Date().toISOString() };
let cookie, csrf, jobId, restartAttempted = false;
let finalJob, eventsBeforeRestart = [], eventsAfterRestart = [], processesBefore = [], processesAfter = [], maxOpenCodeProcessesDuring = 0;
let runningRoleObserved = false;

async function login() {
  assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
  const response = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, 'LOGIN_FAILED');
  cookie = response.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
  csrf = (await response.json()).csrfToken;
  assert.ok(cookie && csrf, 'SESSION_CONTEXT_REQUIRED');
}
async function api(path, method = 'GET', body) {
  const headers = method === 'GET' ? { cookie } : { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json().catch(() => ({}));
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${value?.code ?? path}`);
  return value;
}
async function restartAndObserve() {
  restartAttempted = true;
  compose('restart', 'app', 'runner');
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline) {
    const containers = ids();
    if (containers.every(container => health(container) === 'healthy')) return;
    await sleep(2000);
  }
  throw new Error('AC29A_RESTART_HEALTH_TIMEOUT');
}

try {
  evidence.targetImageIds = imageIds();
  assert.deepEqual(evidence.targetImageIds, expectedImages, 'AC29A_ISOLATED_IMAGES_DIFFER_FROM_FIXED_TARGET');
  processesBefore = openCodeProcesses();
  assert.equal(processesBefore.length, 0, 'PREEXISTING_OPENCODE_TASK_IN_ISOLATED_RUNNER');
  await login();
  const draft = await api('/api/drafts', 'POST', { name: `TD15-AC29a-budget-${randomUUID().slice(0, 8)}`, brief: {
    audience: { value: '企业 Agent 平台开发人员', source: 'user', confirmed: true },
    goal: { value: '生成一个只读设备状态查询 Agent', source: 'user', confirmed: true },
    output: { value: '返回设备状态、温度和来源', source: 'user', confirmed: true }
  } });
  const assembly = { agentType: 'DeepAgent', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'],
    systemPrompt: '只读查询指定设备状态，并保留温度和来源。' };
  const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly });
  const preview = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=equipment-read%401`);
  const baseline = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision,
    templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true });
  const generation = { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'],
    dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' };
  const queued = await api(`/api/snapshots/${snapshot.id}/development`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id, generation, maxSeconds: budgetSeconds });
  jobId = queued.id;
  evidence.draftId = draft.id; evidence.snapshotId = snapshot.id; evidence.baselineId = baseline.id; evidence.baselineDigest = baseline.digest;
  evidence.jobId = jobId; evidence.inputDigest = queued.inputDigest;
  const budgetStartedAt = Date.now();
  const budgetDeadline = budgetStartedAt + 120000;
  while (Date.now() < budgetDeadline) {
    finalJob = await api(`/api/development/${jobId}`);
    runningRoleObserved ||= finalJob.roles.some(role => role.status === 'running');
    maxOpenCodeProcessesDuring = Math.max(maxOpenCodeProcessesDuring, openCodeProcesses().length);
    if (['failed', 'built', 'cancelled', 'reconciling'].includes(finalJob.status)) break;
    await sleep(500);
  }
  assert.ok(finalJob && ['failed', 'built', 'cancelled', 'reconciling'].includes(finalJob.status), 'AC29A_BUDGET_TASK_DID_NOT_TERMINATE');
  evidence.budgetElapsedMs = Date.now() - budgetStartedAt;
  processesAfter = openCodeProcesses();
  eventsBeforeRestart = (await api(`/api/development/${jobId}/events`)).items;
  evidence.budgetResult = { status: finalJob.status, diagnostic: finalJob.diagnostic ?? null,
    roles: finalJob.roles, bundleExists: Boolean(finalJob.bundle), processCountBefore: processesBefore.length,
    runningRoleObserved, maxOpenCodeProcessesDuring,
    processCountAfter: processesAfter.length, events: eventsBeforeRestart };
  assert.equal(finalJob.status, 'failed', 'BUDGET_TASK_NOT_FAILED');
  assert.equal(finalJob.diagnostic, 'ENGINEERING_BUDGET_EXCEEDED', 'BUDGET_DIAGNOSTIC_MISSING');
  assert.equal(runningRoleObserved, true, 'BUDGET_TASK_NEVER_ENTERED_RUNNING_ROLE');
  assert.ok(maxOpenCodeProcessesDuring > 0, 'BUDGET_TASK_CHILD_PROCESS_NEVER_OBSERVED');
  assert.equal(processesAfter.length, 0, 'BUDGET_EXCEEDED_OPENCODE_PROCESS_REMAINS');
  assert.equal(Boolean(finalJob.bundle), false, 'BUDGET_EXCEEDED_TASK_PUBLISHED_BUNDLE');

  const statusBeforeRestart = { status: finalJob.status, diagnostic: finalJob.diagnostic, inputDigest: finalJob.inputDigest };
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
  await restartAndObserve();
  cookie = undefined; csrf = undefined;
  await login();
  finalJob = await api(`/api/development/${jobId}`);
  eventsAfterRestart = (await api(`/api/development/${jobId}/events`)).items;
  processesAfter = openCodeProcesses();
  await sleep(6000);
  const laterJob = await api(`/api/development/${jobId}`);
  const laterEvents = (await api(`/api/development/${jobId}/events`)).items;
  assert.deepEqual({ status: finalJob.status, diagnostic: finalJob.diagnostic, inputDigest: finalJob.inputDigest }, statusBeforeRestart, 'RESTART_CHANGED_TERMINAL_JOB');
  assert.deepEqual(eventsAfterRestart.map(item => item.sequence), eventsBeforeRestart.map(item => item.sequence), 'RESTART_CHANGED_TASK_HISTORY');
  assert.deepEqual(laterEvents.map(item => item.sequence), eventsAfterRestart.map(item => item.sequence), 'TERMINAL_TASK_REPLAYED_AFTER_RESTART');
  assert.equal(laterJob.status, 'failed', 'TERMINAL_JOB_REPLAYED_AFTER_RESTART');
  assert.equal(processesAfter.length, 0, 'RESTARTED_RUNNER_STARTED_OPENCODE_TASK');
  evidence.restart = { appRunnerHealthy: true, statusBefore: statusBeforeRestart, statusAfter: { status: finalJob.status,
    diagnostic: finalJob.diagnostic, inputDigest: finalJob.inputDigest }, eventSequencesBefore: eventsBeforeRestart.map(item => item.sequence),
    eventSequencesAfter: eventsAfterRestart.map(item => item.sequence), eventSequencesAfterStabilityWindow: laterEvents.map(item => item.sequence),
    processCountAfter: processesAfter.length, runningRoleObserved, maxOpenCodeProcessesDuring, stabilityWindowMs: 6000 };
  evidence.verdict = 'passed';
} catch (error) {
  evidence.verdict = 'failed';
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (jobId && cookie && csrf && !['built', 'failed', 'cancelled'].includes(finalJob?.status ?? '')) {
    await api(`/api/development/${jobId}/cancel`, 'POST', {}).catch(() => {});
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try { finalJob = await api(`/api/development/${jobId}`); if (['built', 'failed', 'cancelled', 'reconciling'].includes(finalJob.status)) break; } catch {}
      await sleep(500);
    }
  }
  if (cookie) await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) } }).catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  try { evidence.finalTargetImageIds = imageIds(); evidence.finalHealth = ids().map(container => health(container)); evidence.finalOpenCodeProcessCount = openCodeProcesses().length; }
  catch (error) { evidence.finalInspectionError = error instanceof Error ? error.message : String(error); }
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ verdict: evidence.verdict, evidencePath, jobId, restartAttempted }));
}
