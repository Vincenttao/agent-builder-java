import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { MockRepository } from '../../apps/mock-services/src/repository.js';
import { createMockApp } from '../../apps/mock-services/src/app.js';
import { createApp } from '../../apps/server/src/app.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { RunService } from '../../apps/server/src/runs/run-service.js';
import { HttpRunner, HttpMock } from '../../apps/server/src/runs/http-ports.js';
import { PostgresActions } from '../../apps/server/src/actions/postgres-actions.js';
import { ActionService } from '../../apps/server/src/actions/action-service.js';
import { JavaDeploymentManager } from '../../apps/runner/src/runtime/deployment-manager.js';
import { ExecutionJournal } from '../../apps/runner/src/executions/journal.js';
import { createRunnerApp } from '../../apps/runner/src/app.js';
import { BaselineService } from '../../apps/server/src/acceptance/application/baseline-service.js';
import { ValidationService } from '../../apps/server/src/acceptance/application/validation-service.js';
import { RunValidationDriver } from '../../apps/server/src/acceptance/adapters/run-validation-driver.js';
import { equipmentAssembly } from '../../packages/contracts/src/equipment-template.js';
import { draftInput } from '../support/fixtures.js';

const facts = { kind: 'equipment-report', equipmentId: 'PUMP-001', status: 'warning', temperatureCelsius: 86, source: 'seed-equipment-001@1', recommendation: '检查设备温度' };
const model = createServer(async (req, res) => {
  let body = ''; for await (const bytes of req) body += bytes;
  const request = JSON.parse(body) as { messages: { role: string; content?: unknown }[] };
  const user = request.messages.find(m => m.role === 'user'); const tool = request.messages.find(m => m.role === 'tool');
  const missing = !JSON.stringify(user?.content).includes('PUMP-001');
  const failed = tool && !JSON.stringify(tool.content).includes('86');
  const message = missing || tool ? { role: 'assistant', content: JSON.stringify(missing ? { kind: 'clarification', missingFields: ['equipmentId'], message: '请提供设备编号' } : failed ? { kind: 'tool-error', code: 'TOOL_UNAVAILABLE', message: '工具超时，状态未知' } : facts) } : {
    role: 'assistant', content: '', tool_calls: [{ id: 'read-equipment', type: 'function', function: { name: 'get_equipment', arguments: '{"equipmentId":"PUMP-001"}' } }]
  };
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'validation-fixture', model: 'fixture', choices: [{ index: 0, message, finish_reason: missing || tool ? 'stop' : 'tool_calls' }] }));
});
const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const suffix = randomUUID().replaceAll('-', ''); const schema = `it_validation_runtime_${suffix}`; const mockSchema = `it_validation_mock_${suffix}`;
const admin = new Pool({ connectionString: url }); const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const mockPool = new Pool({ connectionString: url, options: `-c search_path=${mockSchema}` });
const clock = { now: () => new Date().toISOString() }; const ids = { next: randomUUID };
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids);
const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids); const baselines = new BaselineService(pool, clock, ids);
const actions = new PostgresActions(pool); const mockRepository = new MockRepository(mockPool);
const controlToken = 'mock-control-test-01234567890123'; const businessToken = 'mock-service-test-01234567890123';
const mockApp = createMockApp({ repository: mockRepository, controlToken, businessToken });
const root = resolve('test-results', `project-validation-${Date.now()}`);
let platform: ReturnType<typeof createApp>; let runnerApp: ReturnType<typeof createRunnerApp>; let runtime: JavaDeploymentManager; let runs: RunService; let validations: ValidationService;
let headers: Record<string, string>;
beforeAll(async () => {
  await mkdir(root, { recursive: true }); await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`CREATE SCHEMA "${mockSchema}"`);
  await migrate(pool); await migrate(mockPool, 'db/mock-migrations');
  await new Promise<void>(r => model.listen(0, '127.0.0.1', r)); const address = model.address(); if (!address || typeof address === 'string') throw new Error('MODEL_PORT');
  const mockBase = await mockApp.listen({ host: '127.0.0.1', port: 0 }); const mock = new HttpMock(mockBase, controlToken, businessToken); const writes = new ActionService(actions, mock);
  let runnerPort: HttpRunner; const port = new Proxy({} as HttpRunner, { get: (_target, key) => { const value = runnerPort[key as keyof HttpRunner]; return typeof value === 'function' ? value.bind(runnerPort) : value; } });
  runs = new RunService(pool, snapshots, port, mock, actions, writes); validations = new ValidationService(pool, baselines, snapshots, new RunValidationDriver(runs, mock, actions), clock);
  platform = createApp({ drafts, snapshots, baselines, runs, actions, validations, now: clock.now, bootstrapToken: 'bootstrap-platform-test-0123456789', origin: 'http://127.0.0.1:8080', modelConfigured: true, databaseReady: async () => true,
    toolProxy: { token: 'proxy-platform-test-0123456789', context: id => runs.context(id), invoke: mock.invoke.bind(mock), write: writes.invoke.bind(writes) } });
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
it('executes all baseline cases through the real JVM and normal platform APIs, retaining external evidence', async () => {
  const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { value: '结构化设备报告', source: 'user', confirmed: true } } });
  const preview = await baselines.preview(draft.id, 'equipment-read@1');
  const baseline = await baselines.confirm(draft.id, { expectedRevision: 1, templateId: 'equipment-read@1', confirmed: true, expectedDigest: preview.digest });
  const snapshot = await snapshots.create(draft.id, { expectedRevision: 1, assembly: equipmentAssembly() });
  const path = `/api/snapshots/${snapshot.id}/validations`; const payload = { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: false };
  expect((await platform.inject({ method: 'POST', url: path, payload })).statusCode).toBe(403);
  expect((await platform.inject({ method: 'POST', url: path, headers, payload: { ...payload, verdict: 'passed' } })).statusCode).toBe(400);
  const started = await platform.inject({ method: 'POST', url: path, headers, payload }); expect(started.statusCode, started.body).toBe(202);
  const id = started.json().id as string; const deadline = Date.now() + 120_000;
  while ((await validations.get(id)).status !== 'completed' && Date.now() < deadline) { await validations.tick(); await runs.tick(); await new Promise(r => setTimeout(r, 150)); }
  const execution = await validations.get(id); await writeFile(resolve(root, 'execution.json'), JSON.stringify(execution, null, 2));
  const reportResponse = await platform.inject({ url: `/api/validations/${id}/report`, headers }); expect(reportResponse.statusCode, reportResponse.body).toBe(200);
  const report = await validations.report(id); const evidence = await Promise.all(report.cases.map(c => c.evidenceId ? validations.evidence(id, c.evidenceId) : null));
  await writeFile(resolve(root, 'report.json'), JSON.stringify({ report, evidence }, null, 2));
  expect(report.cases.map(c => c.status), JSON.stringify(report)).toEqual(['passed','passed','passed']);
  expect(report.verdict).toBe('unverified'); expect(report.reasons).toEqual(['REAL_MODEL_REQUIRED']);
  expect(evidence[0]!.calls).toHaveLength(1); expect(evidence[1]!.calls).toHaveLength(0); expect(evidence[2]!.calls.length).toBeGreaterThan(0);
  for (const item of execution.cases) { const run = await runs.get(item.runId); expect(run.modelProfile?.digest).toBe(report.binding.modelProfile.digest); expect((await runtime.get(run.deploymentId)).status).toBe('stopped'); }
}, 150_000);
