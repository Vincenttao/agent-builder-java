import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { PostgresDraftRepository } from '../../apps/server/src/drafts/adapters/postgres-drafts.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { draftInput } from '../support/fixtures.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
// Never truncate shared tables. Each invocation owns a random schema, removed in afterAll.
const schema = `it_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
const service = () => new DraftService(new PostgresDraftRepository(pool), { now: () => new Date().toISOString() }, { next: randomUUID });
beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); });

describe('TD-02 真实 PostgreSQL', () => {
  it('AC-01: 服务对象重建后草稿仍可恢复', async () => {
    const saved = await service().create(draftInput);
    expect(await service().get(saved.id)).toEqual(saved);
    expect(await service().list()).toContainEqual(saved);
  });
  it('AC-14 部分: 同一修订的并发修改只能一个成功，历史不可覆盖', async () => {
    const saved = await service().create(draftInput);
    const results = await Promise.allSettled(['A', 'B'].map(name => service().update(saved.id, { ...draftInput, name, expectedRevision: 1 })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(r => r.status === 'rejected');
    expect(failure).toMatchObject({ status: 'rejected', reason: { code: 'REVISION_CONFLICT' } });
    expect(await service().get(saved.id)).toMatchObject({ revision: 2 });
    const history = await pool.query('SELECT revision, content FROM draft_revisions WHERE draft_id=$1 ORDER BY revision', [saved.id]);
    expect(history.rows).toHaveLength(2);
    expect(history.rows[0].content).toMatchObject({ ...draftInput, revision: 1 });
  });
  it('历史写入失败时整个更新回滚，不能只改当前草稿', async () => {
    const saved = await service().create(draftInput);
    await pool.query('INSERT INTO draft_revisions(draft_id,revision,content,recorded_at) VALUES($1,2,$2,now())', [saved.id, '{}']);
    await expect(service().update(saved.id, { ...draftInput, name: '不应提交', expectedRevision: 1 })).rejects.toThrow();
    expect(await service().get(saved.id)).toEqual(saved);
  });
  it('重复迁移不丢数据，已应用迁移有校验摘要', async () => {
    const saved = await service().create(draftInput); await migrate(pool);
    expect(await service().get(saved.id)).toEqual(saved);
    expect((await pool.query('SELECT checksum FROM schema_migrations')).rows[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
