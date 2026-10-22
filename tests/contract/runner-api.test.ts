import { expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRunnerApp } from '../../apps/runner/src/app.js';
import { ExecutionJournal } from '../../apps/runner/src/executions/journal.js';

it('rejects deployment stop while any session still has an active execution', async () => {
  let finish!: (value: unknown) => void; let stops = 0; let called = false;
  const id = randomUUID(); const token = 'runner-control-test-token-32-characters'; const root = await mkdtemp(join(tmpdir(), 'runner-shared-stop-'));
  const runtime = { artifactDigest: 'a'.repeat(64), bootId: randomUUID(), start: async () => ({ status: 'ready' }), get: async () => ({ status: 'ready' }),
    query: async () => { called = true; return new Promise(r => { finish = r; }); }, events: async () => [], cancelSession: async () => ({ status: 'cancelling' as const }),
    stop: async () => { stops++; return { status: 'stopped' }; }, retire: async()=>{stops++;return{status:'stopped' as const};} };
  const journal = new ExecutionJournal(root, runtime); await journal.initialize();
  const app = createRunnerApp({ token, runtime: runtime as unknown as Parameters<typeof createRunnerApp>[0]['runtime'], journal, modelConfigured: true });
  const headers = { authorization: `Bearer ${token}` }; const executionId = randomUUID();
  try {
    await journal.begin(executionId, { deploymentId: id, sessionId: executionId, message: 'wait' }); await expect.poll(() => called).toBe(true);
    const blocked = await app.inject({ method: 'POST', url: `/deployments/${id}/stop`, headers, payload: {} });
    expect(blocked.statusCode).toBe(409); expect(blocked.json().code).toBe('DEPLOYMENT_HAS_ACTIVE_EXECUTIONS'); expect(stops).toBe(0);
    expect((await app.inject({method:'POST',url:`/deployments/${id}/retire`,headers,payload:{}})).statusCode).toBe(409);expect(stops).toBe(0);
    finish({ done: true }); await expect.poll(async () => (await journal.get(executionId)).status).toBe('succeeded');
    expect((await app.inject({ method: 'POST', url: `/deployments/${id}/stop`, headers, payload: {} })).statusCode).toBe(200); expect(stops).toBe(1);
    expect((await app.inject({method:'POST',url:`/deployments/${id}/retire`,headers,payload:{}})).statusCode).toBe(200);expect(stops).toBe(2);
  } finally { finish?.({ cleanup: true }); await journal.drain(); await app.close(); }
});

it('Runner authenticates commands, rejects arbitrary options and preserves idempotent execution results', async () => {
  let starts = 0; let calls = 0;
  const root = await mkdtemp(join(tmpdir(), 'runner-http-'));
  const record = { id: randomUUID(), bootId: randomUUID(), status: 'ready' as const, artifactDigest: 'a'.repeat(64), specDigest: 'b'.repeat(64), createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' };
  const runtime = { artifactDigest: record.artifactDigest, bootId: record.bootId,
    start: async () => { starts++; return record; }, get: async () => record, stop: async () => ({ ...record, status: 'stopped' as const }), retire:async()=>({status:'stopped' as const}),
    query: async () => { calls++; return { result: { content: 'actual test fixture output' } }; }, events: async () => [], cancelSession: async () => ({ status: 'cancelled' as const }) };
  const journal = new ExecutionJournal(root, runtime); await journal.initialize();
  const token = 'runner-control-test-token-32-characters';
  const app = createRunnerApp({ token, runtime, journal, modelConfigured: true });
  const headers = { authorization: `Bearer ${token}` };
  const body = { artifactDigest: record.artifactDigest, spec: { agent: { id: 'test', type: 'DeepAgent', systemPrompt: 'test', maxIterations: 4, rails: ['audit', 'tool-allowlist'] }, tools: [] } };
  try {
    expect((await app.inject({ method: 'PUT', url: `/deployments/${record.id}`, payload: body })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: `/deployments/${record.id}`, headers, payload: { ...body, command: 'arbitrary-shell', directory: '../escape', modelKey: 'forged' } })).statusCode).toBe(400);
    expect(starts).toBe(0);
    expect((await app.inject({ method: 'PUT', url: `/deployments/${record.id}`, headers, payload: body })).statusCode).toBe(201);
    const id = randomUUID(); const input = { deploymentId: record.id, sessionId: randomUUID(), message: 'query',fencingToken:'1' };
    const {fencingToken,...unclaimed}=input;
    expect((await app.inject({method:'PUT',url:`/executions/${id}`,headers,payload:unclaimed})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:`/executions/${id}/claim`,headers,payload:{fencingToken:'1'}})).statusCode).toBe(200);
    await Promise.all([1, 2].map(() => app.inject({ method: 'PUT', url: `/executions/${id}`, headers, payload: input })));
    await expect.poll(async () => (await app.inject({ url: `/executions/${id}`, headers })).json().status).toBe('succeeded');
    expect(calls).toBe(1);
    expect((await app.inject({ method: 'PUT', url: `/executions/${id}`, headers, payload: { ...input, message: 'changed' } })).statusCode).toBe(409);
    const restored = await app.inject({ url: `/executions/${id}`, headers });
    expect(restored.json().result.result.content).toBe('actual test fixture output');
    expect(restored.body).not.toContain(token);
    const cancelled=randomUUID();await app.inject({method:'POST',url:`/executions/${cancelled}/claim`,headers,payload:{fencingToken:'2'}});
    expect((await app.inject({method:'POST',url:`/executions/${cancelled}/cancel`,headers,payload:{fencingToken:'2'}})).json().status).toBe('cancelled');
    expect((await app.inject({method:'PUT',url:`/executions/${cancelled}`,headers,payload:input})).json().code).toBe('EXECUTION_CLAIM_LOST');
    expect((await app.inject({method:'PUT',url:`/executions/${cancelled}`,headers,payload:{...input,fencingToken:'2'}})).json().code).toBe('EXECUTION_RETIRED');expect(calls).toBe(1);
  } finally { await journal.drain(); await app.close(); }
});
