import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080';
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true });
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
const containers = compose('ps', '-q', 'app', 'runner').trim().split(/\r?\n/).filter(Boolean);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(targetImageIds, active.targetImageIds, 'AC42A_TARGET_CHANGED');
const response = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(response.status, 200, 'AC42A_LOGIN_FAILED');
const cookie = response.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const session = await response.json();
assert.ok(cookie && session.csrfToken);
const readHeaders = { origin, cookie };
const writeHeaders = { ...readHeaders, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' };
try {
  const environmentResponse = await fetch(`${base}/api/environment`, { headers: readHeaders });
  assert.equal(environmentResponse.status, 200);
  const environment = await environmentResponse.json();
  assert.equal(environment.executionMode, 'trusted-local');
  assert.equal(environment.sandboxEnabled, false);
  const rejected = await fetch(`${base}/api/connection-bindings`, { method: 'POST', headers: writeHeaders, body: JSON.stringify({ kind: 'production', profile: 'production-bank@1' }) });
  const rejection = await rejected.json();
  assert.equal(rejected.status, 422);
  assert.equal(rejection.code, 'CONNECTION_TYPE_NOT_ALLOWED');
  const result = {
    schemaVersion: 1, requirement: 'TD-15 P0-A AC-42a trusted-local disclosure and production connection denial', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project,
    targetImageIds, appImageId: targetImageIds[0], runnerImageId: targetImageIds[1], validationId: active.validationId, candidateId: active.candidateId,
    observed: { executionMode: environment.executionMode, sandboxEnabled: environment.sandboxEnabled, productionConnectionHttpStatus: rejected.status, productionConnectionCode: rejection.code },
    branches: [
      { caseId: 'AC-42a', branchId: 'trusted-local-visible', status: 'passed', assertions: [{ name: 'runtime_mode_and_sandbox_boundary_visible', passed: environment.executionMode === 'trusted-local' && environment.sandboxEnabled === false }] },
      { caseId: 'AC-42a', branchId: 'production-connection-denied', status: 'passed', assertions: [{ name: 'production_connection_rejected_without_registration', passed: rejected.status === 422 && rejection.code === 'CONNECTION_TYPE_NOT_ALLOWED' }] }
    ]
  };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC42a-trusted-local-live.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: 'passed', ...result.observed }));
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: writeHeaders }).catch(() => {});
}
