import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';
const login = async () => {
  const response = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrfToken };
};
const session = await login();
const existingRunId = process.env.PROBE_RUN_ID;
const validationId = process.env.PROBE_VALIDATION_ID;
const get = async (path, activeSession = session) => { const response = await fetch(`${base}${path}`, { headers: { Cookie: activeSession.cookie } }); assert.equal(response.status, 200); return response.json(); };
const inService = async (service, path, tokenName, port) => {
  const code = `const r=await fetch('http://127.0.0.1:${port}${path}',{headers:{authorization:'Bearer '+process.env.${tokenName}}});if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()));`;
  const child = spawn('docker', ['compose', '--env-file', '.env.local', 'exec', '-T', service, 'node', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; });
  assert.equal(await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); }), 0); return JSON.parse(output);
};
const runBefore = existingRunId ? await get(`/api/runs/${existingRunId}`) : null;
if (runBefore) assert.equal(['succeeded', 'failed', 'cancelled'].includes(runBefore.status), true, 'Only restart a completed probe run');
const eventsBefore = runBefore ? await get(`/api/runs/${runBefore.id}/events`) : null;
const callsBefore = runBefore ? await inService('mock-services', `/control/environments/${runBefore.environmentId}/calls`, 'MOCK_CONTROL_TOKEN', 8082) : null;
const executionBefore = runBefore ? await inService('runner', `/executions/${runBefore.id}`, 'RUNNER_CONTROL_TOKEN', 8081) : null;
const actionsBefore = runBefore ? await get(`/api/runs/${runBefore.id}/actions`) : null;
const stateBefore = runBefore ? await inService('mock-services', `/control/environments/${runBefore.environmentId}`, 'MOCK_CONTROL_TOKEN', 8082) : null;
const validationBefore = validationId ? await get(`/api/validations/${validationId}`) : null;
if (validationBefore) assert.equal(validationBefore.status, 'completed', 'Only restart a completed validation probe');
const reportBefore = validationId ? await get(`/api/validations/${validationId}/report`) : null;
const baselineBefore = reportBefore ? await get(`/api/baselines/${reportBefore.baselineId}`) : null;
const evidenceBefore = reportBefore ? await Promise.all(reportBefore.cases.filter(c => c.evidenceId).map(async c => ({ id: c.evidenceId, content: await get(`/api/validations/${validationId}/evidence/${c.evidenceId}`) }))) : [];
const input = { name: '部署重启验证草稿', brief: Object.fromEntries(['audience', 'goal', 'output'].map(key => [key, { value: `restart-check-${key}`, source: 'user', confirmed: false }])) };
const created = await fetch(`${base}/api/drafts`, { method: 'POST', headers: { Origin: base, Cookie: session.cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
assert.equal(created.status, 201);
const draft = await created.json();
const confirmation = await fetch(`${base}/api/drafts/${draft.id}`, { method: 'PUT', headers: { Origin: base, Cookie: session.cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...input, expectedRevision: 1, brief: Object.fromEntries(Object.entries(input.brief).map(([key, value]) => [key, { ...value, confirmed: true }])) }) });
assert.equal(confirmation.status, 200);
const confirmedDraft = await confirmation.json();
const frozen = await fetch(`${base}/api/drafts/${draft.id}/snapshots`, { method: 'POST', headers: { Origin: base, Cookie: session.cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expectedRevision: 2, assembly: { agentType: 'DeepAgent', systemPrompt: '根据工具结果查询设备。', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] } }) });
assert.equal(frozen.status, 201);
const snapshot = await frozen.json();
const services = runBefore || validationBefore ? ['postgres', 'mock-services', 'runner', 'app'] : ['postgres', 'app'];
const child = spawn('docker', ['compose', '--env-file', '.env.local', 'restart', ...services], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
child.stderr.on('data', () => {});
assert.equal(await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); }), 0);
const deadline = Date.now() + 30000;
let ready = false;
while (Date.now() < deadline) {
  try { const response = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}
assert.equal(ready, true);
assert.equal((await fetch(`${base}/api/drafts`, { headers: { Cookie: session.cookie } })).status, 401);
const newSession = await login();
if (runBefore || validationBefore) {
  const dependencyDeadline = Date.now() + 30000;
  let dependenciesReady = false;
  while (Date.now() < dependencyDeadline) {
    try { if ((await get('/api/environment', newSession)).canRun) { dependenciesReady = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(dependenciesReady, true, 'Wait for Runner and Mock recovery before reading execution evidence');
}
const restored = await fetch(`${base}/api/drafts/${draft.id}`, { headers: { Cookie: newSession.cookie } });
assert.equal(restored.status, 200);
assert.deepEqual(await restored.json(), confirmedDraft);
const restoredSnapshot = await fetch(`${base}/api/snapshots/${snapshot.id}`, { headers: { Cookie: newSession.cookie } });
assert.equal(restoredSnapshot.status, 200);
assert.deepEqual(await restoredSnapshot.json(), snapshot);
if (runBefore) {
  assert.deepEqual(await get(`/api/runs/${runBefore.id}`, newSession), runBefore);
  assert.deepEqual(await get(`/api/runs/${runBefore.id}/events`, newSession), eventsBefore);
  assert.deepEqual(await inService('mock-services', `/control/environments/${runBefore.environmentId}/calls`, 'MOCK_CONTROL_TOKEN', 8082), callsBefore);
  assert.deepEqual(await inService('runner', `/executions/${runBefore.id}`, 'RUNNER_CONTROL_TOKEN', 8081), executionBefore);
  assert.deepEqual(await get(`/api/runs/${runBefore.id}/actions`, newSession), actionsBefore);
  assert.deepEqual(await inService('mock-services', `/control/environments/${runBefore.environmentId}`, 'MOCK_CONTROL_TOKEN', 8082), stateBefore);
}
const result = { executionMode: 'live-platform', checkedAt: new Date().toISOString(), draftId: draft.id, snapshotId: snapshot.id, snapshotDigest: snapshot.digest,
  persistedExactly: true, snapshotPersistedExactly: true, previousSessionInvalidated: true, servicesRestarted: services,
  ...(runBefore ? { runId: runBefore.id, runPersistedExactly: true, eventsPersistedExactly: true, externalCallsPersistedExactly: true, runnerExecutionPersistedExactly: true,
    actionsPersistedExactly: true, businessStatePersistedExactly: true } : {}) };
if (validationBefore) {
  assert.deepEqual(await get(`/api/validations/${validationId}`, newSession), validationBefore);
  assert.deepEqual(await get(`/api/validations/${validationId}/report`, newSession), reportBefore);
  assert.deepEqual(await get(`/api/baselines/${reportBefore.baselineId}`, newSession), baselineBefore);
  for (const item of evidenceBefore) assert.deepEqual(await get(`/api/validations/${validationId}/evidence/${item.id}`, newSession), item.content);
  Object.assign(result, { validationId, validationPersistedExactly: true, reportPersistedExactly: true, baselinePersistedExactly: true, validationEvidencePersistedExactly: true });
}
const directory = `test-results/restart-${Date.now()}`;
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
