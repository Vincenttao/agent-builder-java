import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const mockContainer = `${project}-mock-services-1`;
const image = name => execFileSync('docker', ['inspect', '--format', '{{.Image}}', name], { encoding: 'utf8' }).trim();
const appImage = image(`${project}-app-1`);
const runnerImage = image(`${project}-runner-1`);
const mockImage = image(mockContainer);
const target = JSON.parse(await readFile('test-results/acceptance/td15-platform-target.json', 'utf8'));
const liveReference = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC23-policy-audit-live.json', 'utf8'));
assert.equal(liveReference.composeProject, project, 'REFERENCE_PROJECT_CHANGED');
assert.deepEqual(liveReference.targetImageIds, [appImage, runnerImage], 'TARGET_IMAGE_CHANGED');
assert.equal(createHash('sha256').update(await readFile(target.artifactPath)).digest('hex'), target.artifactDigest, 'TARGET_ARTIFACT_CHANGED');

const probe = String.raw`
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:8082';
const control = process.env.MOCK_CONTROL_TOKEN;
const service = process.env.MOCK_SERVICE_TOKEN;
assert.ok(control && service, 'MOCK_CREDENTIALS_UNAVAILABLE');
const environments = [randomUUID(), randomUUID(), randomUUID()];
const headers = token => ({ authorization: 'Bearer ' + token });
const request = async (path, method, token, body, extra = {}) => {
  const response = await fetch(base + path, { method, headers: { ...headers(token), ...(body ? { 'content-type': 'application/json' } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let data = null; try { data = await response.json(); } catch {}
  return { status: response.status, data };
};
const config = (fault = 'normal') => ({ seed: 'enterprise-default@1', fault, clock: '2026-10-23T00:00:00.000Z' });
const getEnv = id => request('/control/environments/' + id, 'GET', control);
const create = async (id, cfg) => { const result = await request('/control/environments/' + id, 'PUT', control, cfg); assert.equal(result.status, 201, 'ENVIRONMENT_CREATE_FAILED'); return result.data; };
const reserve = (id, runId) => request('/control/environments/' + id + '/reserve', 'POST', control, { runId });
const release = (id, runId) => request('/control/environments/' + id + '/release', 'POST', control, { runId });
const reset = (id, revision) => request('/control/environments/' + id + '/reset', 'POST', control, { expectedRevision: revision });
const balance = async (environmentId, runId) => request('/mock-business/v1/accounts/A1001/balance', 'GET', service, undefined,
  { 'x-environment-id': environmentId, 'x-run-id': runId, 'x-actor-id': 'U1001' });
const calls = (id, runId) => request('/control/environments/' + id + '/calls?runId=' + runId, 'GET', control);
const active = new Map();
try {
  const [first, second, unknown] = environments;
  const initialA = await create(first, config());
  const initialB = await create(second, config());
  const unknownInitial = await create(unknown, config('write-after-timeout'));
  assert.deepEqual(initialA.state, initialB.state, 'SAME_SEED_STATE_MISMATCH');
  assert.deepEqual(initialA.config, initialB.config, 'SAME_SEED_CONFIG_MISMATCH');
  const runA = randomUUID();
  const beforeA = await balance(first, runA);
  const beforeB = await balance(second, randomUUID());
  assert.equal(beforeA.status, 200, 'ENV_A_READ_FAILED'); assert.equal(beforeB.status, 200, 'ENV_B_READ_FAILED');
  const writeA = await request('/mock-business/v1/wealth/orders', 'POST', service,
    { accountId: 'A1001', productId: 'SIM-W001', amountFen: 10000 },
    { 'x-environment-id': first, 'x-run-id': runA, 'x-actor-id': 'U1001', 'idempotency-key': randomUUID() });
  assert.equal(writeA.status, 200, 'ENV_A_WRITE_FAILED');
  const afterA = await balance(first, randomUUID()); const unchangedB = await balance(second, randomUUID());
  assert.equal(afterA.data.availableBalanceFen, beforeA.data.availableBalanceFen - 10000, 'ENV_A_STATE_NOT_UPDATED');
  assert.equal(unchangedB.data.availableBalanceFen, beforeB.data.availableBalanceFen, 'ENV_B_LEAKED_ENV_A_WRITE');

  const runActive = randomUUID(); assert.equal((await reserve(first, runActive)).status, 200); active.set(first, runActive);
  const resetActive = await reset(first, (await getEnv(first)).data.revision);
  assert.equal(resetActive.status, 409, 'ACTIVE_RUN_RESET_NOT_REJECTED');
  assert.equal(resetActive.data.code, 'ENVIRONMENT_IN_USE', 'ACTIVE_RUN_RESET_WRONG_CODE');
  assert.equal((await release(first, runActive)).status, 200); active.delete(first);

  const runUnknown = randomUUID(); assert.equal((await reserve(unknown, runUnknown)).status, 200); active.set(unknown, runUnknown);
  let responseLost = false;
  try {
    await fetch(base + '/mock-business/v1/wealth/orders', { method: 'POST', signal: AbortSignal.timeout(300),
      headers: { ...headers(service), 'content-type': 'application/json', 'x-environment-id': unknown, 'x-run-id': runUnknown,
        'x-actor-id': 'U1001', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ accountId: 'A1001', productId: 'SIM-W001', amountFen: 10000 }) });
  } catch (error) { responseLost = error?.name === 'TimeoutError'; }
  assert.equal(responseLost, true, 'WRITE_RESPONSE_DID_NOT_TIMEOUT');
  const unknownRevision = (await getEnv(unknown)).data.revision;
  const resetUnknown = await reset(unknown, unknownRevision);
  assert.equal(resetUnknown.status, 409, 'UNKNOWN_WRITE_RESET_NOT_REJECTED');
  assert.equal(resetUnknown.data.code, 'ENVIRONMENT_IN_USE', 'UNKNOWN_WRITE_RESET_WRONG_CODE');
  await new Promise(resolve => setTimeout(resolve, 6200));
  const unknownState = (await getEnv(unknown)).data;
  assert.equal(unknownState.state.balances.A1001, unknownInitial.state.balances.A1001 - 10000, 'UNKNOWN_WRITE_NOT_RECONCILED_IN_STATE');
  assert.equal((await release(unknown, runUnknown)).status, 200); active.delete(unknown);

  const beforeReset = (await getEnv(first)).data;
  const resetDone = await reset(first, beforeReset.revision);
  assert.equal(resetDone.status, 200, 'IDLE_ENVIRONMENT_RESET_FAILED');
  const afterReset = await getEnv(first);
  const retainedCalls = await calls(first, runA);
  assert.deepEqual(afterReset.data.state, initialA.state, 'RESET_DID_NOT_RESTORE_SEED_STATE');
  assert.ok(retainedCalls.data.items.some(item => item.operation === 'createMockSubscription'), 'HISTORY_REMOVED_BY_RESET');
  console.log(JSON.stringify({ environments, seed: 'enterprise-default@1', assertions: {
    sameSeed: true, independentInstances: true, activeRunResetDenied: true, unknownWriteResetDenied: true,
    unknownWriteCommittedAndObserved: true, historyRetainedAfterReset: true
  }, observations: { firstBefore: initialA.state.balances.A1001, firstAfterWrite: afterA.data.availableBalanceFen,
    secondAfterFirstWrite: unchangedB.data.availableBalanceFen, unknownAfterTimedOutWrite: unknownState.state.balances.A1001,
    firstRevisionAfterReset: afterReset.data.revision, firstCallCountAfterReset: retainedCalls.data.items.length } }));
} finally {
  for (const [id, runId] of active) await release(id, runId).catch(() => {});
}
`;

const raw = execFileSync('docker', ['exec', mockContainer, 'node', '--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 45_000 });
const observations = JSON.parse(raw.trim());
const evidence = { schemaVersion: 1, requirement: 'TD-15 P0-B AC-30 deterministic seed, independent Mock instances, reset guards and evidence retention',
  executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project,
  targetImageIds: [appImage, runnerImage], mockImageId: mockImage, artifactDigest: target.artifactDigest,
  compatibilityKey: target.compatibilityKey, ...observations, verdict: 'passed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-AC30-mock-isolation-live.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ verdict: evidence.verdict, composeProject: project, targetImageIds: evidence.targetImageIds, mockImageId: evidence.mockImageId, environments: evidence.environments }));
