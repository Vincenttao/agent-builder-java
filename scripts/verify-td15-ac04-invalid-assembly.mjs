import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.AC04_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.AC04_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const { csrfToken } = await login.json();
assert.ok(cookie && csrfToken);
const headers = { origin, cookie };
const writeHeaders = { ...headers, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
async function get(path) { const response = await fetch(`${base}${path}`, { headers }); assert.equal(response.status, 200); return response.json(); }
const draftInput = { name: `ac04-invalid-assembly-${randomUUID().slice(0, 8)}`, brief: {
  audience: { value: '银行 AI 平台开发人员', source: 'user', confirmed: true },
  goal: { value: '只读查询设备状态', source: 'user', confirmed: true },
  output: { value: '设备状态和来源', source: 'user', confirmed: true }
} };
const create = await fetch(`${base}/api/drafts`, { method: 'POST', headers: writeHeaders, body: JSON.stringify(draftInput) });
assert.equal(create.status, 201);
const draft = await create.json();
const validAssembly = { agentType: 'DeepAgent', systemPrompt: '根据设备工具事实回答；缺少设备编号时先追问。', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
async function attempt(assembly) {
  const response = await fetch(`${base}/api/drafts/${draft.id}/snapshots`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ expectedRevision: draft.revision, assembly }) });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.code, 'INVALID_ASSEMBLY');
  return body.details?.reasons ?? [];
}
const unknownToolReasons = await attempt({ ...validAssembly, toolIds: ['unknown-business-tool@1'] });
assert.ok(unknownToolReasons.includes('UNKNOWN_TOOL:unknown-business-tool@1'));
const invalidRailId = 'tool-call-limit@1:0';
const invalidRailReasons = await attempt({ ...validAssembly, railIds: [...validAssembly.railIds, invalidRailId] });
assert.ok(invalidRailReasons.includes(`UNKNOWN_RAIL:${invalidRailId}`));
const draftAfter = await get(`/api/drafts/${draft.id}`);
const snapshotList = await get(`/api/drafts/${draft.id}/snapshots`);
assert.deepEqual(draftAfter, draft, 'INVALID_ASSEMBLY_MUTATED_DRAFT');
assert.equal(snapshotList.items.length, 0, 'INVALID_ASSEMBLY_CREATED_SNAPSHOT');
const containerIds = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containerIds.length, 2);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containerIds], { encoding: 'utf8' }).trim().split(/\r?\n/);
const result = { schemaVersion: 1, requirement: 'TD-15/AC-04 reject unknown Tool and invalid Rail parameter without applying changes',
  executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(), composeProject: project, draftId: draft.id,
  unknownToolRejected: true, unknownToolReasons, invalidRailRejected: true, invalidRailId, invalidRailReasons,
  draftUnchanged: true, snapshotCountAfterRejectedChanges: snapshotList.items.length, targetImageIds, verdict: 'passed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-AC04-invalid-assembly.json', JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
