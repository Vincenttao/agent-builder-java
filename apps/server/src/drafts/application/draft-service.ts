import type { DraftInput, DraftUpdate } from '../../../../../packages/contracts/src/index.js';
import type { Clock, DraftRepository, IdGenerator } from '../domain/ports.js';
import { AppError } from '../../shared/errors.js';

export class DraftService {
  constructor(private readonly repository: DraftRepository, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  async create(input: DraftInput) {
    const at = this.clock.now();
    return this.repository.create({ ...structuredClone(input), name: input.name.trim(), id: this.ids.next(), revision: 1, createdAt: at, updatedAt: at });
  }
  async get(id: string) {
    const draft = await this.repository.get(id);
    if (!draft) throw new AppError('DRAFT_NOT_FOUND', '草稿不存在', 404);
    return draft;
  }
  async list() { return this.repository.list(); }
  async update(id: string, input: DraftUpdate) {
    const { expectedRevision, ...content } = input;
    return this.repository.update(id, expectedRevision, structuredClone(content), this.clock.now());
  }
}
