import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
    : JSON.stringify(value);
const contentDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

const base = (process.env.NF04_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const origin = process.env.NF04_ORIGIN ?? process.env.APP_ORIGIN ?? base;
const composeProject = process.env.NF04_COMPOSE_PROJECT;
const composeArgs = ['compose', '--env-file', '.env.local', ...(composeProject ? ['-p', composeProject] : [])];
const appContainer = composeProject ? execFileSync('docker', [...composeArgs, 'ps', '-q', 'app'], { encoding: 'utf8' }).trim() : '';
const appImageId = appContainer ? execFileSync('docker', ['inspect', appContainer, '--format', '{{.Image}}'], { encoding: 'utf8' }).trim() : null;
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf);
const management = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
const getHeaders = { cookie };
async function api(path, method = 'GET', body, headers = method === 'GET' ? getHeaders : management) {
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`HTTP_${method}_${response.status}_${value?.code ?? 'UNKNOWN'}`);
  return value;
}
async function mockCalls(environmentId, runId) {
  const js = `const p='/control/environments/${environmentId}/calls?runId=${runId}';const r=await fetch('http://127.0.0.1:8082'+p,{headers:{authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN}});if(!r.ok)process.exit(1);const j=await r.json();console.log(JSON.stringify({count:j.items.length,operations:j.items.map(x=>x.operation)}));`;
  const args = ['compose', '--env-file', '.env.local'];
  if (composeProject) args.push('-p', composeProject);
  args.push('exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', js);
  return JSON.parse(execFileSync('docker', args, { encoding: 'utf8' }));
}
let deployment;
let result;
try {
  const draftInput = { name: `nf04-live-iteration-${randomUUID()}`, brief: Object.fromEntries(['audience', 'goal', 'output'].map(key => [key, { value: key === 'goal' ? '查询设备并以工具返回事实作答' : `NF-04 iteration test ${key}`, source: 'user', confirmed: true }])) };
  const draft = await api('/api/drafts', 'POST', draftInput);
  const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly: { agentType: 'DeepAgent', systemPrompt: '每次请求最多调用 get_equipment 一次。必须先使用该工具取得设备事实，再依据工具结果回答。不得编造。', maxIterations: 1, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] } });
  const preview = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=${encodeURIComponent('equipment-read@1')}`);
  const baseline = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision, templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true });
  const candidate = await api('/api/candidates', 'POST', { snapshotId: snapshot.id });
  const suiteDigest = contentDigest(baseline.content.cases);
  deployment = await api('/api/test-deployments', 'POST', { clientRequestId: randomUUID(), candidateId: candidate.id, requirementBaselineId: baseline.id, suiteDigest, purpose: 'test', ttlSeconds: 300 });
  const deploymentDeadline = Date.now() + 90000;
  while (deployment.status === 'preparing' && Date.now() < deploymentDeadline) { await new Promise(resolve => setTimeout(resolve, 1000)); deployment = await api(`/api/test-deployments/${deployment.id}`); }
  assert.equal(deployment.status, 'ready', `Candidate test deployment failed: ${deployment.diagnostic ?? deployment.status}`);
  const grant = await api(`/api/test-deployments/${deployment.id}/sessions`, 'POST', { actorId: 'U1001' });
  const bearer = { origin, authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' };
  const admitted = await api(`/test-api/deployments/${deployment.id}/messages`, 'POST', { clientRequestId: randomUUID(), input: '请查询 PUMP-001 的状态、温度和来源。' }, bearer);
  assert.ok(admitted.requestId, 'Invocation response must include requestId');
  let view;
  const runDeadline = Date.now() + 120000;
  while (Date.now() < runDeadline) {
    view = await api(`/api/test-deployments/${deployment.id}/requests/${admitted.requestId}`);
    if (view.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(view.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(view?.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(view.run.status), 'Run did not reach a terminal status');
  const events = await api(`/api/runs/${view.run.id}/events`);
  const modelCalls = events.items.filter(event => event.type === 'runtime.event' && event.data?.event?.event === 'before_model_call').length;
  const calls = await mockCalls(deployment.environmentId, view.run.id);
  const toolCalls = calls.operations.filter(operation => operation === 'equipment-status').length;
  result = { schemaVersion: 1, requirement: 'TD-15/NF-04 deployed candidate iteration limit', executionMode: composeProject ? 'isolated-live-docker' : 'live-platform', composeProject: composeProject ?? null, appImageId, measuredAt: new Date().toISOString(), draftId: draft.id, snapshotId: snapshot.id,
    candidateId: candidate.id, testDeploymentId: deployment.id, runId: view.run.id, maxIterations: 1, runStatus: view.run.status, diagnostic: view.run.diagnostic,
    runtimeError: events.items.find(event => event.type === 'run.failed')?.data?.runtimeError ?? null,
    modelCallCount: modelCalls, externalToolCallCount: toolCalls, unrelatedExternalCalls: calls.count - toolCalls,
    limitRespected: modelCalls === 1 && toolCalls <= 1, runSucceeded: view.run.status === 'succeeded',
    verdict: modelCalls === 1 && toolCalls === 1 && calls.count === toolCalls && view.run.status === 'failed' && view.run.diagnostic === 'ITERATION_LIMIT_REACHED' ? 'passed' : 'failed' };
} finally {
  if (deployment && !['stopped', 'failed'].includes(deployment.status)) {
    try {
      deployment = await api(`/api/test-deployments/${deployment.id}/stop`, 'POST', {});
      const stopDeadline = Date.now() + 60000;
      while (deployment.status === 'stopping' && Date.now() < stopDeadline) { await new Promise(resolve => setTimeout(resolve, 1000)); deployment = await api(`/api/test-deployments/${deployment.id}`); }
      if (result) result.cleanupStatus = deployment.status;
    } catch (error) { if (result) result.cleanupStatus = `unconfirmed:${error.message}`; }
  }
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: management }).catch(() => {});
}
assert.ok(result, 'No live iteration evidence was collected');
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF04-iterations-live.json', JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
if (result.verdict !== 'passed' || result.cleanupStatus !== 'stopped') process.exitCode = 1;
