import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const project = process.env.NF01_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.NF01_BASE_URL ?? 'http://127.0.0.1:18080';
const origin = process.env.NF01_ORIGIN ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';
assert.ok(process.env.LOCAL_BOOTSTRAP_TOKEN, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).trim();
const active = JSON.parse(await readFile('docs/implementation/evidence/TD15-NF01-active-write-restart.json', 'utf8'));
const containers = compose('ps', '-q', 'app', 'runner').split(/\r?\n/).filter(Boolean);
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(targetImageIds, active.targetImageIds, 'EQ02_TARGET_CHANGED');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
const session = await login.json();
const headers = { origin, cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' };
const requestId = randomUUID();
let mockStopped = false;
let result;
let startedRunId;
let observedEvents = [];
try {
  const response = await fetch(`${base}/api/snapshots/${active.snapshotId}/runs`, { method: 'POST', headers, body: JSON.stringify({ clientRequestId: requestId, input: '请查询 PUMP-001 的状态、温度和来源。' }) });
  assert.equal(response.status, 202, `EQ02_RUN_NOT_ACCEPTED:${response.status}`);
  const started = await response.json();
  startedRunId = started.id;
  // Wait until the runtime has started its model turn, then stop Mock before the model can issue the read.
  let readyForFault = false;
  const faultDeadline = Date.now() + 60000;
  while (Date.now() < faultDeadline) {
    const [runResponse, eventsResponse] = await Promise.all([
      fetch(`${base}/api/runs/${started.id}`, { headers: { origin, cookie } }),
      fetch(`${base}/api/runs/${started.id}/events`, { headers: { origin, cookie } })
    ]);
    assert.equal(runResponse.status, 200);
    assert.equal(eventsResponse.status, 200);
    const run = await runResponse.json();
    const events = (await eventsResponse.json()).items ?? [];
    observedEvents = events.filter(item => item.type === 'runtime.event').map(item => item.data?.event);
    readyForFault = run.status === 'running' && events.some(item => item.type === 'runtime.event'
      && item.data?.event?.event === 'before_model_call');
    if (readyForFault) break;
    if (['failed', 'cancelled', 'interrupted'].includes(run.status)) throw new Error(`EQ02_RUN_TERMINATED_BEFORE_TOOL:${run.status}:${run.diagnostic ?? ''}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(readyForFault, 'EQ02_PRE_TOOL_EVENT_NOT_OBSERVED');
  compose('kill', 'mock-services'); mockStopped = true;
  let run;
  let toolCallFailed = false;
  // The model turn can take longer than one minute. Keep the fault injected until
  // the tool failure is observed, rather than restarting Mock before the call.
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const [read, eventRead] = await Promise.all([
      fetch(`${base}/api/runs/${started.id}`, { headers: { origin, cookie } }),
      fetch(`${base}/api/runs/${started.id}/events`, { headers: { origin, cookie } })
    ]);
    assert.equal(read.status, 200);
    assert.equal(eventRead.status, 200);
    run = await read.json();
    const events = (await eventRead.json()).items ?? [];
    toolCallFailed = events.some(item => item.type === 'runtime.event' && item.data?.event?.event === 'tool_call'
      && item.data?.event?.tool === 'get_equipment' && item.data?.event?.status === 'failed');
    if (toolCallFailed) {
      compose('start', 'mock-services'); mockStopped = false;
      break;
    }
    if (['failed', 'cancelled', 'interrupted'].includes(run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(toolCallFailed, 'EQ02_FAILED_TOOL_CALL_EVIDENCE_MISSING');
  const settleDeadline = Date.now() + 30000;
  while (Date.now() < settleDeadline && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run?.status)) {
    const response = await fetch(`${base}/api/runs/${started.id}`, { headers: { origin, cookie } });
    assert.equal(response.status, 200);
    run = await response.json();
    if (!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)) await new Promise(resolve => setTimeout(resolve, 250));
  }
  const content = run?.result?.result?.content;
  let toolError;
  try { toolError = JSON.parse(content); } catch { toolError = null; }
  assert.equal(run?.status, 'succeeded', `EQ02_RUN_NOT_RECOVERED:${run?.status}:${run?.diagnostic}`);
  assert.equal(toolError?.kind, 'tool-error', 'EQ02_TOOL_ERROR_NOT_RETURNED');
  assert.equal(toolError?.code, 'TOOL_UNAVAILABLE');
  assert.equal(run.externalEvidence?.length ?? 0, 0, 'EQ02_UNAVAILABLE_TOOL_MUST_NOT_FABRICATE_EVIDENCE');
  result = {
    schemaVersion: 1, requirement: 'TD-15 P0-A EQ-02 tool unavailable during live read', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project,
    targetImageIds, appImageId: targetImageIds[0], runnerImageId: targetImageIds[1], candidateId: active.candidateId, artifactDigest: active.candidateArtifactDigest,
    snapshotId: active.snapshotId, runId: started.id, runStatus: run.status, diagnostic: run.diagnostic, toolError, externalEvidenceCount: run.externalEvidence?.length ?? 0,
    faultInjection: { service: 'mock-services', action: 'SIGKILL after model turn began; restarted immediately after failed Tool evidence' },
    verdict: 'passed', branches: [{ caseId: 'EQ-02', branchId: 'tool-unavailable', status: 'passed', assertions: [
      { name: 'run_returns_structured_unknown_fact_error', passed: run.status === 'succeeded' && toolError.kind === 'tool-error' && toolError.code === 'TOOL_UNAVAILABLE' },
      { name: 'no_business_facts_emitted', passed: run.externalEvidence?.length === 0 }
    ] }]
  };
} catch (error) {
  result = { schemaVersion: 1, requirement: 'TD-15 P0-A EQ-02 tool unavailable during live read', executionMode: 'live-mock', measuredAt: new Date().toISOString(), composeProject: project, targetImageIds, runId: startedRunId, observedEvents, verdict: 'failed', failure: String(error?.stack ?? error) };
} finally {
  if (mockStopped) compose('start', 'mock-services');
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    try { if ((await fetch('http://127.0.0.1:18080/health/ready')).ok && compose('ps', '--status', 'running', '-q', 'mock-services')) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers }).catch(() => {});
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile('docs/implementation/evidence/TD15-EQ02-tool-unavailable-live.json', JSON.stringify(result, null, 2) + '\n');
}
assert.equal(result.verdict, 'passed', result.failure ?? 'EQ02_TOOL_UNAVAILABLE_FAILED');
console.log(JSON.stringify({ verdict: result.verdict, runStatus: result.runStatus, toolError: result.toolError?.code, externalEvidenceCount: result.externalEvidenceCount }));
