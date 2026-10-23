import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const base = (process.env.AC23_BASE_URL ?? 'http://127.0.0.1:18083').replace(/\/$/, '');
const origin = process.env.AC23_ORIGIN ?? new URL(base).origin;
const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-policy';
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const containers = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(containers.length, 2, 'FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200, 'LOGIN_FAILED');
const csrf = (await login.json()).csrfToken;
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
assert.ok(csrf && cookie, 'SESSION_CONTEXT_REQUIRED');
const readHeaders = { cookie };
const writeHeaders = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function api(path, method = 'GET', body, headers = method === 'GET' ? readHeaders : writeHeaders) {
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = response.status === 204 ? null : await response.json();
  return { status: response.status, value };
}
async function runnerPolicyProbe() {
  const probeId = randomUUID();
  const script = `import{EngineeringWorkspace}from'/app/dist/apps/runner/src/engineering/workspace.js';import{createEngineeringMcp}from'/app/dist/apps/runner/src/engineering/mcp.js';import{mkdtemp,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{randomUUID}from'node:crypto';const id=()=>randomUUID();const draft=id();const baseline={id:id(),draftId:draft,draftRevision:1,digest:'c'.repeat(64),confirmedAt:new Date().toISOString(),confirmedBy:'AC-23',content:{schemaVersion:1,templateId:'equipment-read@1',draftId:draft,draftRevision:1,audience:'AC-23 policy',requirements:[],cases:[],seed:'enterprise-default@1',rulesVersion:'equipment-assertions@1'}};const root=await mkdtemp(join(tmpdir(),'ac23-${probeId}-'));const events=[];const ws=new EngineeringWorkspace(root,'/opt/builder/runtime-bridge.jar',{baseline,goal:'AC-23 fixed policy probe',snapshotId:id(),runtimeSpec:{}},async e=>events.push(e));const tokens={developer:'d'.repeat(48),tester:'t'.repeat(48)};const app=createEngineeringMcp(ws,tokens);const call=async(name,args)=>{const r=await app.inject({method:'POST',url:'/mcp/developer',headers:{authorization:'Bearer '+tokens.developer},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});return{status:r.statusCode,text:r.json().result?.content?.[0]?.text}};try{await ws.initialize();await app.ready();const directory=await call('write',{path:'../escape.java',content:'blocked'});const command=await call('run',{commandId:'java -version'});console.log(JSON.stringify({directory:{...directory,rejectedEvent:events.some(e=>e.type==='policy.rejected'&&e.data.code==='FILE_OPERATION_NOT_ALLOWED')},command:{...command,diagnostic:ws.inspect().diagnostic}}))}finally{await app.close();await ws.cancel();await rm(root,{recursive:true,force:true})}`;
  return JSON.parse(execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'exec', '-T', 'runner', 'node', '--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 }).trim());
}
const results = [];
try {
  const draft = (await api('/api/drafts', 'POST', { name: `AC23 policy audit ${randomUUID().slice(0, 8)}`, brief: {
    audience: { value: '企业 Agent 平台开发人员', source: 'user', confirmed: true },
    goal: { value: '只读查询模拟设备状态', source: 'user', confirmed: true },
    output: { value: '设备状态和来源', source: 'user', confirmed: true }
  } })).value;
  const assembly = { agentType: 'DeepAgent', systemPrompt: '按设备编号查询状态，只读并保留来源。', maxIterations: 4,
    railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
  const snapshotResponse = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly });
  assert.equal(snapshotResponse.status, 201, `SNAPSHOT_FAILED:${snapshotResponse.value?.code}`);
  const snapshot = snapshotResponse.value;
  const previewResponse = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=equipment-read%401`);
  assert.equal(previewResponse.status, 200, 'BASELINE_PREVIEW_FAILED');
  const confirmResponse = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision, templateId: 'equipment-read@1', expectedDigest: previewResponse.value.digest, confirmed: true });
  assert.equal(confirmResponse.status, 201, `BASELINE_CONFIRM_FAILED:${confirmResponse.value?.code}`);
  const baseline = confirmResponse.value;
  const profiles = [
    { name: 'scope', code: 'GENERATION_SCOPE_UNSUPPORTED', generation: { profileVersion: 'equipment-java@3', scope: ['tool'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' } },
    { name: 'dependency', code: 'DEPENDENCY_NOT_ALLOWED', generation: { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'], dependencies: ['unreviewed-package@1'], connectionProfile: 'mock-equipment@1' } },
    { name: 'connection', code: 'BUSINESS_CONNECTION_NOT_ALLOWED', generation: { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'production-bank' } },
    { name: 'profile-version', code: 'GENERATION_PROFILE_UNSUPPORTED', generation: { profileVersion: 'equipment-java@99', scope: ['tool', 'skill', 'rail'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' } }
  ];
  for (const item of profiles) {
    const input = { clientRequestId: randomUUID(), baselineId: baseline.id, generation: item.generation, maxSeconds: 900 };
    const admission = await api(`/api/snapshots/${snapshot.id}/development`, 'POST', input);
    assert.equal(admission.status, 202, `REJECTION_RECORD_NOT_RETURNED:${item.name}:${admission.value?.code}`);
    const job = admission.value;
    assert.equal(job.status, 'failed', `INVALID_REQUEST_NOT_FAILED:${item.name}`);
    assert.equal(job.diagnostic, item.code, `POLICY_DIAGNOSTIC_MISMATCH:${item.name}`);
    assert.deepEqual(job.roles.map(role => [role.role, role.status]), [['tester', 'skipped'], ['developer', 'skipped']], `INVALID_ROLE_EXECUTION:${item.name}`);
    const persisted = (await api(`/api/development/${job.id}`)).value;
    assert.equal(persisted.inputDigest, job.inputDigest, `REJECTED_INPUT_NOT_RETAINED:${item.name}`);
    const events = (await api(`/api/development/${job.id}/events`)).value.items;
    assert.equal(events.length, 1, `REJECTION_EVENT_COUNT_MISMATCH:${item.name}`);
    assert.equal(events[0].type, 'policy.rejected');
    assert.deepEqual(events[0].data, { code: item.code, stage: 'generation-admission' });
    const retry = await api(`/api/snapshots/${snapshot.id}/development`, 'POST', input);
    assert.equal(retry.status, 202, `REJECTED_RETRY_NOT_IDEMPOTENT:${item.name}`);
    assert.equal(retry.value.id, job.id, `REJECTED_RETRY_CREATED_DUPLICATE:${item.name}`);
    const runnerStatus = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'exec', '-T', 'runner', 'node', '--input-type=module', '-e',
      `const r=await fetch('http://127.0.0.1:8081/engineering/tasks/${job.id}',{headers:{authorization:'Bearer '+process.env.RUNNER_CONTROL_TOKEN}});console.log(JSON.stringify({status:r.status,body:await r.json()}))`], { encoding: 'utf8' }).trim();
    const runnerLookup = JSON.parse(runnerStatus);
    assert.equal(runnerLookup.status, 404, `REJECTED_JOB_REACHED_RUNNER:${item.name}`);
    results.push({ name: item.name, code: item.code, jobId: job.id, inputDigest: job.inputDigest, event: events[0], runnerStatus: runnerLookup.status, retryJobId: retry.value.id });
  }
  const profileAudit = results;
  const runnerPolicy = await runnerPolicyProbe();
  assert.equal(runnerPolicy.directory.status, 200, 'DIRECTORY_PROBE_MCP_STATUS');
  assert.equal(runnerPolicy.directory.text, 'FILE_OPERATION_NOT_ALLOWED', 'DIRECTORY_POLICY_NOT_REJECTED');
  assert.equal(runnerPolicy.directory.rejectedEvent, true, 'DIRECTORY_REJECTION_NOT_AUDITED');
  assert.equal(runnerPolicy.command.status, 200, 'COMMAND_PROBE_MCP_STATUS');
  assert.equal(runnerPolicy.command.text, 'COMMAND_NOT_ALLOWED', 'COMMAND_POLICY_NOT_REJECTED');
  assert.equal(runnerPolicy.command.diagnostic, 'COMMAND_NOT_ALLOWED', 'COMMAND_DIAGNOSTIC_NOT_RETAINED');
  results.push({ name: 'directory', code: runnerPolicy.directory.text, event: { type: 'policy.rejected', data: { code: runnerPolicy.directory.text } }, runnerStatus: 200, mcp: runnerPolicy.directory });
  results.push({ name: 'command', code: runnerPolicy.command.text, event: { type: 'task.diagnostic', data: { code: runnerPolicy.command.diagnostic } }, runnerStatus: 200, mcp: runnerPolicy.command });
  results.push({ name: 'dependency-connection-profile-audit', codes: profileAudit.map(item => item.code), runnerStatus: 404 });
} finally {
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
  const evidence = { schemaVersion: 1, requirement: 'TD-15/AC-23 generation admission and Runner file/command policy reject out-of-scope requests with diagnostics', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, base, targetImageIds, results, verdict: results.some(item => item.name === 'directory') && results.some(item => item.name === 'command') && results.some(item => item.name === 'dependency') && results.some(item => item.name === 'connection') ? 'passed' : 'failed' };
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC23-policy-audit-live.json', JSON.stringify(evidence, null, 2) + '\n');
}
process.stdout.write(JSON.stringify({ verdict: 'passed', targetImageIds, rejectedRequests: results.map(item => `${item.name}:${item.code ?? ''}`) }) + '\n');
