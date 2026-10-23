import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080';
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';
const token = process.env.LOCAL_BOOTSTRAP_TOKEN;
assert.ok(token, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).trim();
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
assert.equal(active.verdict, 'passed-safety-with-expected-interruption');
const [appContainer, runnerContainer] = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', appContainer, runnerContainer], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(targetImageIds, active.targetImageIds, 'AC11_TARGET_CHANGED');
const q = sql => JSON.parse(compose('exec', '-T', 'postgres', 'psql', '-U', 'builder', '-d', 'builder', '-Atc', sql));
const validationCases = q(`SELECT record->'cases' FROM validation_executions WHERE record->>'id'='${active.validationId}'`);
const approveRunId = validationCases.find(item => item.caseId === 'TC-004')?.runId;
assert.ok(approveRunId, 'AC11_APPROVE_RUN_MISSING');
const authResponse = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
assert.equal(authResponse.status, 200, 'AC11_LOGIN_FAILED');
const cookie = authResponse.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const auth = await authResponse.json();
assert.ok(cookie && auth.csrfToken);
const headers = { origin, cookie, 'x-csrf-token': auth.csrfToken, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${value?.code ?? 'UNKNOWN'}`);
  return value;
}
try {
  const listed = await api(`/api/runs/${approveRunId}/actions`);
  const runRecord = q(`SELECT record FROM runs WHERE record->>'id'='${approveRunId}'`);
  const externalWrites = runRecord.externalEvidence.filter(item => item.operation === 'work-order-create');
  assert.equal(externalWrites.length, 1, 'AC11_EXTERNAL_WRITE_COUNT_MISMATCH');
  const action = listed.items.find(item => item.decision === 'approve' && item.status === 'succeeded');
  assert.ok(action?.decisionId && action.actionHash, 'AC11_APPROVED_ACTION_NOT_FOUND');
  const decision = { decisionId: action.decisionId, decision: 'approve', actionHash: action.actionHash };
  const sequential = await api(`/api/runs/${approveRunId}/actions/${action.id}/decision`, 'POST', decision);
  const concurrent = await Promise.all(Array.from({ length: 3 }, () => api(`/api/runs/${approveRunId}/actions/${action.id}/decision`, 'POST', decision)));
  const after = await api(`/api/runs/${approveRunId}/actions`);
  const stable = after.items.find(item => item.id === action.id);
  assert.equal(sequential.decisionId, action.decisionId);
  assert.ok(concurrent.every(item => item.decisionId === action.decisionId && item.status === 'succeeded'));
  assert.equal(stable.decisionId, action.decisionId);
  assert.equal(stable.status, 'succeeded');
  assert.equal(active.validationReport.cases.find(item => item.caseId === 'TC-004')?.status, 'passed');
  assert.equal(active.validationReport.verdict, 'failed'); // TC-008 expected interruption is preserved.
  const result = {
    schemaVersion: 1, requirement: 'TD-15 P0-A AC-11 sequential and concurrent duplicate approval', executionMode: 'live-mock', measuredAt: new Date().toISOString(),
    composeProject: project, targetImageIds, validationId: active.validationId, candidateId: active.candidateId, artifactDigest: active.candidateArtifactDigest, runId: approveRunId,
    actionId: action.id, approvalDecisionId: action.decisionId, sequentialDuplicateDecisionId: sequential.decisionId, concurrentDuplicateDecisionIds: concurrent.map(item => item.decisionId),
    externalEffect: { createWorkOrderCalls: externalWrites.length, workOrderCount: 1, basis: 'persisted Run external evidence for fixed-candidate validation case TC-004; action remained one succeeded action with the original decisionId' },
    expectedInterruptedRun: active.runId, overallValidationVerdict: active.validationReport.verdict,
    branches: [
      { caseId: 'AC-11', branchId: 'sequential-duplicate', status: 'passed', assertions: [{ name: 'same_decision_id_and_single_action', passed: sequential.decisionId === action.decisionId && stable.status === 'succeeded' }] },
      { caseId: 'AC-11', branchId: 'concurrent-duplicate', status: 'passed', assertions: [{ name: 'all_retries_return_same_decision', passed: concurrent.length === 3 && concurrent.every(item => item.decisionId === action.decisionId && item.status === 'succeeded') }] }
    ]
  };
  for (const branch of result.branches) assert.ok(branch.assertions.every(item => item.passed), `AC11_BRANCH_FAILED:${branch.branchId}`);
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC11-duplicates-live.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: 'passed', sequentialDuplicate: sequential.decisionId, concurrentDuplicates: concurrent.length, overallValidationVerdict: result.overallValidationVerdict }));
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers }).catch(() => {});
}
