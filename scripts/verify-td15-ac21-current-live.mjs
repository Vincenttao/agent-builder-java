import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = (process.env.AC21_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.AC21_ORIGIN ?? 'http://127.0.0.1:8080';
const project = process.env.AC21_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const source = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-two-sessions.json', 'utf8'));
const containers = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds = containers.map(id => execFileSync('docker', ['inspect', '--format', '{{.Image}}', id], { encoding: 'utf8' }).trim());
assert.deepEqual(source.targetImageIds, targetImageIds, 'EVIDENCE_TARGET_IMAGE_CHANGED');
const tokenLine = (await readFile('.env.local', 'utf8')).split(/\r?\n/).find(line => line.startsWith('LOCAL_BOOTSTRAP_TOKEN='));
const token = tokenLine?.slice('LOCAL_BOOTSTRAP_TOKEN='.length).replace(/^['"]|['"]$/g, '');
assert.ok(token, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
assert.equal(login.status, 200, 'LOGIN_FAILED');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf, 'LOGIN_RESPONSE_INVALID');
let result;
try {
  const headers = { cookie };
  const get = async path => {
    const response = await fetch(`${base}${path}`, { headers });
    const value = await response.json();
    assert.ok(response.ok, `HTTP_${response.status}:${path}`);
    return value;
  };
  const [job, snapshot, eventsResponse] = await Promise.all([
    get(`/api/development/${source.developmentJobId}`), get(`/api/snapshots/${source.snapshotId}`),
    get(`/api/development/${source.developmentJobId}/events`)
  ]);
  const baseline = await get(`/api/baselines/${job.baselineId}`);
  const roles = job.roles ?? [];
  const tester = roles.find(item => item.role === 'tester');
  const developer = roles.find(item => item.role === 'developer');
  const independentRoles = Boolean(tester?.sessionId && developer?.sessionId && tester.sessionId !== developer.sessionId
    && tester.status === 'completed' && developer.status === 'completed');
  const sharedConfirmedBaseline = job.baselineId === baseline.id && snapshot.draftId === job.agentId
    && baseline.draftId === job.agentId && Boolean(baseline.confirmedAt);
  assert.ok(independentRoles, 'GENERATION_ROLES_NOT_INDEPENDENT');
  assert.ok(sharedConfirmedBaseline, 'GENERATION_BASELINE_NOT_SHARED_AND_CONFIRMED');
  assert.equal(job.status, 'built', 'GENERATION_JOB_NOT_BUILT');
  const events = eventsResponse.items ?? [];
  result = {
    schemaVersion: 1,
    requirement: 'TD-15 P0-B AC-21 independent Tester and Developer roles share a confirmed baseline',
    executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project,
    targetImageIds, draftId: job.agentId, snapshotId: snapshot.id, baselineId: baseline.id,
    baselineDigest: baseline.digest, developmentJobId: job.id, jobStatus: job.status,
    roles: roles.map(({ role, sessionId, status }) => ({ role, sessionId, status })),
    eventCount: events.length,
    branches: [
      { caseId: 'AC-21', branchId: 'independent-role-records', status: 'passed', assertions: [{ name: 'tester_and_developer_have_distinct_completed_sessions', passed: independentRoles }] },
      { caseId: 'AC-21', branchId: 'shared-confirmed-baseline', status: 'passed', assertions: [{ name: 'both_roles_use_one_confirmed_baseline', passed: sharedConfirmedBaseline }] }
    ], verdict: 'passed'
  };
} catch (error) {
  result = { schemaVersion: 1, requirement: 'TD-15 P0-B AC-21 independent Tester and Developer roles share a confirmed baseline', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds, verdict: 'failed', failure: String(error?.stack ?? error) };
  throw error;
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
  if (result) {
    await mkdir('docs/implementation/evidence', { recursive: true });
    await writeFile('docs/implementation/evidence/TD15-AC21-current-live.json', JSON.stringify(result, null, 2) + '\n');
  }
}
process.stdout.write(JSON.stringify({ verdict: result.verdict, branches: result.branches.map(item => item.branchId), developmentJobId: result.developmentJobId }) + '\n');
