import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { BaselineService } from '../../apps/server/src/acceptance/application/baseline-service.js';
import { ValidationService, type ValidationDriver } from '../../apps/server/src/acceptance/application/validation-service.js';
import { RunValidationDriver } from '../../apps/server/src/acceptance/adapters/run-validation-driver.js';
import { RunService, type RunRuntime } from '../../apps/server/src/runs/run-service.js';
import { HttpMock } from '../../apps/server/src/runs/http-ports.js';
import { PostgresActions } from '../../apps/server/src/actions/postgres-actions.js';
import { runtimeModelProfile } from '../../apps/runner/src/runtime/model-profile.js';
import { equipmentAssembly, workOrderAssembly } from '../../packages/contracts/src/equipment-template.js';
import { draftInput } from '../support/fixtures.js';
const schema = `it_validation_admission_${randomUUID().replaceAll('-', '')}`;
const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin = new Pool({ connectionString: url }); const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const clock = { now: () => new Date().toISOString() }; const ids = { next: randomUUID }; const profile = runtimeModelProfile('http://127.0.0.1:1/v1');
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids); const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids);
const baselines = new BaselineService(pool, clock, ids); const actions = new PostgresActions(pool);
beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
afterEach(async () => {
  // Fixture isolation only: no real process is launched by these tests.
  await pool.query("UPDATE validation_executions SET record=record || '{\"status\":\"completed\"}'::jsonb WHERE record->>'status'<>'completed'");
  await pool.query("UPDATE runs SET record=record || '{\"status\":\"cancelled\",\"cancelRequested\":true}'::jsonb WHERE record->>'status' NOT IN ('succeeded','failed','cancelled','interrupted')");
});
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; };
async function setup(write = false) {
  const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { value: '设备报告', source: 'user', confirmed: true } } });
  const templateId = write ? 'equipment-workorder@1' : 'equipment-read@1'; const preview = await baselines.preview(draft.id, templateId);
  const baseline = await baselines.confirm(draft.id, { expectedRevision: 1, templateId, expectedDigest: preview.digest, confirmed: true });
  const snapshot = await snapshots.create(draft.id, { expectedRevision: 1, assembly: write ? workOrderAssembly() : equipmentAssembly() });
  let beforeReady: (() => Promise<void>) | undefined;
  const runtime: RunRuntime = {
    claim:async()=>{},retire:async()=>({status:'stopped'}),
    capabilities: async () => { await beforeReady?.(); return { artifactDigest: 'a'.repeat(64), modelProfile: profile, modelConfigured: true, executionMode: 'trusted-local', bootId: 'fixture' }; },
    deploy: async () => ({ status: 'ready' }), begin: async id => ({ id, status: 'running', events: [] }), execution: async () => null,
    cancel: async id => ({ id, status: 'cancelled', events: [] }), events: async () => [], stop: async () => ({ status: 'stopped' })
  };
  const mock = new HttpMock('http://127.0.0.1:1', 'test-control-0123456789012345', 'test-business-0123456789012345'); mock.ready = async () => true;
  const runs = new RunService(pool, snapshots, runtime, mock, actions); const actual = new RunValidationDriver(runs, mock, actions);
  const driver: ValidationDriver = { identity: async () => ({ artifactDigest: 'a'.repeat(64), modelProfile: profile, mockDigest: 'b'.repeat(64) }), advance: actual.advance.bind(actual), cancel: actual.cancel.bind(actual) };
  const service = () => new ValidationService(pool, baselines, snapshots, driver, clock);
  const worker = service(); const record = await worker.start(snapshot.id, { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: write });
  return { worker, service, record, runs, block: (fn?: () => Promise<void>) => { beforeReady = fn; } };
}
it('accepted cancellation prevents a delayed worker from admitting a new Run', async () => {
  const h = await setup(); const entered = deferred(); const release = deferred(); h.block(async () => { entered.resolve(); await release.promise; });
  const work = h.worker.tick(); await entered.promise; await h.worker.cancel(h.record.id); release.resolve(); await work;
  expect((await pool.query('SELECT id FROM runs WHERE snapshot_id=$1', [h.record.snapshotId])).rowCount).toBe(0);
  for (let i = 0; i < 4; i++) await h.service().tick(); expect((await h.worker.report(h.record.id)).verdict).toBe('unverified');
});
it('a stale worker error cannot cancel a Run admitted by the new lease owner', async () => {
  const h = await setup(); const entered = deferred(); const release = deferred(); let first = true;
  h.block(async () => { if (first) { first = false; entered.resolve(); await release.promise; throw new Error('OLD_WORKER_DEPENDENCY_FAILURE'); } });
  const oldWork = h.worker.tick(); await entered.promise;
  await pool.query("UPDATE validation_executions SET lease_until=now()-interval '1 second' WHERE id=$1", [h.record.id]);
  await h.service().tick(); release.resolve(); await oldWork;
  const run = await h.runs.get(h.record.cases[0]!.runId); expect(run.status).toBe('queued'); expect(run.cancelRequested).toBe(false);
  await h.worker.cancel(h.record.id); await h.runs.tick();
});
it('validation cancellation immediately blocks approval and writing, before the next worker tick', async () => {
  const h = await setup(true); await h.worker.tick(); const runId = h.record.cases[0]!.runId;
  await pool.query("UPDATE runs SET record=record || '{\"status\":\"running\"}'::jsonb WHERE id=$1", [runId]);
  const args = { equipmentId: 'PUMP-001', description: '检查设备', priority: 'normal' }; const action = await actions.prepare(runId, 'tool-call', 'work-order-create', args);
  await h.worker.cancel(h.record.id);
  await expect(actions.decide(action.id, runId, 'U1001', { decisionId: randomUUID(), decision: 'approve', actionHash: action.actionHash })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' });
  expect((await h.runs.get(runId)).cancelRequested).toBe(true);
});
