import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
    : JSON.stringify(value);
const contentDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

const base = (process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? new URL(base).origin;
const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const evidencePath = 'docs/implementation/evidence/TD15-NF01-two-sessions.json';
const generationEvidencePath = process.env.NF01_TWO_SESSION_GENERATION_EVIDENCE;
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const loginResponse = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(loginResponse.status, 200);
const cookie = loginResponse.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const csrf = (await loginResponse.json()).csrfToken;
assert.ok(cookie && csrf);
const management = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
const read = { cookie };
async function request(path, method = 'GET', body, headers = method === 'GET' ? read : management, allowError = false) {
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json();
  if (!response.ok && !allowError) throw new Error(`HTTP_${method}_${response.status}_${value?.code ?? 'UNKNOWN'}:${path}`);
  return { status: response.status, value };
}
function mockCalls(environmentId, runId) {
  const js = `const p='/control/environments/${environmentId}/calls?runId=${runId}';const r=await fetch('http://127.0.0.1:8082'+p,{headers:{authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN}});if(!r.ok)process.exit(2);const j=await r.json();console.log(JSON.stringify(j.items.map(x=>({operation:x.operation,input:x.input,actorId:x.actorId}))))`;
  return JSON.parse(execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', js], { encoding: 'utf8', windowsHide: true }));
}
async function waitTerminal(deploymentId, requestId) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const view = (await request(`/api/test-deployments/${deploymentId}/requests/${requestId}`)).value;
    if (view.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(view.run.status)) return view;
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new Error(`RUN_TIMEOUT:${requestId}`);
}

let deployment;
const sessions = {};
const invocations = [];
let result;
try {
  let draft; let snapshot; let baseline; let job; let candidate;
  let generatedRailMaximum;
  if (generationEvidencePath) {
    const generated = JSON.parse(await readFile(generationEvidencePath, 'utf8'));
    const currentImages = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
      .map(id => execFileSync('docker', ['inspect', '--format', '{{.Image}}', id], { encoding: 'utf8' }).trim());
    assert.deepEqual(generated.targetImageIds, currentImages, 'GENERATION_EVIDENCE_TARGET_CHANGED');
    assert.equal(generated.verdict, 'passed', 'GENERATION_EVIDENCE_NOT_PASSED');
    [draft, snapshot, baseline, job, candidate] = await Promise.all([
      request(`/api/drafts/${generated.draftId}`), request(`/api/snapshots/${generated.snapshotId}`),
      request(`/api/baselines/${generated.baselineId}`), request(`/api/development/${generated.jobId}`),
      request(`/api/candidates/${generated.candidateId}`)
    ]).then(values => values.map(item => item.value));
    assert.equal(job.status, 'built', 'REUSED_GENERATION_JOB_NOT_BUILT');
    assert.equal(candidate.artifactDigest, generated.artifactDigest, 'REUSED_CANDIDATE_DIGEST_MISMATCH');
    generatedRailMaximum = job.bundle.railDefinition?.rails?.find(item => item.templateId === 'tool-call-limit@1')?.parameters.maximum;
  } else {
    const goal = '查询设备状态，并要求每次运行最多 3 次工具调用。';
    draft = (await request('/api/drafts', 'POST', { name: `td15-nf01-two-sessions-${randomUUID().slice(0, 8)}`, brief: {
      audience: { value: '设备运维平台测试人员', source: 'user', confirmed: true },
      goal: { value: goal, source: 'user', confirmed: true },
      output: { value: '设备状态、温度和来源', source: 'user', confirmed: true }
    } })).value;
    const assembly = { agentType: 'DeepAgent', systemPrompt: `你是设备查询助手。${goal} 每条请求最多调用一次 get_equipment，取得指定设备的真实结果后立即回答；不得重复调用，不得补造。`, maxIterations: 6,
      railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
    snapshot = (await request(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly })).value;
    const preview = (await request(`/api/drafts/${draft.id}/baseline-preview?templateId=${encodeURIComponent('equipment-read@1')}`)).value;
    baseline = (await request(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision, templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true })).value;
    const generation = { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' };
    job = (await request(`/api/snapshots/${snapshot.id}/development`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id, generation, maxSeconds: 900 })).value;
    const buildDeadline = Date.now() + 920000;
    while (Date.now() < buildDeadline && !['built', 'failed', 'cancelled', 'reconciling'].includes(job.status)) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      job = (await request(`/api/development/${job.id}`)).value;
    }
    assert.equal(job.status, 'built', `RAIL_GENERATION_BUILD_FAILED:${job.diagnostic ?? job.status}`);
    generatedRailMaximum = job.bundle.railDefinition?.rails?.find(item => item.templateId === 'tool-call-limit@1')?.parameters.maximum;
    candidate = (await request('/api/candidates', 'POST', { snapshotId: snapshot.id, developmentJobId: job.id })).value;
  }
  assert.equal(generatedRailMaximum, 3, 'GENERATED_RAIL_LIMIT_NOT_THREE');
  assert.ok(candidate.runtimeSpec.agent.rails.includes('tool-call-limit@1:3'), 'GENERATED_RAIL_NOT_IN_CANDIDATE_SPEC');
  deployment = (await request('/api/test-deployments', 'POST', { clientRequestId: randomUUID(), candidateId: candidate.id, requirementBaselineId: baseline.id,
    suiteDigest: contentDigest(baseline.content.cases), purpose: 'test', ttlSeconds: 900 })).value;
  const deployDeadline = Date.now() + 90000;
  while (deployment.status === 'preparing' && Date.now() < deployDeadline) { await new Promise(resolve => setTimeout(resolve, 1000)); deployment = (await request(`/api/test-deployments/${deployment.id}`)).value; }
  assert.equal(deployment.status, 'ready', `TEST_DEPLOYMENT_NOT_READY:${deployment.diagnostic ?? deployment.status}`);

  for (const actorId of ['U1001', 'U1002']) {
    const grant = (await request(`/api/test-deployments/${deployment.id}/sessions`, 'POST', { actorId })).value;
    sessions[actorId] = { token: grant.token, headers: { origin, authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' } };
  }
  const submit = async (actorId, equipmentId, conversationId) => {
    const response = await request(`/test-api/deployments/${deployment.id}/messages`, 'POST', { clientRequestId: randomUUID(), input: `请查询 ${equipmentId} 的状态、温度和来源。`, ...(conversationId ? { conversationId } : {}) }, sessions[actorId].headers);
    assert.equal(response.status, 202);
    const view = { actorId, equipmentId, requestId: response.value.requestId, runId: response.value.runId, conversationId: response.value.conversationId };
    invocations.push(view);
    return view;
  };
  const first = await submit('U1001', 'PUMP-001');
  const second = await submit('U1002', 'PUMP-002');
  const firstView = await waitTerminal(deployment.id, first.requestId);
  const secondView = await waitTerminal(deployment.id, second.requestId);
  const firstAgain = await submit('U1001', 'PUMP-001', first.conversationId);
  const secondAgain = await submit('U1002', 'PUMP-002', second.conversationId);
  const firstAgainView = await waitTerminal(deployment.id, firstAgain.requestId);
  const secondAgainView = await waitTerminal(deployment.id, secondAgain.requestId);

  const cross = await request(`/test-api/deployments/${deployment.id}/messages`, 'POST', { clientRequestId: randomUUID(), input: '跨身份读取另一会话', conversationId: first.conversationId }, sessions.U1002.headers, true);
  assert.equal(cross.status, 404, 'CROSS_ACTOR_CONVERSATION_MUST_BE_REJECTED');
  const views = [firstView, secondView, firstAgainView, secondAgainView];
  const checks = [];
  for (let index = 0; index < invocations.length; index++) {
    const item = invocations[index]; const view = views[index];
    const calls = mockCalls(deployment.environmentId, item.runId);
    const runEvents = (await request(`/api/runs/${item.runId}/events`)).value.items;
    const runRail = view.run?.runtimeSpec?.agent?.rails ?? candidate.runtimeSpec.agent.rails;
    const railEvents = runEvents.filter(event => event.type === 'runtime.event' && event.data?.event?.rail === 'tool-call-limit').map(event => event.data.event);
    const allowedCounts = railEvents.filter(event => event.event === 'call_allowed').map(event => event.count);
    const noLimitExceeded = !railEvents.some(event => event.event === 'limit_reached');
    checks.push({ actorId: item.actorId, equipmentId: item.equipmentId, conversationId: item.conversationId, runId: item.runId, runStatus: view.run?.status,
      runActorId: view.run?.actorId, conversationBound: item.conversationId === (item.actorId === 'U1001' ? first.conversationId : second.conversationId),
      candidateRailLimitThree: runRail.includes('tool-call-limit@1:3'), allowedCounts, noLimitExceeded, externalOperations: calls.map(call => call.operation),
      externalEquipmentIds: calls.map(call => call.input?.equipmentId), runtimeEventCount: runEvents.filter(event => event.type === 'runtime.event').length,
      assertionPassed: view.run?.status === 'succeeded' && view.run.actorId === item.actorId && calls.length >= 1
        && calls.every(call => call.operation === 'equipment-status' && call.input?.equipmentId === item.equipmentId)
        && runRail.includes('tool-call-limit@1:3') && allowedCounts[0] === 1 && allowedCounts.every(count => count <= generatedRailMaximum) && noLimitExceeded });
  }
  const conversationsDistinct = first.conversationId !== second.conversationId;
  const actorsBoundToSeparateConversations = first.actorId !== second.actorId && first.conversationId === firstAgain.conversationId && second.conversationId === secondAgain.conversationId;
  const isolatedRailCounts = checks.length === 4 && checks.every(item => item.assertionPassed);
  result = { schemaVersion: 1, requirement: 'TD-15/NF-01 interleaved actors with stateful generated Rail', executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(), composeProject: project,
    draftId: draft.id, snapshotId: snapshot.id, developmentJobId: job.id, bundleDigest: job.bundle.digest, candidateId: candidate.id, candidateArtifactDigest: candidate.artifactDigest,
    testDeploymentId: deployment.id, environmentId: deployment.environmentId, generatedRailMaximum, interleavedRuns: checks, conversationsDistinct, actorsBoundToSeparateConversations,
    crossActorConversationRejected: cross.status === 404, isolatedRailCounts, verdict: conversationsDistinct && actorsBoundToSeparateConversations && cross.status === 404 && isolatedRailCounts ? 'passed' : 'failed' };
} finally {
  if (deployment && !['stopped', 'failed'].includes(deployment.status)) {
    try {
      await request(`/api/test-deployments/${deployment.id}/stop`, 'POST', {});
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) { deployment = (await request(`/api/test-deployments/${deployment.id}`)).value; if (deployment.status === 'stopped') break; await new Promise(resolve => setTimeout(resolve, 1000)); }
      if (result) result.cleanupStatus = deployment.status;
    } catch (error) { if (result) result.cleanupStatus = `unconfirmed:${error.message}`; }
  }
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: management }).catch(() => {});
}
assert.ok(result, 'NO_TWO_SESSION_EVIDENCE');
result.targetImageIds = execFileSync('docker', ['compose', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
  .map(id => execFileSync('docker', ['inspect', '--format', '{{.Image}}', id], { encoding: 'utf8' }).trim());
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
if (result.verdict !== 'passed' || result.cleanupStatus !== 'stopped') process.exitCode = 1;
