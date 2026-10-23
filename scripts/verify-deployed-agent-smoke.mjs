import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const base = (process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const origin = process.env.APP_ORIGIN ?? base;
if (!process.env.LOCAL_BOOTSTRAP_TOKEN) throw new Error('LOCAL_BOOTSTRAP_TOKEN_REQUIRED');

const login = await fetch(`${base}/api/auth/session`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' },
  body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN })
});
if (!login.ok) throw new Error(`LOGIN_FAILED_${login.status}`);
const csrf = (await login.json()).csrfToken;
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
if (!csrf || !cookie) throw new Error('LOGIN_RESPONSE_INVALID');
const managementHeaders = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
const request = async (path, method = 'GET', body, authorization) => {
  const headers = authorization ? { authorization } : method === 'GET' ? { cookie } : managementHeaders;
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`API_${method}_${response.status}_${path}`);
  return response.status === 204 ? null : response.json();
};

let grant;
try {
  const environment = await request('/api/environment');
  if (!environment.canRun || environment.blockers.length) throw new Error('ENVIRONMENT_NOT_RUNNABLE');
  const { items: drafts } = await request('/api/drafts');
  const overviews = await Promise.all(drafts.map(async draft => ({ draftId: draft.id, overview: await request(`/api/drafts/${draft.id}/releases`) })));
  const target = overviews.map(({draftId,overview}) => {
    const version=overview.versions.find(item => item.id === overview.pointer?.versionId);
    return overview.pointer?.versionId&&version?{draftId,pointer:overview.pointer,version}:undefined;
  }).find(Boolean);
  if (!target) throw new Error('PUBLISHED_AGENT_NOT_FOUND');

  grant = await request('/api/demo-sessions', 'POST', { agentId: target.draftId, actorId: 'U1001' });
  const authorization = `Bearer ${grant.token}`;
  const submitted = await request(`/agent-api/agents/${target.draftId}/messages`, 'POST', {
    clientRequestId: randomUUID(), input: '查询 PUMP-001 的状态、温度和数据来源。'
  }, authorization);
  let view = submitted;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    view = await request(`/agent-api/requests/${submitted.requestId}`, 'GET', undefined, authorization);
    if (view.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(view.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (view.run?.status !== 'succeeded') throw new Error(`BUSINESS_SMOKE_${view.run?.status ?? 'TIMEOUT'}`);
  if (view.agentVersion !== target.pointer.versionId || view.run.artifactDigest !== target.version.reference.binding.artifactDigest) {
    throw new Error('RELEASED_ARTIFACT_MISMATCH');
  }
  if (!Array.isArray(view.run.externalEvidence) || view.run.externalEvidence.length < 1) throw new Error('MOCK_EXTERNAL_EVIDENCE_MISSING');
  const events = await request(`/agent-api/requests/${submitted.requestId}/events`, 'GET', undefined, authorization);
  const record = {
    schemaVersion: 1, verifiedAt: new Date().toISOString(), baseUrl: base,
    environment: { database: environment.database, runtime: environment.runtime, canRun: environment.canRun },
    draftId: target.draftId, versionId: target.pointer.versionId,
    deploymentId: target.pointer.deploymentId, artifactDigest: view.run.artifactDigest,
    requestId: view.requestId, runId: view.runId, status: view.run.status,
    externalEvidenceCount: view.run.externalEvidence.length,
    eventCount: events.items.length,
    eventTypes: [...new Set(events.items.map(item => item.type ?? item.event?.type).filter(Boolean))],
    resultDigest: await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(view.run.result)))
  };
  record.resultDigest = Buffer.from(record.resultDigest).toString('hex');
  await mkdir('docs/implementation/evidence', { recursive: true });
  const file = 'docs/implementation/evidence/TD15-deployed-agent-smoke.json';
  await writeFile(file, JSON.stringify(record, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ status: 'passed', evidence: file, runId: record.runId, versionId: record.versionId,
    externalEvidenceCount: record.externalEvidenceCount, eventCount: record.eventCount }, null, 2) + '\n');
} finally {
  if (grant?.token) {
    // Demo credentials are short-lived; no long-lived business credential is stored.
  }
  await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: managementHeaders }).catch(() => {});
}
