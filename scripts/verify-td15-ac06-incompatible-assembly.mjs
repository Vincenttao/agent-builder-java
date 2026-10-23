import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.AC06_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.AC06_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const { csrfToken } = await login.json();
assert.ok(cookie && csrfToken);
const headers = { origin, cookie };
const writeHeaders = { ...headers, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
async function get(path) { const response = await fetch(`${base}${path}`, { headers }); assert.equal(response.status, 200); return response.json(); }
const create = await fetch(`${base}/api/drafts`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ name: `ac06-invalid-combo-${randomUUID().slice(0, 8)}`, brief: {
  audience: { value: 'Agent 平台开发人员', source: 'user', confirmed: true },
  goal: { value: '设备只读查询', source: 'user', confirmed: true },
  output: { value: '设备状态和来源', source: 'user', confirmed: true }
} }) });
assert.equal(create.status, 201);
const draft = await create.json();
const assembly = { agentType: 'DeepAgent', systemPrompt: '查询设备状态并依据事实回答。', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
async function rejected(value) {
  const response = await fetch(`${base}/api/drafts/${draft.id}/snapshots`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ expectedRevision: draft.revision, assembly: value }) });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.code, 'INVALID_ASSEMBLY');
  return body.details?.reasons ?? [];
}
const conflictingRails = ['audit@1', 'audit@1', 'tool-allowlist@1'];
const railReasons = await rejected({ ...assembly, railIds: conflictingRails });
assert.ok(railReasons.includes('CONFLICTING_RAILS'));
const unsupportedAgentType = 'ReAct';
const typeReasons = await rejected({ ...assembly, agentType: unsupportedAgentType });
assert.ok(typeReasons.includes('UNSUPPORTED_AGENT_TYPE'));
const [draftAfter, snapshots] = await Promise.all([get(`/api/drafts/${draft.id}`), get(`/api/drafts/${draft.id}/snapshots`)]);
assert.deepEqual(draftAfter, draft, 'INVALID_COMBINATION_MUTATED_DRAFT');
assert.equal(snapshots.items.length, 0, 'INVALID_COMBINATION_CREATED_SNAPSHOT');
const containerIds = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containerIds.length, 2);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containerIds], { encoding: 'utf8' }).trim().split(/\r?\n/);
const result = { schemaVersion: 1, requirement: 'TD-15/AC-06 reject conflicting Rails and unsupported Agent types', executionMode: 'isolated-live-docker',
  measuredAt: new Date().toISOString(), composeProject: project, draftId: draft.id, conflictingRails, conflictingRailReasons: railReasons,
  unsupportedAgentType, unsupportedAgentReasons: typeReasons, draftUnchanged: true, snapshotCountAfterRejectedChanges: snapshots.items.length,
  targetImageIds, verdict: 'passed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-AC06-incompatible-assembly.json', JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
