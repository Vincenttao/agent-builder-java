import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = (process.env.NF04_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const origin = process.env.NF04_ORIGIN ?? process.env.APP_ORIGIN ?? base;
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf);
const headers = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
const readHeaders = { cookie };
const errors = {};
async function capture(name, response, expectedStatus, expectedCode) {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, `${name}: unexpected status`);
  assert.equal(body.code, expectedCode, `${name}: unexpected error category`);
  errors[name] = { status: response.status, code: body.code, correlationIdPresent: typeof body.correlationId === 'string' };
}

const brief = Object.fromEntries(['audience', 'goal', 'output'].map(key => [key, { value: `NF-04 error classification ${key}`, source: 'user', confirmed: false }]));
const draftResponse = await fetch(`${base}/api/drafts`, { method: 'POST', headers, body: JSON.stringify({ name: `nf04-classification-${randomUUID()}`, brief }) });
assert.equal(draftResponse.status, 201);
const draft = await draftResponse.json();
const assembly = { agentType: 'DeepAgent', systemPrompt: '只查询设备。', maxIterations: 1, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
await capture('requirements', await fetch(`${base}/api/drafts/${draft.id}/snapshots`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 1, assembly }) }), 422, 'BRIEF_NOT_CONFIRMED');

const confirmedBrief = Object.fromEntries(Object.entries(brief).map(([key, value]) => [key, { ...value, confirmed: true }]));
const updated = await fetch(`${base}/api/drafts/${draft.id}`, { method: 'PUT', headers, body: JSON.stringify({ name: draft.name, brief: confirmedBrief, expectedRevision: 1 }) });
assert.equal(updated.status, 200);
await capture('assembly', await fetch(`${base}/api/drafts/${draft.id}/snapshots`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 2, assembly: { ...assembly, railIds: ['audit@1', 'tool-allowlist@1', 'unknown-rail@1'] } }) }), 422, 'INVALID_ASSEMBLY');
await capture('connection', await fetch(`${base}/api/connection-bindings`, { method: 'POST', headers, body: JSON.stringify({ kind: 'http', profile: 'nf04-unregistered-connection' }) }), 422, 'CONNECTION_TYPE_NOT_ALLOWED');

const timeoutEvidence = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF04-budget-live.json', 'utf8'));
assert.equal(timeoutEvidence.diagnostic, 'ENGINEERING_BUDGET_EXCEEDED');
errors.runtime = { status: timeoutEvidence.finalStatus, code: timeoutEvidence.diagnostic, correlationIdPresent: false, reference: 'TD15-NF04-budget-live.json' };
const report = { schemaVersion: 1, requirement: 'TD-15/NF-04 error classification', executionMode: process.env.NF04_COMPOSE_PROJECT ? 'isolated-live-docker' : 'live-platform', baseUrl: base, composeProject: process.env.NF04_COMPOSE_PROJECT ?? null, measuredAt: new Date().toISOString(), draftId: draft.id, errors,
  categoriesDistinct: new Set([errors.requirements.code, errors.assembly.code, errors.connection.code, errors.runtime.code]).size === 4, verdict: new Set([errors.requirements.code, errors.assembly.code, errors.connection.code, errors.runtime.code]).size === 4 ? 'passed' : 'failed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF04-errors-live.json', JSON.stringify(report, null, 2) + '\n');
await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } });
process.stdout.write(JSON.stringify(report) + '\n');
if (report.verdict !== 'passed') process.exitCode = 1;
