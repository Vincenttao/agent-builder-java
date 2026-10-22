import type { Draft, DraftInput } from '../../packages/contracts/src/index.js';
import type { DraftRepository } from '../../apps/server/src/drafts/domain/ports.js';
import { AppError } from '../../apps/server/src/shared/errors.js';

// Test double only. The application entrypoint always uses PostgreSQL.
export class MemoryDraftRepository implements DraftRepository {
  private rows = new Map<string, Draft>();
  async create(draft: Draft) { this.rows.set(draft.id, structuredClone(draft)); return structuredClone(draft); }
  async get(id: string) { const row = this.rows.get(id); return row ? structuredClone(row) : undefined; }
  async list() { return structuredClone([...this.rows.values()]); }
  async update(id: string, revision: number, input: DraftInput, at: string) {
    const current = this.rows.get(id);
    if (!current) throw new AppError('DRAFT_NOT_FOUND', '草稿不存在', 404);
    if (current.revision !== revision) throw new AppError('REVISION_CONFLICT', '草稿已更新，请重新读取', 409);
    const next = { ...current, ...structuredClone(input), revision: revision + 1, updatedAt: at };
    this.rows.set(id, next); return structuredClone(next);
  }
}
