import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { BaselineService } from '../../apps/server/src/acceptance/application/baseline-service.js';
import { ValidationService, type ValidationDriver } from '../../apps/server/src/acceptance/application/validation-service.js';
import { runtimeModelProfile } from '../../apps/runner/src/runtime/model-profile.js';
import { draftInput } from '../support/fixtures.js';
const schema = `it_validation_${randomUUID().replaceAll('-', '')}`;
const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin = new Pool({ connectionString: url }); const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const clock = { now: () => new Date().toISOString() }; const ids = { next: randomUUID };
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids);
const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids); const baselines = new BaselineService(pool, clock, ids);
const profile = runtimeModelProfile('http://127.0.0.1:1/v1');
const facts = { equipmentId: 'PUMP-001', status: 'warning', temperatureCelsius: 86, source: 'seed-equipment-001@1' };
let wrongFacts = false; let unavailable = false; let advances = 0;
const driver: ValidationDriver = {
  identity: async () => ({ artifactDigest: 'a'.repeat(64), modelProfile: profile, mockDigest: 'b'.repeat(64) }),
  advance: async (_target, item, progress) => {
    advances++; if (unavailable) throw new Error('DEPENDENCY_OFFLINE');
    const common = { run: { id: progress.runId, status: 'succeeded', result: { result: { content: '{}' } } }, calls: [], events: [], actions: [], attempts: [], complete: true, businessState: { workOrders: {} } };
    if (item.scenario === 'equipment-normal') return { ...common, run: { ...common.run, result: { result: { content: JSON.stringify({ kind: 'equipment-report', ...facts, temperatureCelsius: wrongFacts ? 20 : 86, recommendation: '检查温度' }) } } }, calls: [{ runId: progress.runId, operation: 'equipment-status', input: { equipmentId: 'PUMP-001' }, status: 200, result: facts }] };
    if (item.scenario === 'equipment-missing-id') return { ...common, run: { ...common.run, result: { result: { content: JSON.stringify({ kind: 'clarification', missingFields: ['equipmentId'], message: '请提供设备编号' }) } } } };
    return { ...common, run: { ...common.run, result: { result: { content: JSON.stringify({ kind: 'tool-error', code: 'TOOL_UNAVAILABLE', message: '工具超时，无法确定设备状态' }) } } }, events: [{ data: { event: { event: 'tool_error' } } }] };
  }, cancel: async () => true
};
const service = () => new ValidationService(pool, baselines, snapshots, driver, clock);
async function target() {
  const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { value: '设备报告', source: 'user', confirmed: true } } });
  const preview = await baselines.preview(draft.id, 'equipment-read@1');
  const baseline = await baselines.confirm(draft.id, { expectedRevision: 1, templateId: 'equipment-read@1', confirmed: true, expectedDigest: preview.digest });
  const snapshot = await snapshots.create(draft.id, { expectedRevision: 1, assembly: { agentType: 'DeepAgent', systemPrompt: '查询设备', maxIterations: 4, railIds: ['audit@1','tool-allowlist@1'], toolIds: ['equipment-status@1'] } });
  return { baseline, snapshot };
}
beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
describe('durable project validation and immutable reports', () => {
  it('cancellation accepted during the final observation wins over a late passing result',async()=>{
    const {baseline,snapshot}=await target();const s=service();const record=await s.start(snapshot.id,{clientRequestId:randomUUID(),baselineId:baseline.id,allowMockWrites:false});await s.tick();await s.tick();
    const original=driver.advance;let entered!:()=>void;let release!:()=>void;const reached=new Promise<void>(r=>{entered=r;});const gate=new Promise<void>(r=>{release=r;});
    driver.advance=async(...args)=>{entered();await gate;return original(...args);};
    try{const work=s.tick();await reached;await service().cancel(record.id);release();await work;expect((await s.get(record.id)).status).toBe('cancelling');await s.tick();expect((await s.report(record.id)).cases.at(-1)).toMatchObject({status:'unverified',reasons:['VALIDATION_CANCELLED']});}
    finally{release();driver.advance=original;}
  });
  it('requires a candidate-aware executor and pins candidate identity instead of silently validating the template',async()=>{
    const {baseline,snapshot}=await target();const candidate={id:randomUUID(),agentId:snapshot.draftId,snapshotId:snapshot.id,snapshotDigest:snapshot.digest,runtimeSpec:snapshot.content.runtimeSpec,specDigest:'e'.repeat(64),artifactDigest:'9'.repeat(64),bundleDigest:'c'.repeat(64),provenance:'assembled-template' as const,createdAt:clock.now()};
    const reference={id:candidate.id,bundleDigest:candidate.bundleDigest,specDigest:candidate.specDigest,provenance:candidate.provenance};
    const candidates={get:async()=>candidate,validationReference:async()=>reference};
    const input={clientRequestId:randomUUID(),baselineId:baseline.id,allowMockWrites:false,candidateId:candidate.id};
    await expect(new ValidationService(pool,baselines,snapshots,driver,clock,candidates).start(snapshot.id,input)).rejects.toMatchObject({code:'CANDIDATE_VALIDATION_UNAVAILABLE'});
    const aware={...driver,candidateValidation:true as const,identity:async(id?:string)=>({...await driver.identity(),artifactDigest:id===candidate.id?candidate.artifactDigest:'a'.repeat(64)})};
    const s=new ValidationService(pool,baselines,snapshots,aware,clock,candidates);const execution=await s.start(snapshot.id,input);
    expect(execution.binding).toMatchObject({artifactDigest:candidate.artifactDigest,candidate:reference});
    candidate.snapshotId=randomUUID();await expect(s.start(snapshot.id,{...input,clientRequestId:randomUUID()})).rejects.toMatchObject({code:'CANDIDATE_TARGET_MISMATCH'});
    await s.cancel(execution.id);for(let i=0;i<3;i++)await s.tick();
  });
  it('deduplicates admission, records every case, and never promotes a simulated model into a publishable result', async () => {
    const { baseline, snapshot } = await target(); const s = service(); const input = { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: false };
    const [a, b] = await Promise.all([s.start(snapshot.id, input), s.start(snapshot.id, input)]); expect(a.id).toBe(b.id); expect(a.cases).toHaveLength(3);
    for (let i = 0; i < 5; i++) await s.tick();
    const record = await s.get(a.id); expect(record.status).toBe('completed'); expect(record.verdict).toBe('unverified');
    const report = await s.report(a.id); expect(report.cases.every(c => c.assertions.every(a => a.status === 'passed'))).toBe(true);
    expect(report.reasons).toContain('REAL_MODEL_REQUIRED'); expect(report.binding.snapshotDigest).toBe(snapshot.digest);
    const before = advances; await service().tick(); expect(advances).toBe(before);
    await expect(pool.query("UPDATE validation_reports SET record=record || '{\"verdict\":\"passed\"}'::jsonb WHERE execution_id=$1", [a.id])).rejects.toThrow('immutable');
    await expect(pool.query('DELETE FROM validation_evidence WHERE execution_id=$1', [a.id])).rejects.toThrow('immutable');
  });
  it('a failing deterministic assertion remains failed and the next attempt does not overwrite it', async () => {
    const { baseline, snapshot } = await target(); const s = service(); wrongFacts = true;
    const first = await s.start(snapshot.id, { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: false });
    for (let i = 0; i < 5; i++) await s.tick(); wrongFacts = false;
    const failed = await s.report(first.id); expect(failed.verdict).toBe('failed');
    const next = await s.start(snapshot.id, { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: false });
    for (let i = 0; i < 5; i++) await s.tick();
    expect((await s.report(next.id)).verdict).toBe('unverified'); expect(await s.report(first.id)).toEqual(failed);
  });
  it('records blocked cases when evidence cannot be collected, including every remaining case', async () => {
    const { baseline, snapshot } = await target(); const s = service(); unavailable = true;
    const record = await s.start(snapshot.id, { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: false });
    for (let i = 0; i < 5; i++) await s.tick(); unavailable = false;
    const report = await s.report(record.id); expect(report.verdict).toBe('blocked'); expect(report.cases).toHaveLength(3); expect(report.cases.every(c => c.status === 'blocked')).toBe(true);
  });
  it('fences a stale worker after lease takeover without duplicating or replacing evidence', async () => {
    const { baseline, snapshot } = await target(); const oldWorker = service(); const newWorker = service();
    const record = await oldWorker.start(snapshot.id, { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: false });
    const original = driver.advance; let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
    let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let first = true;
    driver.advance = async (...args) => { if (first) { first = false; entered(); await gate; } return original(...args); };
    try {
      const pending = oldWorker.tick(); await started;
      await pool.query("UPDATE validation_executions SET lease_until=now()-interval '1 second' WHERE id=$1", [record.id]);
      await newWorker.tick(); release(); await pending;
      expect((await newWorker.get(record.id)).results).toHaveLength(1);
      for (let i = 0; i < 3; i++) await newWorker.tick();
      const report = await newWorker.report(record.id); expect(report.cases).toHaveLength(3); expect(report.cases.every(c => c.status === 'passed')).toBe(true);
    } finally { release(); driver.advance = original; }
  });
  it('cancels every preallocated run after restart and keeps incomplete cases unverified', async () => {
    const { baseline, snapshot } = await target(); const s = service(); const record = await s.start(snapshot.id, { clientRequestId: randomUUID(), baselineId: baseline.id, allowMockWrites: false });
    const original = driver.cancel; const cancelled: string[] = []; driver.cancel = async id => { cancelled.push(id); return true; };
    try {
      await s.cancel(record.id); for (let i = 0; i < 3; i++) await service().tick();
      expect(cancelled).toEqual(record.cases.map(c => c.runId));
      const report = await s.report(record.id); expect(report.verdict).toBe('unverified'); expect(report.cases.every(c => c.reasons.includes('VALIDATION_CANCELLED'))).toBe(true);
    } finally { driver.cancel = original; }
  });
});
