import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = (process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, APP_PORT: new URL(base).port || '18080', APP_ORIGIN: origin } }).trim();
const compose = (...args) => docker('compose', '--env-file', '.env.local', '-p', project, ...args);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function authenticate() {
  const response = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
  assert.equal(response.status, 200, 'LOCAL_LOGIN_FAILED');
  const cookie = response.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
  const csrf = (await response.json()).csrfToken;
  assert.ok(cookie && csrf);
  return { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
}
let management = await authenticate();
async function api(path, method = 'GET', body, headers = management) {
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`HTTP_${method}_${response.status}_${value?.code ?? 'UNKNOWN'}`);
  return value;
}
function mockEvidence(environmentId, runId) {
  const js = `const h={authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN};const b='http://127.0.0.1:8082';const get=async p=>{const r=await fetch(b+p,{headers:h});if(!r.ok)throw new Error('MOCK_EVIDENCE_UNAVAILABLE');return r.json()};const c=await get('/control/environments/${environmentId}/calls?runId=${runId}');const e=await get('/control/environments/${environmentId}');console.log(JSON.stringify({callCount:c.items.length,operations:c.items.map(x=>x.operation),statuses:c.items.map(x=>x.status),workOrderCallCount:c.items.filter(x=>x.operation==='work-order-create').length,workOrderCount:Object.keys(e.state.workOrders||{}).length,workOrders:Object.values(e.state.workOrders||{}).map(x=>({workOrderId:x.workOrderId,status:x.status}))}));`;
  return JSON.parse(compose('exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', js));
}
function runnerJournal(runId) {
  const js = `import{readFile}from'node:fs/promises';const x=JSON.parse(await readFile('/data/executions/${runId}.json','utf8'));console.log(JSON.stringify({id:x.id,status:x.status,error:x.error??null,eventCount:x.events?.length??0}));`;
  return JSON.parse(compose('exec', '-T', 'runner', 'node', '--input-type=module', '-e', js));
}

let validation;
let targetDeployment;
let crashed = false;
let restarted = false;
let result;
try {
  const requestId = randomUUID();
  const draft = await api('/api/drafts', 'POST', { name: `nf01-active-write-${requestId.slice(0, 8)}`, brief: {
    audience: { value: '企业 AI 平台开发人员', source: 'user', confirmed: true },
    goal: { value: '查询设备事实，经确认创建模拟工单；重复写入不得产生重复业务效果', source: 'user', confirmed: true },
    output: { value: '设备事实、审批记录及工单号', source: 'user', confirmed: true }
  } });
  const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly: {
    agentType: 'DeepAgent', systemPrompt: `你是设备运维助手。业务目标：查询设备事实，经确认创建模拟工单；重复写入不得产生重复业务效果。缺少设备编号时不得猜测或调用工具，输出 JSON：{"kind":"clarification","missingFields":["equipmentId"],"message":"请提供设备编号"}。
有设备编号时必须调用 get_equipment 获取事实。只读查询完成后仅输出一个 JSON 对象（不添加其他字段）：kind 固定为 equipment-report，equipmentId、status、temperatureCelsius、source 原样取自工具结果，recommendation 为基于事实的中文建议。
工具报错、超时或数据缺失时不编造事实，不重试；仅输出 {"kind":"tool-error","code":"TOOL_UNAVAILABLE","message":"说明工具不可用，设备状态未知"}。
只有当前用户明确要求创建工单时才调用 create_work_order；普通查询不得创建工单。申请工单前先调用 get_equipment，并向用户说明真实温度、状态、来源和建议，再调用 create_work_order（priority 为 normal）。平台会暂停等待确认。成功后报告真实工单编号，失败时说明实际结果；禁止编造工单或重复创建。`,
    maxIterations: 6, railIds: ['audit@1', 'tool-allowlist@1', 'write-confirm@1'], toolIds: ['equipment-status@1', 'work-order-create@1']
  } });
  const preview = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=${encodeURIComponent('equipment-workorder@1')}`);
  const baseline = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision, templateId: 'equipment-workorder@1', expectedDigest: preview.digest, confirmed: true });
  const candidate = await api('/api/candidates', 'POST', { snapshotId: snapshot.id });
  const started = await api(`/api/snapshots/${snapshot.id}/validations`, 'POST', { clientRequestId: requestId, baselineId: baseline.id, allowMockWrites: true, candidateId: candidate.id });
  validation = started;

  const deadline = Date.now() + 900000;
  let progress; let runView; let mock;
  const targetCaseId = 'TC-008';
  while (Date.now() < deadline) {
    validation = await api(`/api/validations/${started.id}`);
    progress = validation.cases.find(item => item.caseId === targetCaseId);
    if (progress?.state === 'running' && progress.testDeploymentId && progress.requestId) {
      targetDeployment = await api(`/api/test-deployments/${progress.testDeploymentId}`);
      runView = await api(`/api/test-deployments/${progress.testDeploymentId}/requests/${progress.requestId}`);
      mock = mockEvidence(targetDeployment.environmentId, progress.runId);
      if (mock.callCount > 0 && mock.operations.includes('work-order-create')) break;
    }
    if (validation.status === 'completed') throw new Error('TARGET_CASE_COMPLETED_BEFORE_CRASH');
    await wait(350);
  }
  assert.ok(progress?.runId && targetDeployment && mock?.operations.includes('work-order-create'), 'DID_NOT_REACH_WRITE_AFTER_COMMIT_WINDOW');

  const actionsBefore = await api(`/api/runs/${progress.runId}/actions`);
  const runBefore = await api(`/api/runs/${progress.runId}`);
  const eventCursorBefore = await api(`/api/runs/${progress.runId}/events`);
  const beforeRestart = { validationStatus: validation.status, caseId: progress.caseId, runId: progress.runId, testDeploymentId: targetDeployment.id,
    runStatus: runBefore.status, actionStatuses: actionsBefore.items.map(item => item.status), actionCount: actionsBefore.items.length,
    mock, runtimeEvents: eventCursorBefore.items.filter(item => item.type === 'runtime.event').length };

  compose('kill', '--signal', 'SIGKILL', 'app', 'runner');
  crashed = true;
  compose('up', '-d', 'app', 'runner');
  const readyDeadline = Date.now() + 120000;
  while (Date.now() < readyDeadline) {
    try {
      const readiness = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(2000) });
      const statuses = compose('ps', '--format', 'json').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
      const runner = statuses.find(service => service.Service === 'runner');
      if (readiness.ok && runner?.Health === 'healthy') { restarted = true; break; }
    } catch {}
    await wait(1000);
  }
  assert.ok(restarted, 'APP_RUNNER_DID_NOT_RECOVER');
  management = await authenticate(); // App sessions are in-memory and do not survive its restart.
  await wait(9000); // Longer than the Mock write-after-timeout response delay.

  const settleDeadline = Date.now() + 180000;
  do {
    validation = await api(`/api/validations/${started.id}`);
    targetDeployment = await api(`/api/test-deployments/${targetDeployment.id}`);
    if (validation.status === 'completed' && targetDeployment.status === 'stopped') break;
    await wait(500);
  } while (Date.now() < settleDeadline);
  const runAfter = await api(`/api/runs/${progress.runId}`);
  const eventsAfter = await api(`/api/runs/${progress.runId}/events`);
  const actionsAfter = await api(`/api/runs/${progress.runId}/actions`);
  const afterMock = mockEvidence(targetDeployment.environmentId, progress.runId);
  const journal = runnerJournal(progress.runId);
  const report = validation.status === 'completed' ? await api(`/api/validations/${started.id}/report`) : null;
  const cases = report?.cases ?? [];
  const targetReport = cases.find(item => item.caseId === targetCaseId);
  const safetyRuleIds = ['action-outcome','before-approval-write-count','write-call-count','workorder-state-count','effective-decision-count','workorder-write-binding','original-key-reconciliation'];
  const safetyAssertionsPassed = safetyRuleIds.every(ruleId => targetReport?.assertions.some(assertion => assertion.ruleId === ruleId && assertion.status === 'passed'));
  const expectedInterruption = targetReport?.assertions.some(assertion => assertion.ruleId === 'run-status' && assertion.actual === 'interrupted' && assertion.expected === 'succeeded') ?? false;
  const earlierCasesPassed = Array.from({length:7},(_,index)=>cases.find(item=>item.caseId === `TC-00${index+1}`)?.status === 'passed').every(Boolean);
  const noDuplicateExternalWrite = afterMock.operations.filter(operation => operation === 'work-order-create').length === 1 && afterMock.workOrderCount === 1;
  const safetyVerdict = validation.status === 'completed' && targetDeployment.status === 'stopped' && journal.status === 'interrupted'
    && runAfter.status === 'interrupted' && noDuplicateExternalWrite && safetyAssertionsPassed && expectedInterruption && earlierCasesPassed
    ? 'passed-safety-with-expected-interruption' : 'failed';
  result = { schemaVersion: 1, requirement: 'TD-15/NF-01 Runner and App container crash during committed Mock write response', executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(), composeProject: project,
    draftId: draft.id, snapshotId: snapshot.id, baselineId: baseline.id, candidateId: candidate.id, candidateArtifactDigest: candidate.artifactDigest, validationId: started.id,
    validationStatus: validation.status, caseId: targetCaseId, runId: progress.runId, testDeploymentId: targetDeployment.id,
    beforeRestart, restart: { appRunnerKilled: crashed, appRunnerHealthyAfterRestart: restarted, runnerJournal: journal },
    afterRestart: { runStatus: runAfter.status, diagnostic: runAfter.diagnostic, actionStatuses: actionsAfter.items.map(item => item.status), actionCount: actionsAfter.items.length,
      mock: afterMock, runtimeEventCount: eventsAfter.items.filter(item => item.type === 'runtime.event').length,
      duplicateWrites: Math.max(0, afterMock.workOrderCallCount - 1), workOrderCount: afterMock.workOrderCount },
    validationReport: report ? { verdict: report.verdict, cases: cases.map(item=>({caseId:item.caseId,status:item.status})), tc008Assertions: targetReport?.assertions??[] } : null,
    noDuplicateExternalWrite, safetyAssertionsPassed, expectedInterruption, earlierCasesPassed,
    cleanup: { testDeploymentStatus: targetDeployment.status, isolatedComposeTeardownRequired: true }, verdict: safetyVerdict };
  const containers = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
  result.targetImageIds = docker('inspect', '--format', '{{.Image}}', ...containers).split(/\r?\n/);
} finally {
  if (crashed && !restarted) {
    try { compose('up', '-d', 'runner', 'app'); } catch {}
  }
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: management }).catch(() => {});
}
assert.ok(result, 'NO_NF01_EVIDENCE_COLLECTED');
await mkdir('docs/implementation/evidence', { recursive: true });
const evidencePath = 'docs/implementation/evidence/TD15-NF01-active-write-restart.json';
await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n');
if (result.verdict === 'passed-safety-with-expected-interruption') {
  const manifestBytes = await readFile('tests/acceptance/manifest.json');
  const manifest = JSON.parse(manifestBytes.toString());
  const identity = { schemaVersion: 1, composeProject: project, runId: result.runId, candidateId: result.candidateId,
    candidateArtifactDigest: result.candidateArtifactDigest, imageIds: result.targetImageIds,
    noDuplicateExternalWrite: result.noDuplicateExternalWrite, workOrderCount: result.afterRestart.workOrderCount };
  const artifactPath = 'test-results/acceptance/td15-nf01-target-artifact.json';
  await mkdir('test-results/acceptance/evidence', { recursive: true });
  const identityBytes = Buffer.from(JSON.stringify(identity, null, 2) + '\n');
  await writeFile(artifactPath, identityBytes);
  const artifactDigest = createHash('sha256').update(identityBytes).digest('hex');
  const compatibilityKey = createHash('sha256').update(JSON.stringify({ platform: process.platform, arch: process.arch, imageIds: result.targetImageIds })).digest('hex');
  await writeFile('test-results/acceptance/td15-nf01-target.json', JSON.stringify({ artifactPath, artifactDigest, compatibilityKey }, null, 2) + '\n');
  const binding = { baselineDigest: manifest.baselineDigest, artifactDigest, testSetDigest: createHash('sha256').update(manifestBytes).digest('hex'), compatibilityKey };
  const managedEvidencePath = 'test-results/acceptance/evidence/TD15-NF01-active-write-restart.json';
  await writeFile(managedEvidencePath, await readFile(evidencePath));
  const evidenceBytes = await readFile(managedEvidencePath);
  const evidence = { kind: 'execution-record', path: managedEvidencePath.replace('test-results/', ''), sha256: createHash('sha256').update(evidenceBytes).digest('hex') };
  const branchResult = { caseId: 'NF-01', branchId: 'no-replay-unknown-reconcile', binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest,
    assertions: [
      { name: 'unknown-run-remains-interrupted', passed: result.expectedInterruption && result.afterRestart.runStatus === 'interrupted' },
      { name: 'original-idempotency-key-reconciled', passed: result.validationReport?.tc008Assertions?.some(item => item.ruleId === 'original-key-reconciliation' && item.status === 'passed') === true },
      { name: 'external-write-not-replayed', passed: result.noDuplicateExternalWrite && result.afterRestart.duplicateWrites === 0 }
    ], evidence: [{ ...evidence, kind: 'assertions' }, evidence] };
  const resultsPath = 'test-results/acceptance/td15-nf01-results.json';
  result.acceptanceResultsPath = resultsPath;
  await writeFile(resultsPath, JSON.stringify({ binding, results: [branchResult] }, null, 2) + '\n');
  await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n');
  await writeFile(managedEvidencePath, await readFile(evidencePath));
  const finalEvidenceBytes = await readFile(managedEvidencePath);
  const finalDigest = createHash('sha256').update(finalEvidenceBytes).digest('hex');
  branchResult.evidence.forEach(item => { item.sha256 = finalDigest; });
  await writeFile(resultsPath, JSON.stringify({ binding, results: [branchResult] }, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(result) + '\n');
if (result.verdict !== 'passed-safety-with-expected-interruption') process.exitCode = 1;
