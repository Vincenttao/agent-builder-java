import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.AC07_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.AC07_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const session = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(session.status, 200, 'LOCAL_AUTH_REQUIRED');
const cookie = session.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const { csrfToken } = await session.json();
assert.ok(cookie && csrfToken);
const readHeaders = { origin, cookie };
const writeHeaders = { ...readHeaders, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? readHeaders : writeHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${value.code ?? path}`);
  return value;
}
async function runUntilDone(run) {
  const deadline = Date.now() + 180000;
  let current = run;
  while (Date.now() < deadline && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(current.status)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    current = await api(`/api/runs/${run.id}`);
  }
  assert.equal(current.status, 'succeeded', `RUN_FAILED:${current.status}:${current.diagnostic ?? ''}`);
  return current;
}
function targetImageIds() {
  const containers = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(containers.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
  return execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
}
async function mockCalls(environmentId, runId) {
  const script = `const r=await fetch('http://127.0.0.1:8082/control/environments/${environmentId}/calls?runId=${runId}',{headers:{authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN}});if(!r.ok)throw new Error('MOCK_EVIDENCE_UNAVAILABLE');const x=await r.json();console.log(JSON.stringify(x.items.map(v=>({operation:v.operation,input:v.input,status:v.status,result:v.result,actorId:v.actorId,runId:v.runId}))))`;
  return JSON.parse(execFileSync('docker', ['compose', '-p', project, 'exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true }));
}
async function executeTool(snapshotId, toolName, input) {
  const started = Date.now();
  const run = await api(`/api/snapshots/${snapshotId}/runs`, 'POST', { clientRequestId: randomUUID(), input });
  const finalRun = await runUntilDone(run);
  const events = (await api(`/api/runs/${run.id}/events`)).items;
  const runtimeEvents = events.filter(item => item.type === 'runtime.event').map(item => item.data.event);
  const mock = await mockCalls(finalRun.environmentId, run.id);
  assert.equal(mock.length, 1, `${toolName}_EXPECTED_ONE_EXTERNAL_CALL`);
  assert.equal(mock[0].operation, 'equipment-status');
  assert.equal(mock[0].input.equipmentId, 'PUMP-001');
  assert.equal(mock[0].status, 200);
  assert.equal(mock[0].runId, run.id);
  return { runId: run.id, environmentId: finalRun.environmentId, runStatus: finalRun.status, runDurationMs: Date.now() - started,
    runtimeEvents, mockCalls: mock };
}

try {
  const environment = await api('/api/environment');
  assert.equal(environment.canRun, true, 'RUNTIME_NOT_READY_FOR_AC07');
  const draft = await api('/api/drafts', 'POST', { name: `ac07-two-protocols-${randomUUID().slice(0, 8)}`, brief: {
    audience: { value: '企业 Agent 平台测试人员', source: 'user', confirmed: true },
    goal: { value: '分别通过 HTTP 和 MCP 只读查询设备状态', source: 'user', confirmed: true },
    output: { value: '设备编号、状态、温度和数据来源', source: 'user', confirmed: true }
  } });
  const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly: {
    agentType: 'DeepAgent', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'],
    toolIds: ['equipment-status@1', 'equipment-status-mcp@1'],
    systemPrompt: '你是只读设备查询助手。用户明确要求使用 HTTP 时，只能调用 get_equipment；用户明确要求使用 MCP 时，只能调用 get_equipment_mcp。每次只调用指定工具一次，并如实返回设备编号、状态、温度和来源。不得混用工具或编造结果。'
  } });
  const httpBinding = snapshot.content.runtimeSpec.tools.find(tool => tool.protocol === 'http');
  const mcpBinding = snapshot.content.runtimeSpec.tools.find(tool => tool.protocol === 'mcp');
  assert.deepEqual([httpBinding?.connectionRef, httpBinding?.toolVersion], ['enterprise-mock-http@1', 'equipment-status-http@1']);
  assert.deepEqual([mcpBinding?.connectionRef, mcpBinding?.toolVersion, mcpBinding?.remoteToolName], ['enterprise-mock-mcp@1', 'equipment-status-mcp@1', 'equipment_status']);

  const http = await executeTool(snapshot.id, 'http-tool', '请使用 HTTP 工具 get_equipment 查询 PUMP-001，其他工具都不要调用。');
  const httpCall = http.runtimeEvents.find(event => event.event === 'tool_call' && event.protocol === 'http' && event.tool === 'get_equipment');
  assert.ok(httpCall, 'HTTP_EXECUTION_EVIDENCE_MISSING');
  assert.equal(httpCall.connectionRef, 'enterprise-mock-http@1'); assert.equal(httpCall.toolVersion, 'equipment-status-http@1');
  assert.equal(httpCall.status, 'succeeded'); assert.equal(typeof httpCall.parameterDigest, 'string'); assert.equal(typeof httpCall.resultDigest, 'string'); assert.equal(typeof httpCall.durationMs, 'number');

  const mcp = await executeTool(snapshot.id, 'mcp-tool', '请使用 MCP 工具 get_equipment_mcp 查询 PUMP-001，其他工具都不要调用。');
  const mcpCall = mcp.runtimeEvents.find(event => event.event === 'mcp_tool_call' && event.protocol === 'mcp' && event.tool === 'get_equipment_mcp');
  assert.ok(mcpCall, 'MCP_EXECUTION_EVIDENCE_MISSING');
  assert.equal(mcpCall.connectionRef, 'enterprise-mock-mcp@1'); assert.equal(mcpCall.toolVersion, 'equipment-status-mcp@1');
  assert.equal(mcpCall.serverName, 'agent-builder-mock'); assert.equal(mcpCall.serverVersion, '1.0.0');
  assert.equal(mcpCall.status, 'succeeded'); assert.equal(typeof mcpCall.parameterDigest, 'string'); assert.equal(typeof mcpCall.resultDigest, 'string'); assert.equal(typeof mcpCall.durationMs, 'number');

  const result = { schemaVersion: 1, requirement: 'TD-15/AC-07 real HTTP and MCP Tool calls against the same versioned Mock equipment service',
    executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(), composeProject: project, draftId: draft.id, snapshotId: snapshot.id,
    snapshotToolBindings: snapshot.content.runtimeSpec.tools.map(({ name, operationId, protocol, connectionRef, toolVersion, remoteToolName }) => ({ name, operationId, protocol, connectionRef, toolVersion, ...(remoteToolName ? { remoteToolName } : {}) })),
    http: { ...http, httpCall }, mcp: { ...mcp, mcpCall }, targetImageIds: targetImageIds(), verdict: 'passed' };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC07-http-mcp-live.json', JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result) + '\n');
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: writeHeaders }).catch(() => {});
}
