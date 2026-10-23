import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { PostgresSnapshotRepository } from '../../apps/server/src/snapshots/adapters/postgres-snapshots.js';
import { SnapshotService } from '../../apps/server/src/snapshots/application/snapshot-service.js';
import { draftInput } from '../support/fixtures.js';
import { createApp } from '../../apps/server/src/app.js';
import {wealthBalanceAssembly,wealthAssistantAssembly} from '../../packages/contracts/src/equipment-template.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const schema = `it_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
const clock = { now: () => new Date().toISOString() };
const ids = { next: randomUUID };
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, ids);
const snapshots = () => new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, ids);
const confirmed = () => ({ ...structuredClone(draftInput), brief: Object.fromEntries(Object.entries(draftInput.brief).map(([k, v]) => [k, { ...v, confirmed: true }])) as typeof draftInput.brief });
const assembly = { agentType: 'DeepAgent', systemPrompt: '根据工具事实查询设备状态，缺少编号先追问。', maxIterations: 4,
  railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); });

describe('TD-02 不可变快照／真实数据库', () => {
  it('requires confirmed, nonempty requirements before freezing a runnable definition', async () => {
    const draft = await drafts.create(draftInput);
    await expect(snapshots().create(draft.id, { expectedRevision: 1, assembly })).rejects.toMatchObject({ code: 'BRIEF_NOT_CONFIRMED' });
    expect((await pool.query('SELECT count(*)::int AS n FROM snapshots')).rows[0].n).toBe(0);
  });
  it('old snapshots retain exact fields, assembly and digest after editing the draft', async () => {
    const draft = await drafts.create(confirmed());
    const first = await snapshots().create(draft.id, { expectedRevision: 1, assembly });
    await drafts.update(draft.id, { ...confirmed(), name: '新的设备助手', expectedRevision: 1 });
    const second = await snapshots().create(draft.id, { expectedRevision: 2, assembly: { ...assembly, maxIterations: 5 } });
    expect(await snapshots().get(first.id)).toEqual(first);
    expect(first.content.draft.name).toBe(draft.name);
    expect(first.content.assembly.maxIterations).toBe(4);
    expect(second.content.draft.revision).toBe(2);
    expect(second.digest).not.toBe(first.digest);
    expect(second.content.runtimeSpec.agent.maxIterations).toBe(5);
  });
  it('freezes a finance generation profile without preloading a business Tool and binds the mock-finance connection',async()=>{
    const draft=await drafts.create(confirmed());const snapshot=await snapshots().create(draft.id,{expectedRevision:1,assembly:wealthBalanceAssembly('查询账户可用余额')});
    expect(snapshot.content.connectionProfile).toBe('mock-finance@1');expect(snapshot.content.runtimeSpec.tools).toEqual([]);
    expect(snapshot.content.assembly.generationProfileVersion).toBe('wealth-balance-java@1');
  });
  it('freezes combined balance and product access as one Agent without preloading business Tools',async()=>{
    const draft=await drafts.create(confirmed());const snapshot=await snapshots().create(draft.id,{expectedRevision:1,assembly:wealthAssistantAssembly('查询余额和产品目录')});
    expect(snapshot.content.connectionProfile).toBe('mock-finance@1');expect(snapshot.content.runtimeSpec.tools).toEqual([]);
    expect(snapshot.content.assembly.generationProfileVersion).toBe('wealth-assistant-java@1');
    expect(snapshot.content.assembly.systemPrompt).toContain('list_wealth_products');
  });
  it('rejects stale revision, unknown component, unsupported type and duplicate Rails', async () => {
    const draft = await drafts.create(confirmed());
    await expect(snapshots().create(draft.id, { expectedRevision: 9, assembly })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    for (const override of [{ toolIds: ['invented@1'] }, { railIds: ['invented@1'] }, { agentType: 'unsupported' }, { maxIterations: 0 }, { railIds: ['audit@1', 'audit@1', 'tool-allowlist@1'] }]) {
      await expect(snapshots().create(draft.id, { expectedRevision: 1, assembly: { ...assembly, ...override } })).rejects.toMatchObject({ code: 'INVALID_ASSEMBLY' });
    }
    expect(await drafts.get(draft.id)).toEqual(draft);
  });
  it('database refuses mutation of the immutable snapshot', async () => {
    const draft = await drafts.create(confirmed());
    const snapshot = await snapshots().create(draft.id, { expectedRevision: 1, assembly });
    await expect(pool.query('UPDATE snapshots SET digest=$1 WHERE id=$2', ['changed', snapshot.id])).rejects.toThrow();
    expect(await snapshots().get(snapshot.id)).toEqual(snapshot);
  });
  it('repository detects a draft revision change between validation and persistence', async () => {
    const draft = await drafts.create(confirmed());
    const captured = await snapshots().create(draft.id, { expectedRevision: 1, assembly });
    await drafts.update(draft.id, { ...confirmed(), name: '编辑抢先提交', expectedRevision: 1 });
    await expect(new PostgresSnapshotRepository(pool).create({ ...captured, id: randomUUID() })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
  it('HTTP creates, reads and lists snapshots, rejects illegal fields and exposes no mutation route', async () => {
    const app = createApp({ drafts, snapshots: snapshots(), databaseReady: async () => true, now: clock.now,
      bootstrapToken: 'snapshot-test-bootstrap-token-32', origin: 'http://127.0.0.1:8080', modelConfigured: false });
    try {
      const origin = 'http://127.0.0.1:8080';
      const session = await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin }, payload: { token: 'snapshot-test-bootstrap-token-32' } });
      const headers = { origin, cookie: String(session.headers['set-cookie']).split(';')[0]!, 'x-csrf-token': session.json().csrfToken as string };
      const draft = await drafts.create(confirmed());
      const created = await app.inject({ method: 'POST', url: `/api/drafts/${draft.id}/snapshots`, headers, payload: { expectedRevision: 1, assembly } });
      expect(created.statusCode).toBe(201);
      const snapshot = created.json();
      expect((await app.inject({ url: `/api/snapshots/${snapshot.id}`, headers })).json()).toEqual(snapshot);
      expect((await app.inject({ url: `/api/drafts/${draft.id}/snapshots`, headers })).json().items).toContainEqual(snapshot);
      expect((await app.inject({ method: 'PUT', url: `/api/snapshots/${snapshot.id}`, headers, payload: {} })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `/api/drafts/${draft.id}/snapshots`, headers,
        payload: { expectedRevision: 1, assembly: { ...assembly, rails: { arbitraryCode: 'execute' } } } })).statusCode).toBe(400);
      expect(await snapshots().get(snapshot.id)).toEqual(snapshot);
    } finally { await app.close(); }
  });
});
