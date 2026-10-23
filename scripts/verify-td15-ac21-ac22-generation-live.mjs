import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = (process.env.TD15_GENERATION_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.TD15_GENERATION_ORIGIN ?? base;
const project = process.env.TD15_GENERATION_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const evidenceInput = process.env.TD15_GENERATION_EVIDENCE ?? 'docs/implementation/evidence/TDD-023-live-rail-generation-79b1ff04-2ca8-4e1d-8054-01b251f49244.json';
const generated = JSON.parse(await readFile(evidenceInput, 'utf8'));
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
    : JSON.stringify(value);
const containers = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(generated.targetImageIds, targetImageIds, 'GENERATION_TARGET_IMAGE_CHANGED');
assert.equal(generated.taskStatus, 'built', 'GENERATION_TASK_NOT_BUILT');

const tokenLine = (await readFile('.env.local', 'utf8')).split(/\r?\n/).find(line => line.startsWith('LOCAL_BOOTSTRAP_TOKEN='));
const token = tokenLine?.slice('LOCAL_BOOTSTRAP_TOKEN='.length).replace(/^['"]|['"]$/g, '');
assert.ok(token, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
assert.equal(login.status, 200, 'LOGIN_FAILED');
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf, 'LOGIN_RESPONSE_INVALID');
const readHeaders = { cookie };
const writeHeaders = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function api(path, method = 'GET', body, headers = method === 'GET' ? readHeaders : writeHeaders) {
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${value?.code ?? path}`);
  return value;
}
async function mockCalls(environmentId, runId) {
  const js = `const p='/control/environments/${environmentId}/calls?runId=${runId}';const r=await fetch('http://127.0.0.1:8082'+p,{headers:{authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN}});if(!r.ok)process.exit(1);const j=await r.json();console.log(JSON.stringify(j.items.map(x=>({operation:x.operation,input:x.input,status:x.status}))))`;
  return JSON.parse(execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', js], { encoding: 'utf8' }));
}

let deployment;
let result;
try {
  const job = await api(`/api/development/${generated.jobId}`);
  const snapshot = await api(`/api/snapshots/${generated.snapshotId}`);
  const baseline = await api(`/api/baselines/${generated.baselineId}`);
  const events = (await api(`/api/development/${generated.jobId}/events`)).items;
  const roles = job.roles;
  const tester = roles.find(item => item.role === 'tester');
  const developer = roles.find(item => item.role === 'developer');
  const independentRoles = Boolean(tester?.sessionId && developer?.sessionId && tester.sessionId !== developer.sessionId
    && tester.status === 'completed' && developer.status === 'completed');
  const sharedBaseline = job.baselineId === baseline.id && snapshot.draftId === job.agentId
    && baseline.draftId === job.agentId && baseline.confirmedAt && generated.baselineId === baseline.id;
  const firstGreen = events.findIndex(item => item.type === 'command.completed' && item.data.commandId === 'unit-test' && item.data.status === 'passed');
  const red = events.findIndex(item => item.type === 'command.completed' && item.data.commandId === 'unit-test' && item.data.status === 'failed');
  const sourceWrite = events.findIndex(item => item.type === 'file.written' && item.data.path === 'src/generated/EquipmentTool.java');
  const skillWrite = events.findIndex(item => item.type === 'file.written' && item.data.path === 'skills/equipment-query/SKILL.md');
  const buildPassed = job.status === 'built' && red >= 0 && firstGreen > red && sourceWrite > red
    && events.some(item => item.type === 'command.completed' && item.data.commandId === 'platform-contract' && item.data.status === 'passed')
    && events.some(item => item.type === 'command.completed' && item.data.commandId === 'package-component' && item.data.status === 'passed');
  assert.ok(independentRoles, 'GENERATION_ROLES_NOT_INDEPENDENT');
  assert.ok(sharedBaseline, 'GENERATION_BASELINE_NOT_SHARED_AND_CONFIRMED');
  assert.ok(buildPassed, 'GENERATION_BUILD_EVIDENCE_INCOMPLETE');

  const candidate = await api('/api/candidates', 'POST', { snapshotId: generated.snapshotId, developmentJobId: generated.jobId });
  assert.equal(candidate.provenance, 'generated-component', 'CANDIDATE_NOT_GENERATED');
  assert.equal(candidate.generated.runtimeArtifact.generated.componentDigest, generated.bundle.artifactDigest, 'GENERATED_COMPONENT_ARTIFACT_CHANGED');
  assert.equal(candidate.generated.runtimeArtifact.generated.skillDigest, generated.bundle.files.find(item => item.path === 'skills/equipment-query/SKILL.md')?.digest, 'GENERATED_SKILL_DIGEST_MISMATCH');
  assert.ok(candidate.runtimeSpec.agent.rails.includes('tool-call-limit@1:3'), 'GENERATED_RAIL_NOT_BOUND_TO_RUNTIME');
  const tool = candidate.runtimeSpec.tools.find(item => item.operationId === 'equipment-status');
  assert.ok(tool && tool.protocol === 'http' && tool.connectionRef === 'enterprise-mock-http@1' && tool.toolVersion === 'equipment-status-http@1', 'GENERATED_TOOL_HTTP_BINDING_INVALID');
  const suiteDigest = baseline.content?.cases ? createHash('sha256').update(canonicalJson(baseline.content.cases)).digest('hex') : null;
  assert.ok(suiteDigest, 'BASELINE_CASE_DIGEST_MISSING');
  deployment = await api('/api/test-deployments', 'POST', { clientRequestId: randomUUID(), candidateId: candidate.id, requirementBaselineId: baseline.id, suiteDigest, purpose: 'test', ttlSeconds: 300 });
  const deployDeadline = Date.now() + 90000;
  while (deployment.status === 'preparing' && Date.now() < deployDeadline) { await new Promise(resolve => setTimeout(resolve, 1000)); deployment = await api(`/api/test-deployments/${deployment.id}`); }
  assert.equal(deployment.status, 'ready', `GENERATED_TEST_DEPLOYMENT_NOT_READY:${deployment.diagnostic ?? deployment.status}`);
  const grant = await api(`/api/test-deployments/${deployment.id}/sessions`, 'POST', { actorId: 'U1001' });
  const bearer = { origin, authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' };
  const invocation = await api(`/test-api/deployments/${deployment.id}/messages`, 'POST', { clientRequestId: randomUUID(), input: '请查询 PUMP-001 的状态、温度和数据来源。' }, bearer);
  let request;
  const runDeadline = Date.now() + 120000;
  while (Date.now() < runDeadline) {
    request = await api(`/api/test-deployments/${deployment.id}/requests/${invocation.requestId}`);
    if (request.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(request.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(request?.run?.status, 'succeeded', `GENERATED_AGENT_RUN_FAILED:${request?.run?.diagnostic ?? request?.run?.status}`);
  const runEvents = (await api(`/api/runs/${request.run.id}/events`)).items;
  const runtimeEvents = runEvents.filter(item => item.type === 'runtime.event').map(item => item.data?.event ?? {});
  const skillLoaded = runtimeEvents.some(item => item.event === 'skill_loaded' && item.skillDigest === candidate.generated.runtimeArtifact.generated.skillDigest);
  const generatedToolInvoked = runtimeEvents.some(item => item.event === 'generated_tool_invoked' && item.componentDigest === candidate.generated.runtimeArtifact.generated.componentDigest);
  const railDefinition = generated.bundle.railDefinition;
  const configuredMaximum = railDefinition?.rails?.find(item => item.templateId === 'tool-call-limit@1')?.parameters?.maximum;
  const railEvents = runtimeEvents.filter(item => item.rail === 'tool-call-limit');
  const railRuntimeBound = configuredMaximum === 3 && candidate.runtimeSpec.agent.rails.includes(`tool-call-limit@1:${configuredMaximum}`)
    && railEvents.length > 0 && railEvents.every(item => item.limit === configuredMaximum && item.sessionId === request.run.id);
  const belowLimit = railEvents.length > 0 && railEvents.every(item => item.event === 'call_allowed' && item.count < configuredMaximum)
    && !railEvents.some(item => item.event === 'limit_reached');
  assert.ok(skillLoaded, 'GENERATED_SKILL_NOT_LOADED');
  assert.ok(generatedToolInvoked, 'GENERATED_TOOL_NOT_INVOKED');
  assert.ok(railRuntimeBound, 'GENERATED_RAIL_NOT_LOADED_OR_EMITTING_RUNTIME_EVENTS');
  assert.ok(belowLimit, 'GENERATED_RAIL_BELOW_LIMIT_ASSERTION_FAILED');
  const calls = await mockCalls(deployment.environmentId, request.run.id);
  assert.equal(calls.length, 1, 'GENERATED_HTTP_TOOL_CALL_COUNT_MISMATCH');
  assert.equal(calls[0].operation, 'equipment-status');
  assert.equal(calls[0].input?.equipmentId, 'PUMP-001');
  assert.equal(calls[0].status, 200);

  const branch = (caseId, branchId, assertions) => ({ caseId, branchId, status: assertions.every(item => item.passed) ? 'passed' : 'failed', assertions });
  const results = [
    branch('AC-21', 'independent-role-records', [{ name: 'tester_and_developer_have_distinct_completed_sessions', passed: independentRoles }]),
    branch('AC-21', 'shared-confirmed-baseline', [{ name: 'both_roles_use_one_confirmed_baseline', passed: sharedBaseline }]),
    branch('AC-22a', 'empty-tool-source', [{ name: 'implementation_written_after_red_test', passed: red >= 0 && sourceWrite > red }]),
    branch('AC-22a', 'build', [{ name: 'unit_contract_package_and_candidate_build_pass', passed: buildPassed && Boolean(candidate.artifactDigest) }]),
    branch('AC-22a', 'actual-http-mapping', [{ name: 'generated_http_tool_calls_pinned_mock_operation_once', passed: tool.protocol === 'http' && calls.length === 1 && calls[0].operation === 'equipment-status' }]),
    branch('AC-22b', 'empty-skill-source', [{ name: 'skill_created_during_developer_role_after_red', passed: skillWrite > red }]),
    branch('AC-22b', 'loaded', [{ name: 'runtime_loaded_exact_generated_skill_digest', passed: skillLoaded }]),
    branch('AC-22b', 'model-trigger', [{ name: 'model_invoked_generated_tool_and_mock_received_request', passed: request.run.status === 'succeeded' && generatedToolInvoked && calls.length === 1 }]),
    branch('AC-22d', 'rail-source', [{ name: 'developer_generated_registered_rail_definition', passed: events.some(item => item.type === 'file.written' && item.role === 'developer' && item.data.path === 'rails/definition.json') && configuredMaximum === 3 }]),
    branch('AC-22d', 'loaded-hook', [{ name: 'generated_rail_is_bound_and_hook_emits_scoped_events', passed: railRuntimeBound }]),
    branch('AC-22d', 'below-limit', [{ name: 'real_candidate_allows_calls_below_generated_limit', passed: belowLimit }])
  ];
  assert.ok(results.every(item => item.status === 'passed'), 'GENERATION_ACCEPTANCE_BRANCH_FAILED');
  result = { schemaVersion: 1, requirement: 'TD-15 P0-B AC-21/22 generated Tool and Skill with shared Rail-aware build and live Mock execution', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds,
    generationEvidence: evidenceInput, jobId: job.id, draftId: job.agentId, snapshotId: snapshot.id, baselineId: baseline.id, baselineDigest: baseline.digest,
    candidateId: candidate.id, artifactDigest: candidate.artifactDigest, developmentEvents: events.map(item => ({ sequence: item.sequence, type: item.type, role: item.role, commandId: item.data?.commandId ?? null, status: item.data?.status ?? null, path: item.data?.path ?? null })),
    roles: roles.map(({ role, status, sessionId }) => ({ role, status, sessionId })), toolBinding: tool, runtimeRails: candidate.runtimeSpec.agent.rails,
    runId: request.run.id, runStatus: request.run.status, skillLoaded, generatedToolInvoked, railDefinition,
    railRuntime: { configuredMaximum, railRuntimeBound, belowLimit, events: railEvents }, mockCalls: calls, branches: results, verdict: 'passed' };
} catch (error) {
  result = { schemaVersion: 1, requirement: 'TD-15 P0-B AC-21/22 generated Tool and Skill with shared Rail-aware build and live Mock execution', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds, generationEvidence: evidenceInput, verdict: 'failed', failure: String(error?.stack ?? error) };
  throw error;
} finally {
  if (deployment?.id && !['stopped', 'failed'].includes(deployment.status)) {
    try { await api(`/api/test-deployments/${deployment.id}/stop`, 'POST', {}); } catch {}
  }
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
  if (result) {
    await mkdir('docs/implementation/evidence', { recursive: true });
    await writeFile('docs/implementation/evidence/TD15-AC21-AC22-generation-live.json', JSON.stringify(result, null, 2) + '\n');
  }
}
if (result.verdict !== 'passed') process.exitCode = 1;
else process.stdout.write(JSON.stringify({ verdict: result.verdict, branches: result.branches.map(item => `${item.caseId}/${item.branchId}`), runId: result.runId }) + '\n');
