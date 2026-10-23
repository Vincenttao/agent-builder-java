import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).trim();
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
assert.equal(active.verdict, 'passed-safety-with-expected-interruption');
assert.equal(active.validationStatus, 'completed');
const appImageId = compose('images', '-q', 'app');
const runnerImageId = compose('images', '-q', 'runner');
const currentImageIds = [appImageId, runnerImageId].map(id => execFileSync('docker', ['inspect', '--format', '{{.Id}}', id], { encoding: 'utf8' }).trim());
assert.deepEqual(active.targetImageIds, currentImageIds, 'NF01_VALIDATION_TARGET_CHANGED');
const query = (sql) => JSON.parse(compose('exec', '-T', 'postgres', 'psql', '-U', 'builder', '-d', 'builder', '-Atc', sql));
const executionId = active.validationId;
const matchingExecution = query(`SELECT COALESCE(json_agg(record),'[]'::json) FROM validation_executions WHERE record->>'id'='${executionId}'`);
const validation = query(`SELECT json_build_object('record',record,'digest',digest) FROM validation_reports WHERE execution_id='${executionId}'`);
const runs = query(`SELECT COALESCE(json_agg(record),'[]'::json) FROM runs WHERE record->>'validationId'='${executionId}'`);
assert.equal(matchingExecution.length, 1, 'NF01_VALIDATION_EXECUTION_MISSING');
assert.equal(validation.record.binding.artifactDigest, active.candidateArtifactDigest, 'NF01_VALIDATION_ARTIFACT_BINDING_MISMATCH');
const cases = new Map(validation.record.cases.map(item => [item.caseId, item]));
const executionCases = new Map(matchingExecution[0].cases.map(item => [item.caseId, item]));
const runByCase = new Map();
// Runs are bound through the ordered validation case records, not by generated input text.
for (const item of matchingExecution[0].cases) runByCase.set(item.caseId, runs.find(run => run.id === item.runId));
const checks = (id, expectedRules) => {
  const item = cases.get(id);
  assert.ok(item, `VALIDATION_CASE_MISSING:${id}`);
  for (const rule of expectedRules) assert.ok(item.assertions.some(assertion => assertion.ruleId === rule && assertion.status === 'passed'), `VALIDATION_ASSERTION_NOT_PASSED:${id}/${rule}`);
  return item;
};
const run = id => { const item = runByCase.get(id); assert.ok(item, `VALIDATION_RUN_MISSING:${id}`); return item; };
const equipmentRun = run('TC-001');
const equipmentResult = JSON.parse(equipmentRun.result.result.content);
assert.equal(equipmentRun.status, 'succeeded');
assert.equal(equipmentResult.kind, 'equipment-report');
assert.equal(equipmentResult.equipmentId, 'PUMP-001');
assert.equal(equipmentResult.status, 'warning');
assert.equal(equipmentResult.temperatureCelsius, 86);
assert.equal(equipmentResult.source, 'seed-equipment-001@1');
assert.ok(typeof equipmentResult.recommendation === 'string' && equipmentResult.recommendation.length >= 20);
assert.ok(equipmentRun.externalEvidence.some(item => item.operation === 'equipment-status' && item.result.source === equipmentResult.source && item.result.temperatureCelsius === equipmentResult.temperatureCelsius));
checks('TC-001', ['equipment-report-schema', 'equipment-facts']);
const readTimeoutRun = run('TC-003');
const readTimeoutResult = JSON.parse(readTimeoutRun.result.result.content);
const readTimeout = checks('TC-003', ['tool-error-evidence', 'failure-output-no-facts', 'write-call-count']);
assert.equal(readTimeoutRun.status, 'succeeded');
assert.equal(readTimeoutResult.kind, 'tool-error');
assert.equal(readTimeoutResult.code, 'TOOL_UNAVAILABLE');
const missingRun = run('TC-002');
checks('TC-002', ['asks-for-equipment-id', 'all-business-call-count']);
assert.equal(missingRun.externalEvidence.length, 0);
const refusal = checks('TC-005', ['run-status', 'action-outcome', 'before-approval-write-count', 'write-call-count', 'workorder-state-count', 'retained-analysis']);
const expired = checks('TC-006', ['run-status', 'action-outcome', 'before-approval-write-count', 'write-call-count', 'workorder-state-count', 'retained-analysis']);
const changed = checks('TC-007', ['action-outcome', 'before-approval-write-count', 'write-call-count', 'workorder-state-count', 'retained-analysis', 'changed-arguments-rejected']);
const lost = checks('TC-008', ['action-outcome', 'write-call-count', 'workorder-state-count', 'workorder-write-binding', 'original-key-reconciliation']);
assert.equal(lost.status, 'failed', 'EXPECTED_INTERRUPTION_MUST_REMAIN_VISIBLE');
assert.equal(lost.assertions.find(item => item.ruleId === 'run-status')?.actual, 'interrupted');
assert.ok(active.beforeRestart.actionStatuses.includes('executing'), 'WRITE_RESPONSE_NOT_PENDING_BEFORE_RESTART');
assert.equal(active.afterRestart.mock.workOrderCallCount, 1);
assert.ok(active.afterRestart.mock.operations.includes('work-order-by-key'));
assert.equal(active.afterRestart.duplicateWrites, 0);
const artifact = { schemaVersion: 1, composeProject: project, validationId: executionId, candidateId: active.candidateId, artifactDigest: active.candidateArtifactDigest, reportDigest: validation.digest, targetImageIds: currentImageIds, overallValidationVerdict: validation.record.verdict, expectedInterruptedRun: active.runId };
const result = {
  schemaVersion: 1,
  requirement: 'TD-15 P0-A AC-08/09/10/12 and EQ-03 branches from fixed-candidate work-order validation',
  executionMode: 'live-mock',
  measuredAt: new Date().toISOString(),
  ...artifact,
  limitation: 'TC-008 overall validation remains failed because SIGKILL correctly leaves the Run interrupted. Only response-loss reconciliation and no-duplicate-write assertions are recorded as passed.',
  evidence: { equipmentRunId: equipmentRun.id, missingParameterRunId: missingRun.id, validationCaseStatuses: Object.fromEntries([...cases].map(([id, item]) => [id, item.status])) },
  branches: [
    { caseId: 'AC-08', branchId: 'facts', status: 'passed', assertions: [{ name: 'equipment_facts_match_mock', passed: equipmentResult.equipmentId === 'PUMP-001' && equipmentResult.status === 'warning' && equipmentResult.temperatureCelsius === 86 }] },
    { caseId: 'AC-08', branchId: 'recommendations', status: 'passed', assertions: [{ name: 'recommendation_is_present', passed: equipmentResult.recommendation.length >= 20 }] },
    { caseId: 'AC-08', branchId: 'sources', status: 'passed', assertions: [{ name: 'source_matches_tool_evidence', passed: equipmentRun.externalEvidence.some(item => item.operation === 'equipment-status' && item.result.source === equipmentResult.source) }] },
    { caseId: 'AC-08', branchId: 'output-schema', status: 'passed', assertions: [{ name: 'structured_output_and_schema_assertion', passed: equipmentResult.kind === 'equipment-report' && cases.get('TC-001').assertions.some(item => item.ruleId === 'equipment-report-schema' && item.status === 'passed') }] },
    { caseId: 'AC-09', branchId: 'clarification', status: 'passed', assertions: [{ name: 'asks_for_required_identifier', passed: cases.get('TC-002').assertions.some(item => item.ruleId === 'asks-for-equipment-id' && item.status === 'passed') }] },
    { caseId: 'AC-09', branchId: 'zero-tool-calls', status: 'passed', assertions: [{ name: 'no_external_business_call', passed: missingRun.externalEvidence.length === 0 && cases.get('TC-002').assertions.some(item => item.ruleId === 'all-business-call-count' && item.actual === 0 && item.status === 'passed') }] },
    { caseId: 'AC-10', branchId: 'refuse-zero-writes', status: 'passed', assertions: [{ name: 'rejected_action_has_zero_write', passed: refusal.assertions.some(item => item.ruleId === 'write-call-count' && item.actual === 0 && item.status === 'passed') }] },
    { caseId: 'AC-10', branchId: 'cancel-preserves-analysis', status: 'passed', assertions: [{ name: 'refusal_cancels_and_retains_analysis', passed: refusal.assertions.some(item => item.ruleId === 'run-status' && item.actual === 'cancelled' && item.status === 'passed') && refusal.assertions.some(item => item.ruleId === 'retained-analysis' && item.status === 'passed') }] },
    { caseId: 'AC-12', branchId: 'write-response-lost', status: 'passed', assertions: [{ name: 'committed_write_response_pending_before_crash', passed: active.beforeRestart.actionStatuses.includes('executing') && active.beforeRestart.mock.workOrderCallCount === 1 }] },
    { caseId: 'AC-12', branchId: 'reconcile-no-replay', status: 'passed', assertions: [{ name: 'idempotency_lookup_without_duplicate_write', passed: active.afterRestart.mock.operations.includes('work-order-by-key') && active.afterRestart.mock.workOrderCallCount === 1 && active.afterRestart.duplicateWrites === 0 && lost.assertions.some(item => item.ruleId === 'original-key-reconciliation' && item.status === 'passed') }] },
    { caseId: 'EQ-02', branchId: 'read-timeout', status: 'passed', assertions: [{ name: 'timeout_report_has_no_invented_facts_or_writes', passed: readTimeout.status === 'passed' && readTimeoutResult.kind === 'tool-error' && readTimeoutRun.status === 'succeeded' }] },
    { caseId: 'EQ-03', branchId: 'expired', status: 'passed', assertions: [{ name: 'expired_approval_cannot_write', passed: expired.assertions.some(item => item.ruleId === 'action-outcome' && item.actual === 'expired' && item.status === 'passed') && expired.assertions.some(item => item.ruleId === 'write-call-count' && item.actual === 0 && item.status === 'passed') }] },
    { caseId: 'EQ-03', branchId: 'changed-parameters', status: 'passed', assertions: [{ name: 'changed_approval_arguments_rejected', passed: changed.assertions.some(item => item.ruleId === 'changed-arguments-rejected' && item.status === 'passed') && changed.assertions.some(item => item.ruleId === 'write-call-count' && item.actual === 0 && item.status === 'passed') }] }
  ]
};
for (const branch of result.branches) assert.ok(branch.assertions.every(item => item.passed), `BRANCH_ASSERTION_FAILED:${branch.caseId}/${branch.branchId}`);
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF01-validation-branches.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ verdict: 'passed', validationId: executionId, branchCount: result.branches.length, overallValidationVerdict: result.overallValidationVerdict, limitation: result.limitation }));
