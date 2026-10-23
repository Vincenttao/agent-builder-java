import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = (process.env.TD15_ACCEPTANCE_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.TD15_ACCEPTANCE_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const envText = await readFile('.env.local', 'utf8');
const envValue = key => envText.split(/\r?\n/).find(line => line.startsWith(`${key}=`))?.slice(key.length + 1).replace(/^['"]|['"]$/g, '');
const token = process.env.LOCAL_BOOTSTRAP_TOKEN ?? envValue('LOCAL_BOOTSTRAP_TOKEN');
assert.ok(token, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).trim();
const containers = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
assert.equal(containers.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
assert.equal(login.status, 200, 'LOCAL_LOGIN_FAILED');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const { csrfToken } = await login.json();
assert.ok(cookie && csrfToken);
const readHeaders = { origin, cookie };
const writeHeaders = { ...readHeaders, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? readHeaders : writeHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = await response.json().catch(() => null);
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${value?.code ?? path}`);
  return value;
}
async function mockCalls(environmentId, runId) {
  const js = `const r=await fetch('http://127.0.0.1:8082/control/environments/${environmentId}/calls?runId=${runId}',{headers:{authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN}});if(!r.ok)throw new Error('MOCK_EVIDENCE_UNAVAILABLE');const x=await r.json();console.log(JSON.stringify(x.items.map(v=>({operation:v.operation,input:v.input,status:v.status,result:v.result,actorId:v.actorId,runId:v.runId}))))`;
  return JSON.parse(compose('exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', js));
}
let evidence;
try {
  const environment = await api('/api/environment');
  assert.equal(environment.canRun, true, 'RUNTIME_NOT_READY');
  const draft = await api('/api/drafts', 'POST', { name: `eq01-empty-retrieval-${randomUUID().slice(0, 8)}`, brief: {
    audience: { value: '设备维护人员', source: 'user', confirmed: true },
    goal: { value: '按设备编号检索维护资料', source: 'user', confirmed: true },
    output: { value: '资料检索结果；无结果时说明依据不足，不给出无依据的维修结论', source: 'user', confirmed: true }
  } });
  const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly: {
    agentType: 'DeepAgent', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['maintenance-search@1'],
    systemPrompt: '你是设备维护资料检索助手。用户给出设备编号后，必须且只能调用 search_maintenance_manuals 一次。严格依据工具返回结果回答。found=false 或 resultCount=0 时，输出且只输出 JSON：{"kind":"evidence-insufficient","equipmentId":"工具返回的编号","message":"明确说明没有检索到维护资料，依据不足，不能据此判断故障原因或维修结论。","sources":[],"repairDiagnosis":null}。不得添加来源、资料编号、引用或声称已经诊断、维修、完成维修判断。工具失败时说明检索不可用，不编造结果。'
  } });
  const started = await api(`/api/snapshots/${snapshot.id}/runs`, 'POST', { clientRequestId: randomUUID(), input: '请查询 PUMP-001 的维护资料，并告诉我是否已经可以判断维修方案。' });
  let run = started; const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)) {
    await new Promise(resolve => setTimeout(resolve, 750)); run = await api(`/api/runs/${started.id}`);
  }
  assert.equal(run.status, 'succeeded', `RUN_NOT_SUCCEEDED:${run.status}:${run.diagnostic ?? ''}`);
  const events = (await api(`/api/runs/${run.id}/events`)).items.filter(item => item.type === 'runtime.event').map(item => item.data.event);
  const outputText = run.result?.result?.content;
  assert.equal(typeof outputText, 'string', 'MODEL_OUTPUT_MISSING');
  const answer = JSON.parse(outputText.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, '$1'));
  const calls = await mockCalls(run.environmentId, run.id);
  assert.equal(calls.length, 1, 'EXPECTED_ONE_MAINTENANCE_SEARCH');
  assert.deepEqual(calls[0], { operation: 'maintenance-search', input: { equipmentId: 'PUMP-001' }, status: 200,
    result: { equipmentId: 'PUMP-001', found: false, resultCount: 0 }, actorId: 'U1001', runId: run.id });
  assert.ok(events.some(event => event.event === 'tool_call' && event.tool === 'search_maintenance_manuals' && event.status === 'succeeded'), 'TOOL_EXECUTION_EVENT_MISSING');
  assert.deepEqual(Object.keys(answer).sort(), ['equipmentId','kind','message','repairDiagnosis','sources'].sort(), 'UNEXPECTED_OR_UNVERIFIABLE_OUTPUT_FIELDS');
  assert.equal(answer.kind, 'evidence-insufficient');
  assert.equal(answer.equipmentId, 'PUMP-001');
  assert.match(answer.message, /依据不足|没有检索到|未检索到/);
  assert.deepEqual(answer.sources, []);
  assert.equal(answer.repairDiagnosis, null);
  assert.doesNotMatch(answer.message, /已维修|已完成维修|已完成诊断|已完成维修判断/);
  evidence = { schemaVersion: 1, requirement: 'TD-15 P0-A EQ-01 empty maintenance retrieval must not fabricate sources or repair conclusions', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds,
    draftId: draft.id, snapshotId: snapshot.id, runId: run.id, environmentId: run.environmentId, runStatus: run.status, runtimeEvents: events, mockCalls: calls, answer,
    branches: [{ caseId: 'EQ-01', branchId: 'empty-retrieval', status: 'passed', assertions: [
      { name: 'real_empty_retrieval_call', passed: calls.length === 1 && calls[0].result.found === false && calls[0].result.resultCount === 0 },
      { name: 'no_fabricated_source', passed: Array.isArray(answer.sources) && answer.sources.length === 0 },
      { name: 'no_unfounded_repair_conclusion', passed: answer.repairDiagnosis === null && !/已维修|已完成维修|已完成诊断|已完成维修判断/.test(answer.message) }
    ] }], verdict: 'passed' };
} catch (error) {
  evidence = { schemaVersion: 1, requirement: 'TD-15 P0-A EQ-01 empty maintenance retrieval must not fabricate sources or repair conclusions', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds, verdict: 'failed', failure: String(error?.stack ?? error) };
  throw error;
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: readHeaders }).catch(() => {});
  if (evidence) { await mkdir('docs/implementation/evidence', { recursive: true }); await writeFile('docs/implementation/evidence/TD15-EQ01-empty-retrieval-live.json', JSON.stringify(evidence, null, 2) + '\n'); }
}
process.stdout.write(JSON.stringify({ verdict: evidence.verdict, runId: evidence.runId, answer: evidence.answer }) + '\n');
