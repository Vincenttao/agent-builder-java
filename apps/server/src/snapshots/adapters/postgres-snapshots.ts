import type { Pool } from 'pg';
import type { Snapshot } from '../../../../../packages/contracts/src/index.js';
import type { SnapshotRepository } from '../domain/ports.js';
import { AppError } from '../../shared/errors.js';
interface Row { id: string; draft_id: string; draft_revision: number; digest: string; content: Snapshot['content']; created_at: Date }
const fromRow = (row: Row): Snapshot => ({ id: row.id, draftId: row.draft_id, draftRevision: row.draft_revision, content: row.content, digest: row.digest, createdAt: row.created_at.toISOString() });
export class PostgresSnapshotRepository implements SnapshotRepository {
  constructor(private readonly pool: Pool) {}
  async create(snapshot: Snapshot) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const draft = await client.query<{revision: number}>('SELECT revision FROM drafts WHERE id=$1 FOR SHARE', [snapshot.draftId]);
      if (draft.rows[0]?.revision !== snapshot.draftRevision) throw new AppError('REVISION_CONFLICT', '草稿已变更，请重新生成快照', 409);
      await client.query('INSERT INTO snapshots(id,draft_id,draft_revision,digest,content,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [snapshot.id, snapshot.draftId, snapshot.draftRevision, snapshot.digest, JSON.stringify(snapshot.content), snapshot.createdAt]);
      await client.query('COMMIT'); return snapshot;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async get(id: string) {
    const result = await this.pool.query<Row>('SELECT * FROM snapshots WHERE id=$1', [id]);
    return result.rows[0] ? fromRow(result.rows[0]) : undefined;
  }
  async list(draftId: string) { return (await this.pool.query<Row>('SELECT * FROM snapshots WHERE draft_id=$1 ORDER BY created_at DESC,id LIMIT 100', [draftId])).rows.map(fromRow); }
}
