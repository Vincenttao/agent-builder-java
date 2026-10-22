import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { RunService, type RunRuntime } from '../../apps/server/src/runs/run-service.js';
import { PostgresActions } from '../../apps/server/src/actions/postgres-actions.js';
import { ActionService, type WritePort } from '../../apps/server/src/actions/action-service.js';
import { ValidationWriteFault } from '../../apps/server/src/acceptance/adapters/validation-write-fault.js';
import { draftInput } from '../support/fixtures.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const schema = `it_actions_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url }); const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const time = { value: Date.now() }; const clock = { now: () => new Date(time.value).toISOString() }; const ids = { next: randomUUID };
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids);
const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids);
const runtime: RunRuntime = {
  claim:async()=>{},retire:async()=>({status:'stopped'}),
  capabilities: async () => ({ artifactDigest: 'a'.repeat(64), modelConfigured: true, executionMode: 'trusted-local', bootId: 'fixture' }),
  deploy: async () => ({ status: 'ready' }), begin: async id => ({ id, status: 'running', events: [] }), execution: async id => ({ id, status: 'running', events: [] }),
  cancel: async id => ({ id, status: 'cancelled', events: [] }), stop: async () => ({ status: 'stopped' }), events: async () => []
};
const runs = new RunService(pool, snapshots, runtime, { ready: async () => true, prepare: async () => {}, release: async () => {}, calls: async () => [] });
const repository = new PostgresActions(pool, clock);
const args = { equipmentId: 'PUMP-001', description: '检查温度告警', priority: 'normal' };
const scenario = async () => {
  const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { ...draftInput.brief.output, confirmed: true } } });
  const snapshot = await snapshots.create(draft.id, { expectedRevision: 1, assembly: { agentType: 'DeepAgent', systemPrompt: '查询并申请工单', maxIterations: 5, railIds: ['audit@1', 'tool-allowlist@1', 'write-confirm@1'], toolIds: ['equipment-status@1', 'work-order-create@1'] } });
  const run = await runs.create(snapshot.id, { clientRequestId: randomUUID(), input: '创建 PUMP-001 工单' });
  // Isolate repository tests from the runtime loop; this is not SDK or end-to-end acceptance.
  await pool.query("UPDATE runs SET record=record || '{\"status\":\"running\",\"started\":true}'::jsonb WHERE id=$1", [run.id]);
  return run;
};
function writer(mode: 'normal' | 'write-then-timeout' | 'unknown' = 'normal') {
  let writes = 0; let lookups = 0; const state = new Map<string, unknown>();
  const port: WritePort = {
    write: async (_context, _operation, _args, key) => {
      writes++; if (mode !== 'unknown') state.set(key, { workOrderId: `WO-${key}`, status: 'created' });
      if (mode !== 'normal') throw new Error('TRANSPORT_TIMEOUT');
      return { status: 200, result: state.get(key)! };
    },
    lookup: async (_context, _operation, key) => { lookups++; return state.get(key) ?? null; }
  };
  return { port, stats: () => ({ writes, lookups }), service: new ActionService(repository, port) };
}
beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
const decision = (actionHash: string, vote: 'approve' | 'reject' = 'approve') => ({ decisionId: randomUUID(), decision: vote, actionHash });
describe('TD-05 durable action authorization and reconciliation', () => {
  it('worker expiry and cancellation revoke approved actions before their first write', async () => {
    const run = await scenario(); const a = await repository.prepare(run.id, 'call-expiry', 'work-order-create', args, 1000); const w = writer();
    await repository.decide(a.id, run.id, run.actorId, decision(a.actionHash)); time.value += 1000;
    await repository.expireDue(run.id); expect((await repository.get(a.id)).status).toBe('expired');
    await expect(w.service.invoke(run.id, run.actorId, 'call-expiry', 'work-order-create', args)).rejects.toBeDefined(); expect(w.stats().writes).toBe(0);
    await runs.tick(); // Finish this fixture run so it does not occupy the eight-run admission limit.
    const another = await scenario(); const b = await repository.prepare(another.id, 'call-cancel', 'work-order-create', args);
    await repository.decide(b.id, another.id, another.actorId, decision(b.actionHash)); await runs.cancel(another.id);
    await expect(w.service.invoke(another.id, another.actorId, 'call-cancel', 'work-order-create', args)).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' });
    expect(w.stats().writes).toBe(0); await runs.tick();
  });
  it('separate service instances cannot claim the same approved write twice', async () => {
    const run = await scenario(); const a = await repository.prepare(run.id, 'call-workers', 'work-order-create', args);
    await repository.decide(a.id, run.id, run.actorId, decision(a.actionHash));
    const claims = await Promise.all([repository.claim(run.id, run.actorId, 'call-workers', 'work-order-create', args), new PostgresActions(pool, clock).claim(run.id, run.actorId, 'call-workers', 'work-order-create', args)]);
    expect(claims.filter(claim => claim.write)).toHaveLength(1);
    await repository.settle(a.id, 'write_succeeded', { status: 200, result: { workOrderId: a.id } });
    await runs.cancel(run.id); await runs.tick();
  });
  it('prepares one immutable action per native tool call and normalizes parameters', async () => {
    const run = await scenario(); const a = await repository.prepare(run.id, 'call-1', 'work-order-create', args);
    const b = await repository.prepare(run.id, 'call-1', 'work-order-create', { priority: 'normal', description: ' 检查温度告警 ', equipmentId: 'PUMP-001' });
    expect(a).toEqual(b); expect(a.status).toBe('pending'); expect((await runs.get(run.id)).status).toBe('waiting_confirmation');
    await expect(repository.prepare(run.id, 'call-1', 'work-order-create', { ...args, priority: 'urgent' })).rejects.toMatchObject({ code: 'ACTION_INPUT_CONFLICT' });
    await expect(pool.query("UPDATE pending_actions SET record=record-'actionHash' WHERE id=$1", [a.id])).rejects.toThrow('immutable');
  });
  it('rejects absent approval, other identity/run, stale hashes and changed execution arguments with zero writes', async () => {
    const run = await scenario(); const a = await repository.prepare(run.id, 'call-2', 'work-order-create', args); const w = writer();
    await expect(w.service.invoke(run.id, run.actorId, 'call-2', 'work-order-create', args)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await expect(repository.decide(a.id, run.id, 'U1002', decision(a.actionHash))).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
    await expect(repository.decide(a.id, randomUUID(), run.actorId, decision(a.actionHash))).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
    await expect(repository.decide(a.id, run.id, run.actorId, decision('b'.repeat(64)))).rejects.toMatchObject({ code: 'ACTION_HASH_MISMATCH' });
    await repository.decide(a.id, run.id, run.actorId, decision(a.actionHash));
    await expect(w.service.invoke(run.id, run.actorId, 'call-2', 'work-order-create', { ...args, priority: 'urgent' })).rejects.toMatchObject({ code: 'ACTION_INPUT_CONFLICT' });
    expect(w.stats().writes).toBe(0);
    expect((await repository.get(a.id)).status).toBe('invalidated');
    expect(await runs.get(run.id)).toMatchObject({status:'cancelling',cancelRequested:true});
    await expect(w.service.invoke(run.id,run.actorId,'call-2','work-order-create',args)).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
    expect((await repository.attempts(a.id)).map(item=>item.type)).toEqual(['input_rejected']);
    const rejected=(await runs.events(run.id,0)).find(event=>event.type==='action.input_rejected');
    expect(rejected).toMatchObject({source:'platform',data:{actionId:a.id,toolCallId:'call-2',approvedParamsHash:a.paramsHash}});
    expect((rejected!.data as {receivedParamsHash:string}).receivedParamsHash).not.toBe(a.paramsHash);
    expect(w.stats().writes).toBe(0);
  });
  it('concurrent duplicate decisions and tool requests produce one effective decision and one write', async () => {
    const run = await scenario(); const a = await repository.prepare(run.id, 'call-3', 'work-order-create', args); const w = writer();
    const decisions = await Promise.all([1, 2, 3].map(() => repository.decide(a.id, run.id, run.actorId, decision(a.actionHash))));
    expect(new Set(decisions.map(d => d.decisionId)).size).toBe(1);
    await expect(repository.decide(a.id, run.id, run.actorId, decision(a.actionHash, 'reject'))).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
    const proxy = new ValidationWriteFault(pool,w.service);
    const results = await Promise.all([1, 2, 3].map(() => proxy.invoke(run.id, run.actorId, 'call-3', 'work-order-create', args)));
    expect(results[0]).toEqual(results[1]); expect(results[0]).toEqual(results[2]); expect(w.stats().writes).toBe(1);
    expect((await repository.get(a.id)).status).toBe('succeeded');
    expect((await runs.events(run.id, 0)).filter(e => e.type === 'action.decided')).toHaveLength(1);
    expect((await runs.events(run.id, 0)).some(e => e.type === 'validation.write_fault')).toBe(false);
  });
  it('reject and expire cancel the original run, preserve analysis, and never authorize a write', async () => {
    const run = await scenario(); await pool.query('UPDATE runs SET record=record || $2::jsonb WHERE id=$1', [run.id, { result: { result: { content: '设备温度 86°C' } } }]);
    const a = await repository.prepare(run.id, 'call-4', 'work-order-create', args); const w = writer();
    await repository.decide(a.id, run.id, run.actorId, decision(a.actionHash, 'reject'));
    expect((await runs.get(run.id)).status).toBe('cancelling'); expect(JSON.stringify((await runs.get(run.id)).result)).toContain('86');
    await expect(w.service.invoke(run.id, run.actorId, 'call-4', 'work-order-create', args)).rejects.toBeDefined();
    const another = await scenario(); const expiring = await repository.prepare(another.id, 'call-5', 'work-order-create', args, 1000);
    time.value += 1000;
    await expect(repository.decide(expiring.id, another.id, another.actorId, decision(expiring.actionHash))).rejects.toMatchObject({ code: 'ACTION_EXPIRED' });
    expect((await repository.get(expiring.id)).status).toBe('expired'); expect(w.stats().writes).toBe(0);
  });
  it('a write that committed before a timeout is reconciled by the original key without another write', async () => {
    const run = await scenario(); const a = await repository.prepare(run.id, 'call-6', 'work-order-create', args); const w = writer('write-then-timeout');
    await repository.decide(a.id, run.id, run.actorId, decision(a.actionHash));
    const response = await w.service.invoke(run.id, run.actorId, 'call-6', 'work-order-create', args);
    expect(response.status).toBe(200); expect(response.result).toEqual({ workOrderId: `WO-${a.id}`, status: 'created' });
    expect(w.stats()).toEqual({ writes: 1, lookups: 1 }); expect((await repository.get(a.id)).status).toBe('succeeded');
    expect((await repository.attempts(a.id)).map(a => a.type)).toEqual(['write_started', 'write_unknown', 'reconcile_found']);
  });
  it('an unresolved write remains unknown and repeated requests only look up its original key', async () => {
    const run = await scenario(); const a = await repository.prepare(run.id, 'call-7', 'work-order-create', args); const w = writer('unknown');
    await repository.decide(a.id, run.id, run.actorId, decision(a.actionHash));
    for (let i = 0; i < 2; i++) await expect(w.service.invoke(run.id, run.actorId, 'call-7', 'work-order-create', args)).rejects.toMatchObject({ code: 'ACTION_RESULT_UNKNOWN' });
    expect(w.stats().writes).toBe(1); expect((await repository.get(a.id)).status).toBe('unknown');
  });
});
