import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.AC05_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.AC05_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const session = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(session.status, 200);
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
const env = await api('/api/environment');
assert.equal(env.canRun, true, 'RUNTIME_NOT_READY_FOR_LIVE_RAIL_TEST');
const draft = await api('/api/drafts', 'POST', { name: `ac05-two-rails-${randomUUID().slice(0, 8)}`, brief: {
  audience: { value: 'Agent 平台测试人员', source: 'user', confirmed: true },
  goal: { value: '读取设备状态并遵守审计与工具白名单', source: 'user', confirmed: true },
  output: { value: '设备状态、温度和来源', source: 'user', confirmed: true }
} });
const railIds = ['audit@1', 'tool-allowlist@1'];
const toolId = 'equipment-status@1';
const runtimeRailNames = ['audit', 'tool-allowlist'];
const snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly: {
  agentType: 'DeepAgent', systemPrompt: '你是设备状态查询助手。对用户给出的设备编号调用 get_equipment 一次，然后准确返回设备编号、状态、温度和来源。不得重复调用、不得编造。',
  maxIterations: 4, railIds, toolIds: [toolId]
} });
assert.deepEqual(snapshot.content.assembly.railIds, railIds, 'VERSIONED_RAILS_NOT_BOUND_TO_SNAPSHOT');
assert.ok(runtimeRailNames.every(name => snapshot.content.runtimeSpec.agent.rails.includes(name)), 'RUNTIME_RAILS_NOT_LOADED');
const run = await api(`/api/snapshots/${snapshot.id}/runs`, 'POST', { clientRequestId: randomUUID(), input: '请查询 PUMP-001 的状态、温度和来源。' });
const deadline = Date.now() + 180000;
let finalRun = run;
while (Date.now() < deadline && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(finalRun.status)) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  finalRun = await api(`/api/runs/${run.id}`);
}
assert.equal(finalRun.status, 'succeeded', `RUN_FAILED:${finalRun.status}:${finalRun.diagnostic ?? ''}`);
const events = (await api(`/api/runs/${run.id}/events`)).items;
const runtimeEvents = events.filter(item => item.type === 'runtime.event').map(item => item.data.event);
const auditBeforeTool = runtimeEvents.some(event => event.rail === 'audit' && event.event === 'before_tool_call' && event.tool === 'get_equipment');
const allowlistAllowed = runtimeEvents.some(event => event.rail === 'tool-allowlist' && event.event === 'before_tool_call' && event.tool === 'get_equipment' && event.allowed === true);
assert.ok(auditBeforeTool, 'AUDIT_RAIL_NOT_TRIGGERED');
assert.ok(allowlistAllowed, 'ALLOWLIST_RAIL_NOT_TRIGGERED');
const mockScript = `const r=await fetch('http://127.0.0.1:8082/control/environments/${finalRun.environmentId}/calls?runId=${run.id}',{headers:{authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN}});if(!r.ok)throw new Error('MOCK_EVIDENCE_UNAVAILABLE');const x=await r.json();console.log(JSON.stringify(x.items.map(v=>({operation:v.operation,input:v.input,status:v.status}))))`;
const mockCalls = JSON.parse(execFileSync('docker', ['compose', '-p', project, 'exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', mockScript], { encoding: 'utf8', windowsHide: true }));
assert.equal(mockCalls.length, 1, 'EXPECTED_EXACTLY_ONE_MOCK_QUERY');
assert.equal(mockCalls[0].operation, 'equipment-status');
assert.equal(mockCalls[0].input.equipmentId, 'PUMP-001');
assert.equal(mockCalls[0].status, 200);
const containers = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length, 2);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
const result = { schemaVersion: 1, requirement: 'TD-15/AC-05 load and trigger two Rails in a live DeepAgent Run', executionMode: 'isolated-live-docker',
  measuredAt: new Date().toISOString(), composeProject: project, draftId: draft.id, snapshotId: snapshot.id, runId: run.id, runStatus: finalRun.status,
  agentType: snapshot.content.assembly.agentType, railIds, runtimeRailNames: snapshot.content.runtimeSpec.agent.rails, toolId,
  railsLoaded: railIds.every(id => snapshot.content.assembly.railIds.includes(id)) && runtimeRailNames.every(name => snapshot.content.runtimeSpec.agent.rails.includes(name)), auditBeforeTool, allowlistAllowed,
  mockCalls, runtimeEventCount: runtimeEvents.length, targetImageIds, verdict: 'passed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-AC05-two-rails-live.json', JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: writeHeaders }).catch(() => {});
