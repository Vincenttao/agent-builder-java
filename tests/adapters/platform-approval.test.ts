import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { MockRepository } from '../../apps/mock-services/src/repository.js';
import { createMockApp } from '../../apps/mock-services/src/app.js';
import { createApp } from '../../apps/server/src/app.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { RunService } from '../../apps/server/src/runs/run-service.js';
import { HttpMock, HttpRunner } from '../../apps/server/src/runs/http-ports.js';
import { PostgresActions } from '../../apps/server/src/actions/postgres-actions.js';
import { ActionService } from '../../apps/server/src/actions/action-service.js';
import { JavaDeploymentManager } from '../../apps/runner/src/runtime/deployment-manager.js';
import { ExecutionJournal } from '../../apps/runner/src/executions/journal.js';
import { createRunnerApp } from '../../apps/runner/src/app.js';
import { draftInput } from '../support/fixtures.js';
import type { RunRecord } from '../../packages/contracts/src/runs.js';
import type { ActionRecord } from '../../packages/contracts/src/actions.js';

let modelCalls = 0;
const model = createServer(async (req, res) => {
  let body = ''; for await (const bytes of req) body += bytes;
  modelCalls++; const request = JSON.parse(body) as { messages: { role: string; name?: string; tool_call_id?: string }[] };
  const read = request.messages.some(m => m.role === 'tool' && m.tool_call_id === 'call-read');
  const written = request.messages.some(m => m.role === 'tool' && m.tool_call_id === 'call-write');
  const message = written ? { role: 'assistant', content: '模拟工单已完成，请查看外部工单记录。' } : {
    role: 'assistant', content: read ? '设备温度 86°C，建议创建检查工单。' : '查询设备状态',
    tool_calls: [{ id: read ? 'call-write' : 'call-read', type: 'function', function: {
      name: read ? 'create_work_order' : 'get_equipment', arguments: JSON.stringify(read ? { equipmentId: 'PUMP-001', description: '检查温度告警', priority: 'normal' } : { equipmentId: 'PUMP-001' })
    } }]
  };
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'approval-fixture', model: 'fixture', choices: [{ index: 0, message, finish_reason: written ? 'stop' : 'tool_calls' }] }));
});
const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const suffix = randomUUID().replaceAll('-', ''); const schema = `it_approval_${suffix}`; const mockSchema = `it_approval_mock_${suffix}`;
const admin = new Pool({ connectionString: url }); const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const mockPool = new Pool({ connectionString: url, options: `-c search_path=${mockSchema}` });
let offset = 0; const clock = { now: () => new Date(Date.now() + offset).toISOString() }; const ids = { next: randomUUID };
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids);
const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids);
const actions = new PostgresActions(pool, clock); const mockRepository = new MockRepository(mockPool);
const mockApp = createMockApp({ repository: mockRepository, controlToken: 'mock-control-test-01234567890123', businessToken: 'mock-service-test-01234567890123' });
const root = resolve('test-results', `approval-${Date.now()}`);
let platform: ReturnType<typeof createApp>; let runnerApp: ReturnType<typeof createRunnerApp>; let runtime: JavaDeploymentManager; let runs: RunService;
let headers: Record<string, string>; let nextFault: 'normal' | 'write-after-timeout' = 'normal';
beforeAll(async () => {
  await mkdir(root, { recursive: true }); await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`CREATE SCHEMA "${mockSchema}"`);
  await migrate(pool); await migrate(mockPool, 'db/mock-migrations');
  await new Promise<void>(r => model.listen(0, '127.0.0.1', r)); const address = model.address(); if (!address || typeof address === 'string') throw new Error('MODEL_PORT');
  const mockBase = await mockApp.listen({ host: '127.0.0.1', port: 0 });
  class FaultControlledMock extends HttpMock {
    override async prepare(environmentId: string, runId: string) {
      // Test-only fault selection through the same authenticated Mock control API.
      const path = `${mockBase}/control/environments/${environmentId}`; const auth = { authorization: 'Bearer mock-control-test-01234567890123', 'content-type': 'application/json' };
      const created = await fetch(path, { method: 'PUT', headers: auth, body: JSON.stringify({ seed: 'enterprise-default@1', fault: nextFault, clock: '2026-10-21T08:00:00.000Z' }) });
      if (!created.ok) throw new Error('MOCK_CREATE_FAILED');
      const reserved = await fetch(`${path}/reserve`, { method: 'POST', headers: auth, body: JSON.stringify({ runId }) }); if (!reserved.ok) throw new Error('MOCK_RESERVE_FAILED');
    }
  }
  const mock = new FaultControlledMock(mockBase, 'mock-control-test-01234567890123', 'mock-service-test-01234567890123');
  const writeService = new ActionService(actions, mock);
  let runnerPort: HttpRunner; const port = new Proxy({} as HttpRunner, { get: (_target, key) => { const value = runnerPort[key as keyof HttpRunner]; return typeof value === 'function' ? value.bind(runnerPort) : value; } });
  runs = new RunService(pool, snapshots, port, mock, actions, writeService);
  platform = createApp({ drafts, snapshots, runs, actions, now: clock.now, bootstrapToken: 'bootstrap-platform-test-0123456789', origin: 'http://127.0.0.1:8080', modelConfigured: true, databaseReady: async () => true,
    toolProxy: { token: 'proxy-platform-test-0123456789', context: id => runs.context(id), invoke: mock.invoke.bind(mock), write: writeService.invoke.bind(writeService) } });
  const base = await platform.listen({ host: '127.0.0.1', port: 0 });
  runtime = new JavaDeploymentManager({ root: resolve(root, 'runner'), artifactPath: resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'), modelKey: 'fixture-key', modelBase: `http://127.0.0.1:${address.port}/v1`, proxyBase: `${base}/internal/tool-proxy`, proxyToken: 'proxy-platform-test-0123456789' });
  await runtime.initialize(); const journal = new ExecutionJournal(resolve(root, 'executions'), runtime); await journal.initialize();
  runnerApp = createRunnerApp({ token: 'runner-control-test-0123456789', runtime, journal, modelConfigured: true }); runnerPort = new HttpRunner(await runnerApp.listen({ host: '127.0.0.1', port: 0 }), 'runner-control-test-0123456789');
  const login = await platform.inject({ method: 'POST', url: '/api/auth/session', headers: { origin: 'http://127.0.0.1:8080' }, payload: { token: 'bootstrap-platform-test-0123456789' } });
  headers = { origin: 'http://127.0.0.1:8080', cookie: login.headers['set-cookie']!.toString().split(';')[0]!, 'x-csrf-token': login.json().csrfToken as string };
});
afterAll(async () => {
  await runtime?.shutdown(); await runnerApp?.close(); await platform?.close(); await mockApp.close(); await new Promise<void>(r => model.close(() => r()));
  await pool.end(); await mockPool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.query(`DROP SCHEMA "${mockSchema}" CASCADE`); await admin.end();
});
async function until(runId: string, statuses: string[]) {
  const deadline = Date.now() + 65_000; let record = await runs.get(runId);
  while (!statuses.includes(record.status) && Date.now() < deadline) { await runs.tick(); record = await runs.get(runId); if (!statuses.includes(record.status)) await new Promise(r => setTimeout(r, 150)); }
  expect(statuses, JSON.stringify(record)).toContain(record.status); return record;
}
for (const outcome of ['approve','reject','expire','timeout'] as const) it(`native approval via platform API: ${outcome}`, async () => {
  nextFault = outcome === 'timeout' ? 'write-after-timeout' : 'normal'; const before = modelCalls;
  const created = await platform.inject({ method: 'POST', url: '/api/drafts', headers, payload: { ...draftInput, brief: { ...draftInput.brief, output: { ...draftInput.brief.output, confirmed: true } } } });
  expect(created.statusCode).toBe(201);
  const snapshot = await platform.inject({ method: 'POST', url: `/api/drafts/${created.json().id}/snapshots`, headers, payload: { expectedRevision: 1, assembly: { agentType: 'DeepAgent', systemPrompt: '查询设备并申请工单', maxIterations: 5, railIds: ['audit@1','tool-allowlist@1','write-confirm@1'], toolIds: ['equipment-status@1','work-order-create@1'] } } });
  expect(snapshot.statusCode, snapshot.body).toBe(201);
  const started = await platform.inject({ method: 'POST', url: `/api/snapshots/${snapshot.json().id}/runs`, headers, payload: { clientRequestId: randomUUID(), input: '查询 PUMP-001 并申请检查工单' } });
  expect(started.statusCode, started.body).toBe(202); const run = started.json<RunRecord>();
  const waiting = await until(run.id, ['waiting_confirmation']);
  expect(JSON.stringify(waiting.result)).toContain('86'); expect(modelCalls - before).toBe(2);
  const pending = await platform.inject({ url: `/api/runs/${run.id}/actions`, headers }); expect(pending.statusCode, pending.body).toBe(200);
  const action = pending.json<{ items: ActionRecord[] }>().items[0]!; expect(action.status).toBe('pending');
  expect((await mockRepository.calls(run.environmentId)).filter(c => c.operation === 'work-order-create')).toHaveLength(0);
  const decisionUrl = `/api/runs/${run.id}/actions/${action.id}/decision`;
  expect((await platform.inject({ method: 'POST', url: decisionUrl, headers: { origin: headers.origin!, cookie: headers.cookie! }, payload: { decisionId: randomUUID(), actionHash: action.actionHash, decision: 'approve' } })).statusCode).toBe(403);
  if (outcome === 'expire') offset += 300_001;
  const decide = () => platform.inject({ method: 'POST', url: decisionUrl, headers, payload: { decisionId: randomUUID(), actionHash: action.actionHash, decision: outcome === 'reject' ? 'reject' : 'approve' } });
  const decisions = await Promise.all([decide(), decide()]); for (const response of decisions) expect(response.statusCode, response.body).toBe(outcome === 'expire' ? 409 : 200);
  const finished = await until(run.id, [outcome === 'reject' || outcome === 'expire' ? 'cancelled' : 'succeeded']);
  const calls = await mockRepository.calls(run.environmentId); const state = (await mockRepository.get(run.environmentId)).state;
  const writes = outcome === 'approve' || outcome === 'timeout' ? 1 : 0;
  expect(calls.filter(c => c.operation === 'equipment-status')).toHaveLength(1);
  expect(calls.filter(c => c.operation === 'work-order-create')).toHaveLength(writes); expect(Object.keys(state.workOrders ?? {})).toHaveLength(writes);
  expect(modelCalls - before).toBe(writes ? 3 : 2); if (!writes) expect(JSON.stringify(finished.result)).toContain('86');
  if (outcome === 'timeout') expect(calls.filter(c => c.operation === 'work-order-by-key')).toHaveLength(1);
  expect((await runtime.get(run.deploymentId)).status).toBe('stopped');
  await writeFile(resolve(root, `${outcome}.json`), JSON.stringify({ modelMode: 'deterministic-fixture', run: finished, action: await actions.get(action.id), attempts: await actions.attempts(action.id), events: await runs.events(run.id, 0), calls, state }, null, 2));
});
