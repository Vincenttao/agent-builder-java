import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = (process.env.TD15_ACCEPTANCE_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.TD15_ACCEPTANCE_ORIGIN ?? 'http://127.0.0.1:8080';
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).trim();
const inspectImage = service => execFileSync('docker', ['inspect', '--format', '{{.Image}}', compose('ps', '-q', service)], { encoding: 'utf8' }).trim();
const targetImageIds = [inspectImage('app'), inspectImage('runner')];
const digest = value => createHash('sha256').update(value).digest('hex');
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
    : JSON.stringify(value);
const sourceEvidence = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF05-workspace.json', 'utf8'));
assert.equal(sourceEvidence.verdict, 'passed', 'NF05_SOURCE_EVIDENCE_REQUIRED');
const jobId = sourceEvidence.sourceDevelopmentJobId;
const candidateId = sourceEvidence.sourceCandidateId;

let cookie;
let csrf;
let deployment;
let originalWorkingCopy;
let workingPath;
let result = { schemaVersion: 1, requirement: 'TD-15 P0-B AC-24 immutable candidate, tester write denial and digest change detection', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, base, targetImageIds, jobId, candidateId };
async function api(path, method = 'GET', body, headers) {
  const response = await fetch(`${base}${path}`, { method, headers: headers ?? (method === 'GET' ? { origin, cookie } : { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json().catch(() => null);
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${value?.code ?? path}`);
  return value;
}
function runnerJson(script) {
  return JSON.parse(compose('exec', '-T', 'runner', 'node', '--input-type=module', '-e', script));
}
async function mockCalls(environmentId, runId) {
  const script = `const p='/control/environments/${environmentId}/calls?runId=${runId}';const r=await fetch('http://127.0.0.1:8082'+p,{headers:{authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN}});if(!r.ok)throw new Error('MOCK_CALLS_UNAVAILABLE');const j=await r.json();console.log(JSON.stringify(j.items.map(x=>({operation:x.operation,status:x.status,input:x.input,result:x.result}))))`;
  return JSON.parse(compose('exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', script));
}
async function testerWriteProbe() {
  const probeId = randomUUID();
  const script = `import{EngineeringWorkspace}from'/app/dist/apps/runner/src/engineering/workspace.js';import{createEngineeringMcp}from'/app/dist/apps/runner/src/engineering/mcp.js';import{mkdtemp,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{randomUUID}from'node:crypto';const id=()=>randomUUID();const draft=id();const baseline={id:id(),draftId:draft,draftRevision:1,digest:'b'.repeat(64),confirmedAt:new Date().toISOString(),confirmedBy:'AC-24',content:{schemaVersion:1,templateId:'equipment-read@1',draftId:draft,draftRevision:1,audience:'AC-24 role policy',requirements:[],cases:[],seed:'enterprise-default@1',rulesVersion:'equipment-assertions@1'}};const root=await mkdtemp(join(tmpdir(),'ac24-${probeId}-'));const events=[];const ws=new EngineeringWorkspace(root,'/opt/builder/runtime-bridge.jar',{baseline,goal:'AC-24 role access probe',snapshotId:id(),runtimeSpec:{}},async e=>events.push(e));const tokens={developer:'d'.repeat(48),tester:'t'.repeat(48)};const app=createEngineeringMcp(ws,tokens);try{await ws.initialize();await app.ready();const response=await app.inject({method:'POST',url:'/mcp/tester',headers:{authorization:'Bearer '+tokens.tester},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'write',arguments:{path:'implementation/src/generated/EquipmentTool.java',content:'tampered'}}}});const body=response.json();const text=body.result?.content?.[0]?.text;const source=await ws.read('tester','implementation/src/generated/EquipmentTool.java');const rejected=events.find(e=>e.type==='policy.rejected');if(response.statusCode!==200||body.result?.isError!==true||text!=='FILE_OPERATION_NOT_ALLOWED'||rejected?.data?.code!=='FILE_OPERATION_NOT_ALLOWED'||source!==ws.profile.sourceStub)throw new Error('AC24_TESTER_WRITE_NOT_BLOCKED');console.log(JSON.stringify({httpStatus:response.statusCode,toolError:text,policyEvent:rejected.type,policyCode:rejected.data.code,sourceDigest:(await import('node:crypto')).createHash('sha256').update(source).digest('hex')}));}finally{await app.close();await ws.cancel();await rm(root,{recursive:true,force:true})}`;
  return runnerJson(script);
}
async function candidateTamperProbe(artifactDigest) {
  const probeId = randomUUID();
  const script = `import{RuntimeArtifactRegistry}from'/app/dist/apps/runner/src/runtime/artifact-registry.js';import{mkdtemp,copyFile,readFile,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';const root=await mkdtemp(join(tmpdir(),'ac24-tamper-${probeId}-'));const digest='${artifactDigest}';const registry=new RuntimeArtifactRegistry(join(root,'registry'),'/opt/builder/runtime-bridge.jar');const h=x=>createHash('sha256').update(x).digest('hex');try{await registry.initialize();await copyFile('/data/artifacts/'+digest+'.jar',registry.path(digest));await copyFile('/data/artifacts/'+digest+'.json',join(root,'registry','artifacts',digest+'.json'));const bytes=await readFile(registry.path(digest));if(h(bytes)!==digest)throw new Error('AC24_CANDIDATE_DIGEST_BEFORE_MISMATCH');const descriptor=await registry.get(digest);await writeFile(registry.path(digest),Buffer.concat([bytes,Buffer.from('AC24_TAMPER')]));const tampered=await readFile(registry.path(digest));let rejected=false;try{await registry.get(digest)}catch(error){rejected=error?.message==='ARTIFACT_MISMATCH'}await writeFile(registry.path(digest),bytes);const restored=await registry.get(digest);if(!rejected||restored.artifactDigest!==digest||descriptor.artifactDigest!==digest)throw new Error('AC24_TAMPER_NOT_REJECTED_OR_RESTORED');console.log(JSON.stringify({candidateDigestBefore:h(bytes),candidateDigestAfterTamper:h(tampered),tamperRejected:rejected,candidateReadableAfterRestore:restored.artifactDigest===digest}))}finally{await rm(root,{recursive:true,force:true})}`;
  return runnerJson(script);
}
async function mutateWorkingCopy(content) {
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const script = `import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';const p=${JSON.stringify(workingPath)};const before=await readFile(p,'utf8');const wanted=Buffer.from('${encoded}','base64').toString('utf8');if(before!==wanted)throw new Error('AC24_WORKING_COPY_CHANGED_BEFORE_TEST');await writeFile(p,before+'\\n// AC24 deliberate development-copy mutation\\n');const after=await readFile(p,'utf8');const h=x=>createHash('sha256').update(x).digest('hex');console.log(JSON.stringify({beforeDigest:h(before),afterDigest:h(after),changed:before!==after}))`;
  return runnerJson(script);
}
async function restoreWorkingCopy(content) {
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const script = `import{writeFile}from'node:fs/promises';const p=${JSON.stringify(workingPath)};await writeFile(p,Buffer.from('${encoded}','base64'));console.log('restored')`;
  compose('exec', '-T', 'runner', 'node', '--input-type=module', '-e', script);
}

try {
  const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
  assert.equal(login.status, 200, 'LOCAL_LOGIN_FAILED');
  const session = await login.json(); cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0]; csrf = session.csrfToken;
  assert.ok(cookie && csrf, 'SESSION_CONTEXT_REQUIRED');

  const candidate = await api(`/api/candidates/${candidateId}`);
  assert.equal(candidate.generated.developmentJobId, jobId, 'CANDIDATE_SOURCE_JOB_MISMATCH');
  result.candidateArtifactDigestBefore = candidate.artifactDigest;
  result.candidateBundleDigestBefore = candidate.bundleDigest;
  result.baselineId = candidate.generated.baselineId;
  const job = await api(`/api/development/${jobId}`);
  const baseline = (await api(`/api/drafts/${sourceEvidence.sourceDraftId}/baselines`)).items.find(item => item.id === job.baselineId);
  assert.ok(baseline, 'CANDIDATE_BASELINE_NOT_FOUND');
  const suiteDigest = digest(canonicalJson(baseline.content.cases));
  const created = await api('/api/test-deployments', 'POST', { clientRequestId: randomUUID(), candidateId, requirementBaselineId: baseline.id, suiteDigest, purpose: 'test', ttlSeconds: 300 });
  deployment = created;
  const readyDeadline = Date.now() + 90000;
  while (deployment.status === 'preparing' && Date.now() < readyDeadline) { await new Promise(resolve => setTimeout(resolve, 1000)); deployment = await api(`/api/test-deployments/${deployment.id}`); }
  assert.equal(deployment.status, 'ready', `CANDIDATE_DEPLOYMENT_NOT_READY:${deployment.diagnostic ?? deployment.status}`);

  const filePath = 'src/generated/EquipmentTool.java';
  const fixedBefore = await api(`/api/development/${jobId}/file?path=${encodeURIComponent(filePath)}`);
  originalWorkingCopy = fixedBefore.content;
  workingPath = `/data/engineering/tasks/${jobId}/workspace/developer/src/generated/EquipmentTool.java`;
  const mutation = await mutateWorkingCopy(originalWorkingCopy);
  const fixedAfter = await api(`/api/development/${jobId}/file?path=${encodeURIComponent(filePath)}`);
  const candidateAfterMutation = await api(`/api/candidates/${candidateId}`);
  result.workingCopyMutation = mutation;
  result.fixedBundleDigestBefore = fixedBefore.digest;
  result.fixedBundleDigestAfter = fixedAfter.digest;
  result.candidateArtifactDigestAfterMutation = candidateAfterMutation.artifactDigest;
  result.candidateBundleDigestAfterMutation = candidateAfterMutation.bundleDigest;
  assert.ok(mutation.changed && mutation.beforeDigest !== mutation.afterDigest, 'DEVELOPMENT_COPY_NOT_CHANGED');
  assert.equal(fixedAfter.digest, fixedBefore.digest, 'FIXED_BUNDLE_CHANGED_WITH_WORKING_COPY');
  assert.equal(candidateAfterMutation.artifactDigest, candidate.artifactDigest, 'CANDIDATE_ARTIFACT_CHANGED_WITH_WORKING_COPY');
  assert.equal(candidateAfterMutation.bundleDigest, candidate.bundleDigest, 'CANDIDATE_BUNDLE_CHANGED_WITH_WORKING_COPY');

  result.testerWriteProbe = await testerWriteProbe();
  result.candidateTamperProbe = await candidateTamperProbe(candidate.artifactDigest);
  const grant = await api(`/api/test-deployments/${deployment.id}/sessions`, 'POST', { actorId: 'U1001' });
  const bearer = { origin, authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' };
  const input = baseline.content.cases[0]?.input ?? '请查询 PUMP-001 的状态、温度和来源。';
  const invocation = await api(`/test-api/deployments/${deployment.id}/messages`, 'POST', { clientRequestId: randomUUID(), input }, bearer);
  let request;
  const runDeadline = Date.now() + 120000;
  while (Date.now() < runDeadline) {
    request = await api(`/api/test-deployments/${deployment.id}/requests/${invocation.requestId}`);
    if (request.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(request.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(request?.run?.status, 'succeeded', `PINNED_CANDIDATE_RUN_FAILED:${request?.run?.diagnostic ?? request?.run?.status}`);
  const calls = await mockCalls(deployment.environmentId, request.run.id);
  assert.equal(calls.length, 1, 'PINNED_CANDIDATE_MOCK_CALL_COUNT');
  assert.equal(calls[0].operation, 'equipment-status', 'PINNED_CANDIDATE_WRONG_OPERATION');
  assert.equal(request.run.artifactDigest, candidate.artifactDigest, 'RUN_ARTIFACT_DIGEST_CHANGED');
  result.runId = request.run.id;
  result.runStatus = request.run.status;
  result.runArtifactDigest = request.run.artifactDigest;
  result.mockCalls = calls.map(item => ({ operation: item.operation, status: item.status, inputDigest: digest(JSON.stringify(item.input)), resultDigest: digest(JSON.stringify(item.result)) }));
  result.candidateArtifactDigestAfterRun = (await api(`/api/candidates/${candidateId}`)).artifactDigest;
  assert.equal(result.candidateArtifactDigestAfterRun, candidate.artifactDigest, 'CANDIDATE_CHANGED_DURING_TEST');
  assert.equal(result.runArtifactDigest, candidate.artifactDigest, 'TEST_USED_DIFFERENT_CANDIDATE');
  result.assertions = {
    developmentCopyChanged: mutation.changed && mutation.beforeDigest !== mutation.afterDigest,
    fixedBundleUnaffected: fixedBefore.digest === fixedAfter.digest,
    candidateDigestStable: candidate.bundleDigest === candidateAfterMutation.bundleDigest && candidate.artifactDigest === result.candidateArtifactDigestAfterRun,
    testerWriteRejected: result.testerWriteProbe.toolError === 'FILE_OPERATION_NOT_ALLOWED' && result.testerWriteProbe.policyCode === 'FILE_OPERATION_NOT_ALLOWED',
    tamperedCandidateDigestRejected: result.candidateTamperProbe.candidateDigestBefore === candidate.artifactDigest && result.candidateTamperProbe.candidateDigestAfterTamper !== candidate.artifactDigest && result.candidateTamperProbe.tamperRejected,
    mutatedCopyCandidateStillRuns: request.run.status === 'succeeded' && request.run.artifactDigest === candidate.artifactDigest && calls.length === 1
  };
  assert.ok(Object.values(result.assertions).every(Boolean), 'AC24_ASSERTION_FAILED');
  result.verdict = 'passed';
} catch (error) {
  result.verdict = 'failed';
  result.failure = String(error?.stack ?? error);
} finally {
  if (originalWorkingCopy && workingPath) {
    try { await restoreWorkingCopy(originalWorkingCopy); result.workingCopyRestored = true; }
    catch (error) { result.workingCopyRestored = false; result.restoreFailure = String(error); result.verdict = 'failed'; }
  }
  if (deployment && cookie && csrf) {
    await api(`/api/test-deployments/${deployment.id}/stop`, 'POST', {}).catch(() => {});
    const stopDeadline = Date.now() + 60000;
    while (Date.now() < stopDeadline) {
      try { deployment = await api(`/api/test-deployments/${deployment.id}`); if (deployment.status === 'stopped' || deployment.status === 'failed') break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    result.deploymentCleanupStatus = deployment.status;
  }
  if (cookie && csrf) await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
  result.measuredAt = new Date().toISOString();
  result.targetImageIds = targetImageIds;
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-AC24-candidate-integrity-live.json', JSON.stringify(result, null, 2) + '\n');
}
process.stdout.write(JSON.stringify({ verdict: result.verdict, candidateId, candidateArtifactDigest: result.candidateArtifactDigestBefore, assertions: result.assertions, cleanup: result.deploymentCleanupStatus, workingCopyRestored: result.workingCopyRestored }) + '\n');
assert.equal(result.verdict, 'passed', result.failure ?? 'AC24_LIVE_FAILED');
