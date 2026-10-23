import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.TD15_ACCEPTANCE_BASE_URL ?? 'http://127.0.0.1:18080';
const origin = process.env.TD15_ACCEPTANCE_ORIGIN ?? base;
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const envText = await readFile('.env.local', 'utf8');
const tokenLine = envText.split(/\r?\n/).find(line => line.startsWith('LOCAL_BOOTSTRAP_TOKEN='));
const bootstrapToken = process.env.LOCAL_BOOTSTRAP_TOKEN ?? tokenLine?.slice('LOCAL_BOOTSTRAP_TOKEN='.length).replace(/^['"]|['"]$/g, '');
assert.ok(bootstrapToken, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
const rollback = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC16-rollback-live.json', 'utf8'));
const containerIds = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containerIds], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.equal(targetImageIds[1], active.targetImageIds[1], 'AC15_RUNNER_TARGET_CHANGED');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(path, method = 'GET', body, headers = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, value: response.status === 204 ? null : await response.json().catch(() => null) };
}
let runnerStopped = false;
let result;
try {
  const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: bootstrapToken }) });
  assert.equal(login.status, 200, 'AC15_PLATFORM_LOGIN_FAILED');
  const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
  const session = await login.json();
  const writeHeaders = { cookie, 'x-csrf-token': session.csrfToken };

  const current = await api(`/api/drafts/${rollback.agentId}/releases`, 'GET', undefined, { cookie });
  assert.equal(current.status, 200, `AC15_RELEASE_OVERVIEW_FAILED:${JSON.stringify(current.value)}`);
  let oldPointer = current.value.pointer;
  assert.ok(oldPointer?.versionId && oldPointer?.deploymentId && oldPointer.revision >= 1, 'AC15_EXPECTED_EXISTING_V1_POINTER');
  let v1 = current.value.versions.find(item => item.id === oldPointer.versionId);
  assert.ok(v1, 'AC15_CURRENT_VERSION_MISSING');
  let snapshot; let validationId; let report;
  if (process.env.AC15_REUSE_VALIDATION_ID && process.env.AC15_REUSE_SNAPSHOT_ID) {
    validationId = process.env.AC15_REUSE_VALIDATION_ID;
    const snapshotResponse = await api(`/api/snapshots/${process.env.AC15_REUSE_SNAPSHOT_ID}`, 'GET', undefined, { cookie });
    assert.equal(snapshotResponse.status, 200, `AC15_REUSE_SNAPSHOT_UNAVAILABLE:${snapshotResponse.value?.code}`);
    snapshot = snapshotResponse.value;
    assert.equal(snapshot.draftId, rollback.agentId, 'AC15_REUSE_SNAPSHOT_AGENT_MISMATCH');
    report = await api(`/api/validations/${validationId}/report`, 'GET', undefined, { cookie });
    assert.equal(report.status, 200, `AC15_REUSE_REPORT_UNAVAILABLE:${report.value?.code}`);
    assert.equal(report.value.snapshotId, snapshot.id, 'AC15_REUSE_REPORT_TARGET_MISMATCH');
    assert.equal(report.value.verdict, 'passed', 'AC15_REUSE_REPORT_NOT_PASSED');
  } else {
    const draft = await api(`/api/drafts/${rollback.agentId}`, 'GET', undefined, { cookie });
    assert.equal(draft.status, 200, `AC15_DRAFT_UNAVAILABLE:${draft.value?.code}`);
    const preview = await api(`/api/drafts/${rollback.agentId}/baseline-preview?templateId=equipment-workorder%401`, 'GET', undefined, { cookie });
    assert.equal(preview.status, 200, `AC15_BASELINE_PREVIEW_UNAVAILABLE:${preview.value?.code}`);
    const baseline = await api(`/api/drafts/${rollback.agentId}/baselines`, 'POST', {
      expectedRevision: draft.value.revision, templateId: 'equipment-workorder@1', expectedDigest: preview.value.digest, confirmed: true
    }, writeHeaders);
    assert.equal(baseline.status, 201, `AC15_BASELINE_CONFIRM_FAILED:${baseline.value?.code}`);
    const snapshotResponse = await api(`/api/drafts/${rollback.agentId}/snapshots`, 'POST', {
      expectedRevision: draft.value.revision, assembly: { agentType: 'DeepAgent', maxIterations: 8,
        railIds: ['audit@1','tool-allowlist@1','write-confirm@1'], toolIds: ['equipment-status@1','work-order-create@1'],
        systemPrompt: `你是设备运维助手。缺少设备编号时不得猜测或调用工具，输出 JSON：{"kind":"clarification","missingFields":["equipmentId"],"message":"请提供设备编号"}。有设备编号时必须先调用 get_equipment 获取事实。只读查询后只输出 JSON equipment-report，字段 equipmentId、status、temperatureCelsius、source 必须原样来自 Tool，recommendation 基于事实。工具报错、超时或数据缺失时不得编造事实、不重试；只输出 JSON：{"kind":"tool-error","code":"TOOL_UNAVAILABLE","message":"工具不可用，设备状态未知"}，若工具明确返回超时则 code 使用 TOOL_TIMEOUT。\n只有用户明确要求创建工单时才可调用 create_work_order。用户输入“申请创建检查工单”即为明确写入要求：必须先查询设备、说明实际温度和状态，再调用 create_work_order，priority=normal、description 简明说明检查原因。调用后必须等待平台确认结果；被拒绝、过期或取消时不得报告成功，不得重试。普通查询不得创建工单。成功后只报告工具返回的真实工单编号。禁止编造事实或业务结果。` }
    }, writeHeaders);
    assert.equal(snapshotResponse.status, 201, `AC15_SNAPSHOT_CREATE_FAILED:${snapshotResponse.value?.code}`);
    snapshot = snapshotResponse.value;
    const freshResponse = await api(`/api/snapshots/${snapshot.id}/validations`, 'POST', {
      clientRequestId: randomUUID(), baselineId: baseline.value.id, allowMockWrites: true
    }, writeHeaders);
    assert.equal(freshResponse.status, 202, `AC15_FRESH_VALIDATION_REJECTED:${freshResponse.value?.code}`);
    validationId = freshResponse.value.id;
    const validationDeadline = Date.now() + 900000; let validation;
    while (Date.now() < validationDeadline) {
      validation = await api(`/api/validations/${validationId}`, 'GET', undefined, { cookie });
      if (validation.status === 200 && validation.value.status === 'completed') break;
      await sleep(1000);
    }
    assert.equal(validation?.status, 200, 'AC15_FRESH_VALIDATION_UNAVAILABLE');
    assert.equal(validation.value.status, 'completed', 'AC15_FRESH_VALIDATION_DID_NOT_COMPLETE');
    report = await api(`/api/validations/${validationId}/report`, 'GET', undefined, { cookie });
    assert.equal(report.status, 200, `AC15_FRESH_REPORT_UNAVAILABLE:${report.value?.code}`);
    assert.equal(report.value.verdict, 'passed', `AC15_FRESH_VALIDATION_FAILED:${report.value.verdict}`);
  }
  // Establish a currently compatible v1 first. The previous published v1 may refer to an older Mock contract digest.
  const refresh = await api(`/api/drafts/${rollback.agentId}/releases`, 'POST', {
    clientRequestId: randomUUID(), snapshotId: snapshot.id, validationId, expectedRevision: oldPointer.revision
  }, writeHeaders);
  assert.equal(refresh.status, 202, `AC15_CURRENT_V1_REFRESH_REJECTED:${refresh.value?.code}`);
  let refreshedOperation; const refreshDeadline = Date.now() + 120000;
  while (Date.now() < refreshDeadline) {
    const response = await api(`/api/releases/${refresh.value.id}`, 'GET', undefined, { cookie });
    if (response.status === 200 && ['succeeded','failed'].includes(response.value.status)) { refreshedOperation = response.value; break; }
    await sleep(500);
  }
  assert.equal(refreshedOperation?.status, 'succeeded', `AC15_CURRENT_V1_REFRESH_FAILED:${refreshedOperation?.diagnostic ?? ''}`);
  const refreshedOverview = await api(`/api/drafts/${rollback.agentId}/releases`, 'GET', undefined, { cookie });
  oldPointer = refreshedOverview.value.pointer;
  v1 = refreshedOverview.value.versions.find(item => item.id === oldPointer.versionId);
  assert.ok(v1 && v1.snapshotId === snapshot.id, 'AC15_CURRENT_V1_REFRESH_NOT_ACTIVE');
  const request = await api(`/api/drafts/${rollback.agentId}/releases`, 'POST', {
    clientRequestId: randomUUID(), snapshotId: snapshot.id, validationId, expectedRevision: oldPointer.revision
  }, writeHeaders);
  assert.equal(request.status, 202, `AC15_RELEASE_REQUEST_REJECTED:${request.value?.code}`);
  const prepareDeadline = Date.now() + 10000;
  let preparing;
  while (Date.now() < prepareDeadline) {
    const response = await api(`/api/releases/${request.value.id}`, 'GET', undefined, { cookie });
    if (response.status === 200 && response.value.status === 'preparing') { preparing = response.value; break; }
    assert.notEqual(response.value?.status, 'failed', `AC15_RELEASE_FAILED_BEFORE_START:${response.value?.diagnostic}`);
    await sleep(30);
  }
  assert.ok(preparing, 'AC15_RELEASE_DID_NOT_ENTER_PREPARING');
  // The preparing state is committed only after the second release-gate check and before the Runner call.
  await sleep(30);
  compose('kill', 'runner'); runnerStopped = true;
  const deadline = Date.now() + 30000;
  let failed;
  while (Date.now() < deadline) {
    const response = await api(`/api/releases/${request.value.id}`, 'GET', undefined, { cookie });
    if (response.status === 200 && response.value.status === 'failed') { failed = response.value; break; }
    await sleep(250);
  }
  assert.ok(failed, 'AC15_RELEASE_DID_NOT_FAIL_AFTER_RUNNER_STOP');
  assert.match(failed.diagnostic ?? '', /RUNNER|DEPLOY|CONNECTION|REQUEST|UNAVAILABLE/i, 'AC15_FAILURE_REASON_NOT_RECORDED');
  const recoveryStartedAt = Date.now();
  compose('start', 'runner'); runnerStopped = false;
  // Runner restores retained JVM deployments sequentially before opening its HTTP listener.
  // Allow the full Compose health-check window when the stack has accumulated many releases.
  const readyDeadline = Date.now() + 180000;
  let runnerReady = false;
  while (Date.now() < readyDeadline) {
    try { runnerReady = compose('ps', 'runner').includes('(healthy)'); if (runnerReady) break; } catch {}
    await sleep(500);
  }
  assert.ok(runnerReady, 'AC15_RUNNER_NOT_RECOVERED');
  const runnerRecoveryDurationMs = Date.now() - recoveryStartedAt;
  const after = await api(`/api/drafts/${rollback.agentId}/releases`, 'GET', undefined, { cookie });
  assert.equal(after.status, 200);
  assert.deepEqual(after.value.pointer, oldPointer, 'AC15_OLD_RELEASE_POINTER_CHANGED');
  assert.equal(after.value.operations.find(item => item.id === failed.id)?.status, 'failed');

  const grant = await api('/api/demo-sessions', 'POST', { agentId: rollback.agentId, actorId: 'U1001' }, writeHeaders);
  assert.equal(grant.status, 201, `AC15_DEMO_SESSION_FAILED:${grant.value?.code}`);
  const message = await api(`/agent-api/agents/${rollback.agentId}/messages`, 'POST', { clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态。' }, { authorization: `Bearer ${grant.value.token}` });
  assert.equal(message.status, 202, `AC15_V1_READONLY_REQUEST_FAILED:${message.value?.code}`);
  const runId = message.value.runId ?? message.value.id;
  let run;
  const runDeadline = Date.now() + 90000;
  while (Date.now() < runDeadline) {
    const response = await api(`/api/runs/${runId}`, 'GET', undefined, { cookie });
    if (response.status === 200 && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(response.value.status)) { run = response.value; break; }
    await sleep(500);
  }
  assert.equal(run?.status, 'succeeded', 'AC15_PREVIOUS_RELEASE_NOT_SERVING');
  assert.equal(run.snapshotId, v1.snapshotId);
  result = { schemaVersion: 1, requirement: 'TD-15 P0-A AC-15 failed v2 startup preserves the current v1 release', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, baseUrl: base,
    targetImageIds, agentId: rollback.agentId, oldPointer, validationId, failedOperation: { id: failed.id, status: failed.status, diagnostic: failed.diagnostic }, runnerRecovered: runnerReady, runnerRecoveryDurationMs,
    pointerUnchanged: JSON.stringify(after.value.pointer) === JSON.stringify(oldPointer), readOnlyRun: { id: run.id, status: run.status, snapshotId: run.snapshotId, agentVersion: run.agentVersion },
    verdict: 'passed' };
} catch (error) {
  result = { schemaVersion: 1, requirement: 'TD-15 P0-A AC-15 failed v2 startup preserves the current v1 release', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds, verdict: 'failed', failure: String(error?.stack ?? error) };
  throw error;
} finally {
  if (runnerStopped) compose('start', 'runner');
  if (result) { await mkdir('docs/implementation/evidence', { recursive: true }); await writeFile('docs/implementation/evidence/TD15-AC15-startup-failure-live.json', JSON.stringify(result, null, 2) + '\n'); }
}
process.stdout.write(JSON.stringify({ verdict: result.verdict, failedRelease: result.failedOperation?.id, pointerUnchanged: result.pointerUnchanged, previousReleaseRun: result.readOnlyRun?.status }) + '\n');
