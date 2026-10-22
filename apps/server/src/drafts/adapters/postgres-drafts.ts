import type { Pool, PoolClient } from 'pg';
import type { Draft, DraftInput } from '../../../../../packages/contracts/src/index.js';
import type { DraftRepository } from '../domain/ports.js';
import { AppError } from '../../shared/errors.js';
interface Row { id: string; revision: number; name: string; brief: Draft['brief']; created_at: Date; updated_at: Date }
const fromRow = (row: Row): Draft => ({ id: row.id, revision: row.revision, name: row.name, brief: row.brief, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
export class PostgresDraftRepository implements DraftRepository {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async record(client: PoolClient, draft: Draft) {
    await client.query('INSERT INTO draft_revisions(draft_id,revision,content,recorded_at) VALUES($1,$2,$3,$4)', [draft.id, draft.revision, JSON.stringify(draft), draft.updatedAt]);
  }
  async create(draft: Draft) {
    return this.transaction(async client => {
      await client.query('INSERT INTO drafts(id,revision,name,brief,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6)', [draft.id, draft.revision, draft.name, JSON.stringify(draft.brief), draft.createdAt, draft.updatedAt]);
      await this.record(client, draft); return draft;
    });
  }
  async get(id: string) {
    const result = await this.pool.query<Row>('SELECT * FROM drafts WHERE id=$1', [id]);
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }
  async list() {
    return (await this.pool.query<Row>('SELECT * FROM drafts ORDER BY updated_at DESC,id LIMIT 100')).rows.map(fromRow);
  }
  async update(id: string, revision: number, input: DraftInput, at: string) {
    return this.transaction(async client => {
      const result = await client.query<Row>('UPDATE drafts SET name=$1,brief=$2,revision=revision+1,updated_at=$3 WHERE id=$4 AND revision=$5 RETURNING *', [input.name.trim(), JSON.stringify(input.brief), at, id, revision]);
      const row = result.rows[0];
      if (!row) {
        const exists = await client.query('SELECT id FROM drafts WHERE id=$1', [id]);
        if (!exists.rowCount) throw new AppError('DRAFT_NOT_FOUND', '草稿不存在', 404);
        throw new AppError('REVISION_CONFLICT', '草稿已被更新，请重新读取后合并修改', 409);
      }
      const draft = fromRow(row); await this.record(client, draft); return draft;
    });
  }
}
