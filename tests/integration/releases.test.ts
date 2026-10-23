import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { ReleaseService, type ReleaseGate, type ReleaseDriver } from '../../apps/server/src/releases/release-service.js';
import { equipmentAssembly } from '../../packages/contracts/src/equipment-template.js';
import { DependencyError } from '../../apps/server/src/runs/http-ports.js';
import { runtimeModelProfile } from '../../apps/runner/src/runtime/model-profile.js';
import { draftInput } from '../support/fixtures.js';
const schema = `it_releases_${randomUUID().replaceAll('-', '')}`;
const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const admin = new Pool({ connectionString: url }); const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const clock = { now: () => new Date().toISOString() }; const ids = { next: randomUUID };
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids); const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids);
beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
async function setup() {
  const draft = await drafts.create({ ...draftInput, brief: { ...draftInput.brief, output: { value: '设备报告', source: 'user', confirmed: true } } });
  const first = await snapshots.create(draft.id, { expectedRevision: 1, assembly: equipmentAssembly('VERSION_ONE') });
  const second = await snapshots.create(draft.id, { expectedRevision: 1, assembly: equipmentAssembly('VERSION_TWO') });
  let unavailable = false; let smokePending = false; let smokeFails = false; let generation = 1; let prepares = 0; let stops = 0;
  // These tests exercise persistence with explicitly injected ports. They do not establish a live publish result.
  const gate: ReleaseGate = { check: async (snapshotId, validationId) => ({ agentId: draft.id, snapshotId, validationId, binding: {
    snapshotDigest: (await snapshots.get(snapshotId)).digest, artifactDigest: 'a'.repeat(64), baselineDigest: 'b'.repeat(64), testSetDigest: 'c'.repeat(64), compatibilityKey: String(generation).repeat(64), modelProfile: runtimeModelProfile('http://127.0.0.1:1/v1'), mockDigest: 'd'.repeat(64)
  } }) };
  const driver: ReleaseDriver = {
    prepare: async op => { prepares++; if (unavailable) throw new Error('START_FAILED'); return { ready: true, artifactDigest: op.reference.binding.artifactDigest, snapshotDigest: op.reference.binding.snapshotDigest }; },
    smoke: async () => smokePending ? { status: 'pending' } : { status: smokeFails ? 'failed' : 'passed', evidence: { mode: 'test-fixture', readCalls: 1, writeCalls: 0 } },
    stop: async () => { stops++; }
  };
  const service = () => new ReleaseService(pool, gate, driver); const s = service(); const input = (snapshotId: string, revision: number) => ({ snapshotId, validationId: randomUUID(), expectedRevision: revision, clientRequestId: randomUUID() });
  return { draft, first, second, s, service, input, driver,gate, fail: (value: boolean) => { unavailable = value; }, smoke: (pending: boolean, fail = false) => { smokePending = pending; smokeFails = fail; }, change: () => { generation++; }, stats: () => ({ prepares, stops }) };
}
describe('serialized publication, smoke gating and immutable history', () => {
  it('rejects a different candidate on the same snapshot when rolling back a historical version',async()=>{
    const h=await setup();const original=h.gate.check;let candidateId=randomUUID();let artifact='e'.repeat(64);
    h.gate.check=async(...args)=>{const ref=await original(...args);return{...ref,binding:{...ref.binding,artifactDigest:artifact,candidate:{id:candidateId,bundleDigest:'f'.repeat(64),specDigest:ref.binding.candidate?.specDigest??'0'.repeat(64),provenance:'generated-component'}}};};
    const first=await h.s.start(h.draft.id,h.input(h.first.id,0));await h.s.tick();await h.s.tick();const previous=candidateId;
    candidateId=randomUUID();await expect(h.s.start(h.draft.id,{...h.input(h.first.id,1),rollbackVersionId:first.versionId})).rejects.toMatchObject({code:'ROLLBACK_TARGET_MISMATCH'});
    candidateId=previous;artifact='a'.repeat(64);await expect(h.s.start(h.draft.id,{...h.input(h.first.id,1),rollbackVersionId:first.versionId})).rejects.toMatchObject({code:'ROLLBACK_TARGET_MISMATCH'});
    expect((await h.s.pointer(h.draft.id)).versionId).toBe(first.versionId);
  });
  it('a pending smoke does not starve another agent publication',async()=>{
    const a=await setup();const first=await a.s.start(a.draft.id,a.input(a.first.id,0));a.smoke(true);await a.s.tick();await a.s.tick();
    const b=await setup();const second=await b.s.start(b.draft.id,b.input(b.first.id,0));await b.s.tick();
    expect((await b.s.get(second.id)).status).toBe('smoking');
    a.smoke(false);await a.s.tick();await b.s.tick();expect((await a.s.get(first.id)).status).toBe('succeeded');expect((await b.s.get(second.id)).status).toBe('succeeded');
  });
  it('persists failed deployment cleanup and retries it after a worker restart', async () => {
    const h = await setup(); h.fail(true); let attempts = 0;
    h.driver.stop = async () => { if (++attempts === 1) throw new Error('RUNNER_TEMPORARILY_UNAVAILABLE'); };
    const operation = await h.s.start(h.draft.id, h.input(h.first.id, 0)); await h.s.tick();
    expect((await h.s.get(operation.id)).status).toBe('failed'); expect((await h.s.pointer(h.draft.id)).versionId).toBeUndefined();
    expect((await pool.query('SELECT cleanup_pending FROM release_operations WHERE id=$1', [operation.id])).rows[0]?.cleanup_pending).toBe(true);
    await h.service().tick(); expect(attempts).toBe(2);
    expect((await pool.query('SELECT cleanup_pending FROM release_operations WHERE id=$1', [operation.id])).rows[0]?.cleanup_pending).toBe(false);
  });
  it('a stale worker cannot stop the deployment successfully published by its successor', async () => {
    const h = await setup(); const operation = await h.s.start(h.draft.id, h.input(h.first.id, 0));
    const prepare = h.driver.prepare; let entered!: () => void; let failOld!: () => void;
    const reached = new Promise<void>(r => { entered = r; });
    const blocked = new Promise<never>((_resolve, reject) => { failOld = () => reject(new Error('OLD_WORKER_LOST_RESPONSE')); });
    let first = true; h.driver.prepare = async (op, claim) => { if (first) { first = false; entered(); return blocked; } return prepare(op, claim); };
    const old = h.s.tick(); await reached;
    await pool.query("UPDATE release_operations SET lease_until=now()-interval '1 second' WHERE id=$1", [operation.id]);
    const successor = h.service(); await successor.tick(); await successor.tick();
    expect((await successor.get(operation.id)).status).toBe('succeeded');
    failOld(); await old;
    expect(h.stats().stops).toBe(0); expect((await h.s.pointer(h.draft.id)).versionId).toBe(operation.versionId);
  });
  it('deduplicates an operation and switches the pointer only after readiness and successful smoke', async () => {
    const h = await setup(); const input = h.input(h.first.id, 0); const [a,b] = await Promise.all([h.s.start(h.draft.id,input),h.s.start(h.draft.id,input)]); expect(a.id).toBe(b.id);
    h.smoke(true); await h.s.tick(); await h.s.tick(); expect((await h.s.pointer(h.draft.id)).versionId).toBeUndefined();
    await expect(h.s.start(h.draft.id,h.input(h.second.id,0))).rejects.toMatchObject({ code: 'RELEASE_BUSY' });
    h.smoke(false); await h.service().tick(); const pointer = await h.s.pointer(h.draft.id);
    expect(pointer.versionId).toBe(a.versionId); expect(pointer.revision).toBe(1); expect((await h.s.get(a.id)).status).toBe('succeeded');
    expect(h.stats().prepares).toBe(1); expect(await h.s.versions(h.draft.id)).toHaveLength(1);
  });
  it('keeps v1 serving after v2 fails and rolls back through a new deployment without resetting the business environment', async () => {
    const h = await setup(); const v1 = await h.s.start(h.draft.id,h.input(h.first.id,0)); await h.s.tick(); await h.s.tick(); const original = await h.s.pointer(h.draft.id);
    h.fail(true); const failed = await h.s.start(h.draft.id,h.input(h.second.id,1)); await h.s.tick(); expect((await h.s.get(failed.id)).status).toBe('failed'); expect(await h.s.pointer(h.draft.id)).toEqual(original);
    h.fail(false); const v2 = await h.s.start(h.draft.id,h.input(h.second.id,1)); await h.s.tick(); await h.s.tick(); expect((await h.s.pointer(h.draft.id)).versionId).toBe(v2.versionId);
    const rollback = await h.s.start(h.draft.id,{ ...h.input(h.first.id,2), rollbackVersionId: v1.versionId }); await h.s.tick(); await h.s.tick();
    const pointer = await h.s.pointer(h.draft.id); expect(pointer.versionId).toBe(rollback.versionId); expect(pointer.environmentId).toBe(original.environmentId); expect(rollback.deploymentId).not.toBe(v1.deploymentId);
    const versions = await h.s.versions(h.draft.id); expect(versions).toHaveLength(3); expect(versions.find(v => v.id === v1.versionId)?.snapshotId).toBe(h.first.id);
    await expect(pool.query("UPDATE release_versions SET record=record || '{\"snapshotId\":\"changed\"}'::jsonb WHERE id=$1",[v1.versionId])).rejects.toThrow('immutable');
  });
  it('retains the classified Runner startup failure reason and current v1 pointer', async () => {
    const h = await setup();
    const v1 = await h.s.start(h.draft.id,h.input(h.first.id,0)); await h.s.tick(); await h.s.tick();
    const pointer = await h.s.pointer(h.draft.id);
    h.driver.prepare = async () => { throw new DependencyError(503,'DEPENDENCY_REQUEST_FAILED'); };
    const v2 = await h.s.start(h.draft.id,h.input(h.second.id,pointer.revision)); await h.s.tick();
    expect((await h.s.get(v2.id)).status).toBe('failed');
    expect((await h.s.get(v2.id)).diagnostic).toBe('DEPENDENCY_REQUEST_FAILED');
    expect(await h.s.pointer(h.draft.id)).toEqual(pointer);
  });
  it('persists the preparing phase before requesting a Runner deployment', async () => {
    const h = await setup();
    const operation = await h.s.start(h.draft.id,h.input(h.first.id,0));
    let entered!: () => void; let release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    h.driver.prepare = async current => { entered(); await wait; return { ready: true, artifactDigest: current.reference.binding.artifactDigest, snapshotDigest: current.reference.binding.snapshotDigest }; };
    const tick = h.s.tick(); await reached;
    expect((await h.s.get(operation.id)).status).toBe('preparing');
    release(); await tick;
  });
  it('a failing smoke or changed validation binding cannot switch an existing pointer', async () => {
    const h = await setup(); const first = await h.s.start(h.draft.id,h.input(h.first.id,0));
    for(let i=0;i<4&&(await h.s.get(first.id)).status!=='succeeded';i++) await h.s.tick();
    expect((await h.s.get(first.id)).status).toBe('succeeded'); const pointer = await h.s.pointer(h.draft.id);
    h.smoke(false,true); const badSmoke = await h.s.start(h.draft.id,h.input(h.second.id,1));
    for(let i=0;i<4&&(await h.s.get(badSmoke.id)).status!=='failed';i++) await h.s.tick();
    expect((await h.s.get(badSmoke.id)).diagnostic).toBe('SMOKE_FAILED'); expect(await h.s.pointer(h.draft.id)).toEqual(pointer);
    h.smoke(true); const changed = await h.s.start(h.draft.id,h.input(h.second.id,1)); await h.s.tick(); h.change();
    for(let i=0;i<4&&(await h.s.get(changed.id)).status!=='failed';i++) await h.s.tick();
    expect((await h.s.get(changed.id)).diagnostic).toBe('VALIDATION_BINDING_CHANGED'); expect(await h.s.pointer(h.draft.id)).toEqual(pointer);
  });
});
