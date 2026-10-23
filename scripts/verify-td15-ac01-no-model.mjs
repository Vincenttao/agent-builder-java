import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.AC01_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.AC01_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const project = process.env.AC01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const sessionResponse = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(sessionResponse.status, 200);
const cookie = sessionResponse.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const { csrfToken } = await sessionResponse.json();
assert.ok(cookie && csrfToken);
const headers = { origin, cookie };
const writeHeaders = { ...headers, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };
async function get(path) { const response = await fetch(`${base}${path}`, { headers }); assert.equal(response.status, 200, `GET_${path}_${response.status}`); return response.json(); }
const env = await get('/api/environment');
assert.equal(env.model, 'not_configured', 'MODEL_MUST_BE_UNCONFIGURED');
assert.equal(env.canSaveDraft, true, 'DRAFT_SAVE_MUST_REMAIN_AVAILABLE');
assert.equal(env.canRun, false, 'RUN_MUST_BE_BLOCKED');
assert.ok(env.blockers.some(item => item.code === 'MODEL_NOT_CONFIGURED'));
const draftInput = { name: `ac01-no-model-${randomUUID().slice(0, 8)}`, brief: {
  audience: { value: '银行 AI 平台开发人员', source: 'user', confirmed: true },
  goal: { value: '查询设备状态，不执行写操作', source: 'user', confirmed: true },
  output: { value: '设备状态和数据来源', source: 'user', confirmed: true }
} };
const createdResponse = await fetch(`${base}/api/drafts`, { method: 'POST', headers: writeHeaders, body: JSON.stringify(draftInput) });
assert.equal(createdResponse.status, 201);
const draft = await createdResponse.json();
assert.deepEqual(await get(`/api/drafts/${draft.id}`), draft, 'DRAFT_NOT_PERSISTED');
const assembly = { agentType: 'DeepAgent', systemPrompt: '查询设备状态；缺少编号时先追问。', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
const snapshotResponse = await fetch(`${base}/api/drafts/${draft.id}/snapshots`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ expectedRevision: 1, assembly }) });
assert.equal(snapshotResponse.status, 201);
const snapshot = await snapshotResponse.json();
const runResponse = await fetch(`${base}/api/snapshots/${snapshot.id}/runs`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ clientRequestId: randomUUID(), input: '请查询 PUMP-001 的状态。' }) });
assert.equal(runResponse.status, 409);
const runError = await runResponse.json();
assert.equal(runError.code, 'ENVIRONMENT_BLOCKED');
const containerIds = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containerIds.length, 2);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containerIds], { encoding: 'utf8' }).trim().split(/\r?\n/);
const result = { schemaVersion: 1, requirement: 'TD-15/AC-01 Save and block Run without model connection', executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(), composeProject: project,
  model: env.model, canSaveDraft: env.canSaveDraft, canRun: env.canRun, blockerCodes: env.blockers.map(item => item.code), draftId: draft.id, draftPersisted: true, snapshotId: snapshot.id,
  runAttemptHttpStatus: runResponse.status, runAttemptCode: runError.code, targetImageIds, verdict: 'passed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-AC01-no-model.json', JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
