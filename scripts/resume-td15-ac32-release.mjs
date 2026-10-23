import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const base = (process.env.TD15_AC32_BASE_URL ?? 'http://127.0.0.1:18083').replace(/\/$/, '');
const origin = process.env.TD15_AC32_ORIGIN ?? base;
const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-ac32';
const sourcePath = process.env.TD15_AC32_SOURCE_EVIDENCE ?? 'docs/implementation/evidence/TD15-AC32-wealth-assistant-live-release-revision-conflict.json';
const evidencePath = process.env.TD15_AC32_EVIDENCE_PATH ?? 'docs/implementation/evidence/TD15-AC32-wealth-assistant-live.json';
const token = process.env.LOCAL_BOOTSTRAP_TOKEN ?? (await readFile('.env.local', 'utf8')).split(/\r?\n/).find(line => line.startsWith('LOCAL_BOOTSTRAP_TOKEN='))?.slice('LOCAL_BOOTSTRAP_TOKEN='.length).replace(/^['"]|['"]$/g, '');
assert.ok(token, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const evidence = { schemaVersion: 1, caseId: 'AC-32', executionMode: 'live-mock-resumed', sourceEvidence: sourcePath, startedAt: new Date().toISOString(), base, composeProject: project, verdict: 'running' };
let cookie;
let csrf;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const imageIds = () => {
  const ids = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(ids.length, 2, 'APP_RUNNER_TARGET_REQUIRED');
  return execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...ids], { encoding: 'utf8' }).trim().split(/\r?\n/);
};
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
assert.equal(login.status, 200, 'LOGIN_FAILED');
cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf, 'SESSION_CONTEXT_REQUIRED');
const readHeaders = { cookie };
const writeHeaders = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? readHeaders : writeHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `API_${method}_${response.status}_${value?.code ?? path}`);
  return value;
}
async function poll(path, terminals, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await api(path);
    if (terminals.includes(value.status)) return value;
    await wait(1000);
  }
  throw new Error(`${label}_TIMEOUT`);
}
async function business(path, method, body, grant) {
  const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000) });
  const value = await response.json();
  assert.ok(response.ok, `BUSINESS_${method}_${response.status}:${value?.code ?? path}`);
  return value;
}
async function pollBusiness(path, grant) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const value = await business(path, 'GET', undefined, grant);
    if (value.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(value.run.status)) return value;
    await wait(500);
  }
  throw new Error('BUSINESS_RUN_TIMEOUT');
}

try {
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  assert.equal(source.validation?.verdict, 'passed', 'SOURCE_VALIDATION_NOT_PASSED');
  assert.ok(source.draftId && source.snapshotId && source.validationId && source.candidate?.id && source.candidate?.artifactDigest, 'SOURCE_CANDIDATE_BINDING_INCOMPLETE');
  evidence.draftId = source.draftId;
  evidence.snapshotId = source.snapshotId;
  evidence.baselineId = source.baselineId;
  evidence.candidate = source.candidate;
  evidence.validationId = source.validationId;
  evidence.validation = source.validation;
  evidence.sourceTargetImageIds = source.finalTargetImageIds;
  evidence.targetImageIds = imageIds();
  assert.equal(evidence.targetImageIds[1], source.finalTargetImageIds[1], 'RUNNER_IMAGE_CHANGED_SINCE_VALIDATION');

  const validation = await api(`/api/validations/${source.validationId}/report`);
  assert.equal(validation.verdict, 'passed', 'LIVE_VALIDATION_NOT_PASSED');
  assert.equal(validation.snapshotId, source.snapshotId, 'VALIDATION_SNAPSHOT_MISMATCH');
  evidence.liveValidationCheckedAt = new Date().toISOString();
  const overviewBefore = await api(`/api/drafts/${source.draftId}/releases`);
  evidence.releasePointerBefore = overviewBefore.pointer ?? null;
  const releaseStarted = await api(`/api/drafts/${source.draftId}/releases`, 'POST', {
    clientRequestId: randomUUID(), snapshotId: source.snapshotId, validationId: source.validationId,
    expectedRevision: overviewBefore.pointer?.revision ?? 0
  });
  const release = await poll(`/api/releases/${releaseStarted.id}`, ['succeeded', 'failed'], 180_000, 'RELEASE');
  evidence.release = release;
  assert.equal(release.status, 'succeeded', `RELEASE_${release.diagnostic ?? release.status}`);
  const overview = await api(`/api/drafts/${source.draftId}/releases`);
  const version = overview.versions.find(item => item.operationId === release.id);
  assert.ok(version, 'PUBLISHED_VERSION_MISSING');
  evidence.agentVersion = version.id;

  const grant = await api('/api/demo-sessions', 'POST', { agentId: source.draftId, actorId: 'U1001' });
  evidence.actorId = grant.actorId;
  let balance = await business(`/agent-api/agents/${source.draftId}/messages`, 'POST', { clientRequestId: randomUUID(), input: '查询账户 A1001 的可用余额、币种和更新时间。' }, grant);
  balance = await pollBusiness(`/agent-api/requests/${balance.requestId}`, grant);
  evidence.balanceRequest = balance;
  assert.equal(balance.run.status, 'succeeded', 'BALANCE_APP_RUN_FAILED');
  assert.equal(balance.agentVersion, version.id, 'BALANCE_VERSION_MISMATCH');
  assert.equal(balance.run.artifactDigest, source.candidate.artifactDigest, 'BALANCE_ARTIFACT_MISMATCH');
  assert.ok(balance.run.externalEvidence?.some(item => item.operation === 'getAccountBalance' && item.status === 200), 'BALANCE_MOCK_EVIDENCE_MISSING');

  let products = await business(`/agent-api/agents/${source.draftId}/messages`, 'POST', { clientRequestId: randomUUID(), conversationId: balance.conversationId, input: '请查询当前全部理财产品目录，列出产品编号、名称、状态和最低金额。' }, grant);
  products = await pollBusiness(`/agent-api/requests/${products.requestId}`, grant);
  evidence.productsRequest = products;
  assert.equal(products.run.status, 'succeeded', 'PRODUCTS_APP_RUN_FAILED');
  assert.equal(products.agentVersion, version.id, 'PRODUCTS_VERSION_MISMATCH');
  assert.equal(products.run.artifactDigest, source.candidate.artifactDigest, 'PRODUCTS_ARTIFACT_MISMATCH');
  assert.ok(products.run.externalEvidence?.some(item => item.operation === 'listWealthProducts' && item.status === 200), 'PRODUCTS_MOCK_EVIDENCE_MISSING');
  const resultText = JSON.stringify(products.run.result);
  assert.ok(resultText.includes('SIM-W001') && resultText.includes('SIM-W002'), 'PRODUCT_DIRECTORY_RESULT_INCOMPLETE');
  evidence.branches = { 'release-pointer-revision': true, 'published-balance-query': true, 'published-product-directory': true, 'request-run-version': true };
  evidence.verdict = 'passed';
} catch (error) {
  evidence.verdict = 'failed';
  evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  try { evidence.finalTargetImageIds = imageIds(); } catch { evidence.finalTargetImageIds = null; }
  if (cookie && csrf) await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: evidence.verdict, evidencePath, draftId: evidence.draftId, validationId: evidence.validationId, releaseId: evidence.release?.id }));
}
