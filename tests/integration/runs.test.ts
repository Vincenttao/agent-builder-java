import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { RunService, type RunRuntime, type MockControl } from '../../apps/server/src/runs/run-service.js';
import { draftInput } from '../support/fixtures.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const schema = `it_runs_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const clock = { now: () => new Date().toISOString() }; const ids = { next: randomUUID };
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids);
const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids);
beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
const snapshot = async () => {
  const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { ...draftInput.brief.output, confirmed: true } } });
  return snapshots.create(draft.id, { expectedRevision: 1, assembly: { agentType: 'DeepAgent', systemPrompt: '工具事实', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] } });
};
function ports() {
  let starts = 0; let queries = 0; let stops = 0; let finished = false; let evidenceAvailable = true; let loseResponse = false;
  const executions = new Map<string, { id: string; status: string; events: unknown[]; result: unknown }>();
  const deployed=new Set<string>();
  const runtime: RunRuntime = {
    claim:async()=>{},retire:async id=>{if(deployed.has(id)){stops++;deployed.delete(id);}return{status:'stopped'};},
    capabilities: async () => ({ artifactDigest: 'a'.repeat(64), modelConfigured: true, executionMode: 'trusted-local', bootId: 'test-boot' }),
    deploy: async id => { starts++;deployed.add(id); return { status: 'ready' }; },
    begin: async (id) => {
      if (!executions.has(id)) { queries++; executions.set(id, { id, status: 'running', events: [], result: null }); }
      if (loseResponse) { loseResponse = false; throw new Error('LOST_RESPONSE'); }
      return executions.get(id)!;
    },
    execution: async id => { const record = executions.get(id); if (!record) return null; return finished ? { ...record, status: 'succeeded', result: { answer: '86°C' }, events: [{ event: 'rail.after_tool_call' }] } : record; },
    cancel: async id => { const record = executions.get(id)??{id,status:'cancelled',events:[],result:null}; record.status = 'cancelled'; return record; },
    stop: async () => { stops++; return { status: 'stopped' }; },
    events: async () => [{ event: 'rail.before_model_call' }]
  };
  const mock: MockControl = { ready: async () => true, prepare: async () => {}, release: async () => {}, calls: async () => { if (!evidenceAvailable) throw new Error('EVIDENCE_UNAVAILABLE'); return [{ operation: 'equipment-status', status: 200, result: { temperatureCelsius: 86 } }]; } };
  return { runtime, mock, stats: () => ({ starts, queries, stops }), finish: () => { finished = true; }, loseNext: () => { loseResponse = true; }, evidence: (value: boolean) => { evidenceAvailable = value; } };
}
describe('TD-04 durable Run orchestration', () => {
  it('an accepted cancellation wins over a terminal runtime response and retains the earlier analysis',async()=>{
    const p=ports(),s=new RunService(pool,snapshots,p.runtime,p.mock),target=await snapshot();
    const run=await s.create(target.id,{clientRequestId:randomUUID(),input:'查询设备'});await s.tick();
    const analysis={result:{content:'已查询到 86°C，写操作尚未执行'}};
    await pool.query('UPDATE runs SET record=record || $2::jsonb WHERE id=$1',[run.id,{result:analysis}]);
    await s.cancel(run.id);p.finish();await s.tick();
    expect(await s.get(run.id)).toMatchObject({status:'cancelled',result:analysis});
    expect((await s.events(run.id,0)).filter(event=>event.type==='run.succeeded')).toHaveLength(0);
  });
  it('does not expose another session events from a shared deployment', async () => {
    const p = ports(); const service = new RunService(pool, snapshots, p.runtime, p.mock); const target = await snapshot();
    const run = await service.create(target.id, { clientRequestId: randomUUID(), input: '查询设备' });
    p.runtime.events = async () => [{ event: { sessionId: run.id, event: 'assistant_output', content: 'my output' } }, { event: { sessionId: randomUUID(), event: 'assistant_output', content: 'another user private output' } }];
    await service.tick(); p.finish(); await service.tick();
    const events = await service.events(run.id, 0); expect(events.filter(e => e.source === 'runtime')).toHaveLength(1); expect(JSON.stringify(events)).not.toContain('another user private output');
  });
  it('freezes the target and deduplicates concurrent requests, including changed input conflict', async () => {
    const p = ports(); const service = new RunService(pool, snapshots, p.runtime, p.mock); const target = await snapshot();
    const input = { clientRequestId: randomUUID(), input: '查询 PUMP-001' };
    const [a, b] = await Promise.all([service.create(target.id, input), service.create(target.id, input)]);
    expect(a.id).toBe(b.id); expect(a.snapshotDigest).toBe(target.digest); expect(a.artifactDigest).toBe('a'.repeat(64));
    await expect(service.create(target.id, { ...input, input: '改变输入' })).rejects.toMatchObject({ code: 'REQUEST_INPUT_CONFLICT' });
    expect(p.stats().queries).toBe(0);
    await service.tick(); expect(p.stats().queries).toBe(1);
    expect((await service.context(a.id)).environmentId).toBe(a.environmentId);
    p.finish(); await service.tick();
    const done = await service.get(a.id); expect(done.status).toBe('succeeded'); expect(done.result).toEqual({ answer: '86°C' });
    expect(done.externalEvidence).toHaveLength(1); expect(p.stats().stops).toBe(1);
    const events = await service.events(a.id, 0); expect(events.length).toBeGreaterThan(3);
    expect(await service.events(a.id, events.at(-1)!.seq)).toEqual([]);
    expect(await new RunService(pool, snapshots, p.runtime, p.mock).get(a.id)).toEqual(done);
    await expect(service.context(a.id)).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' });
    await expect(pool.query("UPDATE runs SET record=record-'artifactDigest' WHERE id=$1", [a.id])).rejects.toThrow('immutable');
  });
  it('recovers an accepted execution after response loss without starting another model request', async () => {
    const p = ports(); const s = new RunService(pool, snapshots, p.runtime, p.mock); const target = await snapshot();
    const run = await s.create(target.id, { clientRequestId: randomUUID(), input: '查询设备' }); p.loseNext();
    await s.tick(); expect(p.stats().queries).toBe(1);
    const restored = new RunService(pool, snapshots, p.runtime, p.mock);
    p.finish(); await restored.tick();
    expect((await restored.get(run.id)).status).toBe('succeeded'); expect(p.stats().queries).toBe(1);
  });
  it('keeps missing external evidence pending and resumes collection instead of treating absence as zero calls', async () => {
    const p = ports(); const s = new RunService(pool, snapshots, p.runtime, p.mock); const target = await snapshot();
    const run = await s.create(target.id, { clientRequestId: randomUUID(), input: '查询设备' });
    await s.tick(); p.finish(); p.evidence(false); await s.tick();
    expect((await s.get(run.id)).status).toBe('running');
    expect((await s.get(run.id)).diagnostic).toBe('DEPENDENCY_UNAVAILABLE');
    p.evidence(true); await s.tick(); expect((await s.get(run.id)).status).toBe('succeeded'); expect(p.stats().queries).toBe(1);
  });
  it('cancels a queued request without deploying; an active request only becomes cancelled after Runner confirmation', async () => {
    const p = ports(); const s = new RunService(pool, snapshots, p.runtime, p.mock); const target = await snapshot();
    const queued = await s.create(target.id, { clientRequestId: randomUUID(), input: '不要启动' });
    expect((await s.cancel(queued.id)).status).toBe('cancelling'); await s.tick();
    expect((await s.get(queued.id)).status).toBe('cancelled'); expect(p.stats().starts).toBe(0);
    const active = await s.create(target.id, { clientRequestId: randomUUID(), input: '查询设备' }); await s.tick(); await s.cancel(active.id);
    await expect(s.context(active.id)).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' });
    await s.tick(); expect((await s.get(active.id)).status).toBe('cancelled'); expect(p.stats().stops).toBe(1);
  });
  it('commits terminal state and its final event atomically when event persistence fails', async () => {
    const p = ports(); const s = new RunService(pool, snapshots, p.runtime, p.mock); const target = await snapshot();
    const run = await s.create(target.id, { clientRequestId: randomUUID(), input: '查询设备' }); await s.tick(); p.finish();
    await pool.query("CREATE FUNCTION reject_terminal_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='run.succeeded' THEN RAISE EXCEPTION 'injected persistence failure'; END IF; RETURN NEW; END; $$");
    await pool.query('CREATE TRIGGER injected_event_failure BEFORE INSERT ON run_events FOR EACH ROW EXECUTE FUNCTION reject_terminal_event()');
    try { await s.tick(); expect((await s.get(run.id)).status).toBe('running'); }
    finally { await pool.query('DROP TRIGGER injected_event_failure ON run_events'); }
    await s.tick(); expect((await s.get(run.id)).status).toBe('succeeded');
    expect((await s.events(run.id, 0)).filter(e => e.type === 'run.succeeded')).toHaveLength(1);
  });
});
