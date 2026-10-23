import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.TD15_ACCEPTANCE_BASE_URL ?? 'http://127.0.0.1:18080';
const origin = process.env.TD15_ACCEPTANCE_ORIGIN ?? base;
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).trim();
const envText = await readFile('.env.local', 'utf8');
const envValue = key => envText.split(/\r?\n/).find(line => line.startsWith(`${key}=`))?.slice(key.length + 1).replace(/^['"]|['"]$/g, '');
const bootstrapToken = process.env.LOCAL_BOOTSTRAP_TOKEN ?? envValue('LOCAL_BOOTSTRAP_TOKEN');
assert.ok(bootstrapToken, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-AC15-startup-failure-live.json', 'utf8'));
const containers = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(targetImageIds, active.targetImageIds, 'AC19_TARGET_IMAGE_CHANGED');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function authenticate() {
  const response = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: bootstrapToken }) });
  assert.equal(response.status, 200, 'LOCAL_LOGIN_FAILED');
  const cookie = response.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
  const csrfToken = (await response.json()).csrfToken;
  assert.ok(cookie && csrfToken);
  return { origin, cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
}
let management = await authenticate();
async function api(path, method = 'GET', body, headers = management) {
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, value };
}
function mockEvidence(environmentId, runId) {
  const js = `const h={authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN};const b='http://127.0.0.1:8082';const get=async p=>{const r=await fetch(b+p,{headers:h});if(r.status===404)return null;if(!r.ok)throw new Error('MOCK_EVIDENCE_HTTP_'+r.status);return r.json()};const calls=await get('/control/environments/${environmentId}/calls?runId=${runId}');const env=await get('/control/environments/${environmentId}');if(!calls||!env){console.log(JSON.stringify({pending:true}));process.exit(0)}console.log(JSON.stringify({config:env.config,calls:calls.items.map(x=>({operation:x.operation,status:x.status,result:x.result})),workOrderCallCount:calls.items.filter(x=>x.operation==='work-order-create').length,workOrders:Object.values(env.state.workOrders||{}).map(x=>({workOrderId:x.workOrderId,status:x.status,actorId:x.actorId}))}));`;
  return JSON.parse(compose('exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', js));
}
let validation; let testDeployment; let result;
try {
  const requestId = randomUUID();
  const draft = (await api('/api/drafts', 'POST', { name: `ac19-cancel-${requestId.slice(0, 8)}`, brief: {
    audience: { value: 'TD-15 AC-19 live cancellation regression', source: 'user', confirmed: true },
    goal: { value: '查询设备并在用户确认后创建模拟工单', source: 'user', confirmed: true },
    output: { value: '设备事实、取消状态和工单对账证据', source: 'user', confirmed: true }
  } })).value;
  const snapshot = (await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly: {
    agentType: 'DeepAgent', systemPrompt: `你是设备运维助手。业务目标：查询设备事实，经确认创建模拟工单；重复写入不得产生重复业务效果。缺少设备编号时不得猜测或调用工具，输出 JSON：{"kind":"clarification","missingFields":["equipmentId"],"message":"请提供设备编号"}。
有设备编号时必须调用 get_equipment 获取事实。只读查询完成后仅输出一个 JSON 对象（不添加其他字段）：kind 固定为 equipment-report，equipmentId、status、temperatureCelsius、source 原样取自工具结果，recommendation 为基于事实的中文建议。
工具报错、超时或数据缺失时不编造事实，不重试；仅输出 {"kind":"tool-error","code":"TOOL_UNAVAILABLE","message":"说明工具不可用，设备状态未知"}。
只有当前用户明确要求创建工单时才调用 create_work_order；普通查询不得创建工单。申请工单前先调用 get_equipment，并向用户说明真实温度、状态、来源和建议，再调用 create_work_order（priority 为 normal）。平台会暂停等待确认。成功后报告真实工单编号，失败时说明实际结果；禁止编造工单或重复创建。`,
    maxIterations: 6, railIds: ['audit@1', 'tool-allowlist@1', 'write-confirm@1'], toolIds: ['equipment-status@1', 'work-order-create@1']
  } })).value;
  const preview = (await api(`/api/drafts/${draft.id}/baseline-preview?templateId=equipment-workorder@1`)).value;
  const baseline = (await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision, templateId: 'equipment-workorder@1', expectedDigest: preview.digest, confirmed: true })).value;
  const candidateResponse = await api('/api/candidates', 'POST', { snapshotId: snapshot.id });
  assert.equal(candidateResponse.status, 201, `CANDIDATE_CREATE_FAILED:${candidateResponse.value?.code}`);
  const candidate = candidateResponse.value;
  const validationResponse = await api(`/api/snapshots/${snapshot.id}/validations`, 'POST', { clientRequestId: requestId, baselineId: baseline.id, allowMockWrites: true, candidateId: candidate.id });
  assert.equal(validationResponse.status, 202, `VALIDATION_START_FAILED:${validationResponse.value?.code}`);
  validation = validationResponse.value;

  const deadline = Date.now() + 900000; let targetCase; let mock; let run;
  while (Date.now() < deadline) {
    validation = (await api(`/api/validations/${validation.id}`)).value;
    targetCase = validation.cases.find(item => item.caseId === 'TC-008');
    if (targetCase?.state === 'running' && targetCase.testDeploymentId && targetCase.runId) {
      testDeployment = (await api(`/api/test-deployments/${targetCase.testDeploymentId}`)).value;
      run = (await api(`/api/runs/${targetCase.runId}`)).value;
      mock = mockEvidence(testDeployment.environmentId, targetCase.runId);
      if (mock.workOrderCallCount === 1 && run.status === 'running') break;
    }
    if (validation.status === 'completed') throw new Error('TC008_COMPLETED_BEFORE_CANCEL');
    await sleep(100);
  }
  assert.ok(targetCase?.runId && testDeployment && mock?.workOrderCallCount === 1 && run?.status === 'running', 'AC19_UNKNOWN_WRITE_WINDOW_NOT_REACHED');
  assert.equal(mock.config.fault, 'write-after-timeout', 'AC19_FAULT_PROFILE_NOT_ACTIVE');
  const actionsBefore = (await api(`/api/runs/${run.id}/actions`)).value.items;
  assert.equal(actionsBefore.length, 1);
  assert.equal(actionsBefore[0].status, 'executing', 'AC19_WRITE_NOT_UNCERTAIN');

  const cancellation = await api(`/api/runs/${run.id}/cancel`, 'POST', {});
  assert.equal(cancellation.status, 202, 'AC19_CANCEL_NOT_ACCEPTED');
  assert.equal(cancellation.value.status, 'cancelling', 'AC19_CANCEL_REPORTED_TERMINAL_TOO_EARLY');
  await sleep(100);
  const duringRun = (await api(`/api/runs/${run.id}`)).value;
  const duringActions = (await api(`/api/runs/${run.id}/actions`)).value.items;
  assert.ok(['cancelling', 'reconciling'].includes(duringRun.status), `AC19_PREMATURE_TERMINAL:${duringRun.status}`);
  assert.ok(duringActions.some(item => ['executing', 'unknown'].includes(item.status)), 'AC19_UNKNOWN_ACTION_NOT_RETAINED');

  const settleDeadline = Date.now() + 60000; let finalRun;
  while (Date.now() < settleDeadline) {
    finalRun = (await api(`/api/runs/${run.id}`)).value;
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(finalRun.status)) break;
    await sleep(200);
  }
  const finalActions = (await api(`/api/runs/${run.id}/actions`)).value.items;
  const events = (await api(`/api/runs/${run.id}/events`)).value.items;
  const finalMock = mockEvidence(testDeployment.environmentId, run.id);
  const action = finalActions[0];
  const reconciled = action.status === 'succeeded' && action.response?.result?.workOrderId
    && events.some(event => event.type === 'action.reconcile_found' || event.type === 'action.write_succeeded');
  assert.equal(finalRun.status, 'cancelled', 'AC19_CANCELLED_TERMINAL_NOT_REACHED');
  assert.ok(reconciled, 'AC19_EXTERNAL_WRITE_RESULT_NOT_RECONCILED');
  assert.equal(finalMock.workOrderCallCount, 1, 'AC19_DUPLICATE_WRITE');
  assert.equal(finalMock.workOrders.length, 1, 'AC19_EXTERNAL_STATE_NOT_EXACTLY_ONCE');

  result = { schemaVersion: 1, requirement: 'TD-15 P0-A AC-19 accepted cancellation and uncertain Mock write reconciliation', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds,
    draftId: draft.id, snapshotId: snapshot.id, baselineId: baseline.id, candidateId: candidate.id, validationId: validation.id, runId: run.id, testDeploymentId: testDeployment.id,
    beforeCancel: { runStatus: run.status, actionStatuses: actionsBefore.map(item => item.status), mockConfig: mock.config, mockWriteCalls: mock.workOrderCallCount },
    acceptedCancellation: { httpStatus: cancellation.status, immediateStatus: cancellation.value.status },
    duringUncertainty: { runStatus: duringRun.status, actionStatuses: duringActions.map(item => item.status) },
    afterReconciliation: { runStatus: finalRun.status, actionStatus: action.status, actionResponse: action.response, runEventTypes: events.map(event => event.type), mockWriteCalls: finalMock.workOrderCallCount, workOrders: finalMock.workOrders },
    branches: [
      { caseId: 'AC-19', branchId: 'cancel-accepted-before-terminal', status: 'passed', assertions: [{ name: 'cancel_acknowledged_as_cancelling', passed: cancellation.value.status === 'cancelling' }, { name: 'uncertainty_not_reported_terminal', passed: ['cancelling', 'reconciling'].includes(duringRun.status) }] },
      { caseId: 'AC-19', branchId: 'unknown-write-reconciled', status: 'passed', assertions: [{ name: 'original_write_key_result_reconciled', passed: reconciled }, { name: 'no_duplicate_external_effect', passed: finalMock.workOrderCallCount === 1 && finalMock.workOrders.length === 1 }] }
    ], verdict: 'passed' };
} catch (error) {
  result = { schemaVersion: 1, requirement: 'TD-15 P0-A AC-19 accepted cancellation and uncertain Mock write reconciliation', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds, verdict: 'failed', failure: String(error?.stack ?? error) };
  throw error;
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: management }).catch(() => {});
  if (result) { await mkdir('docs/implementation/evidence', { recursive: true }); await writeFile('docs/implementation/evidence/TD15-AC19-cancel-unknown-write-live.json', JSON.stringify(result, null, 2) + '\n'); }
}
process.stdout.write(JSON.stringify({ verdict: result.verdict, runId: result.runId, acceptedStatus: result.acceptedCancellation?.immediateStatus, duringStatus: result.duringUncertainty?.runStatus, finalStatus: result.afterReconciliation?.runStatus, writeCalls: result.afterReconciliation?.mockWriteCalls }) + '\n');
