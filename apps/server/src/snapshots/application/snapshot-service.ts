import type { Snapshot, SnapshotInput } from '../../../../../packages/contracts/src/index.js';
import type { DraftService } from '../../drafts/application/draft-service.js';
import type { Clock, IdGenerator } from '../../drafts/domain/ports.js';
import type { SnapshotRepository } from '../domain/ports.js';
import { assemble, contentDigest } from '../domain/assembly.js';
import { AppError } from '../../shared/errors.js';

export class SnapshotService {
  constructor(private readonly drafts: DraftService, private readonly repository: SnapshotRepository,
    private readonly clock: Clock, private readonly ids: IdGenerator) {}
  async create(draftId: string, input: SnapshotInput) {
    const draft = await this.drafts.get(draftId);
    if (draft.revision !== input.expectedRevision) throw new AppError('REVISION_CONFLICT', '草稿已变更，请重新确认', 409);
    if (Object.values(draft.brief).some(f => !f.confirmed || !f.value.trim())) throw new AppError('BRIEF_NOT_CONFIRMED', '请补齐并确认全部需求字段', 422);
    const id = this.ids.next();
    const content: Snapshot['content'] = { draft: structuredClone(draft), assembly: structuredClone(input.assembly),
      runtimeSpec: assemble(id, input.assembly), executionMode: 'trusted-local', sdk: { core: '0.1.17', runtime: '0.1.4' },
      modelProfile: 'deepseek-v4-flash@1', connectionProfile: input.assembly.generationProfileVersion==='wealth-balance-java@1'?'mock-finance@1':'equipment-mock@1' };
    return this.repository.create({ id, draftId, draftRevision: draft.revision, content, digest: contentDigest(content), createdAt: this.clock.now() });
  }
  async get(id: string) {
    const snapshot = await this.repository.get(id);
    if (!snapshot) throw new AppError('SNAPSHOT_NOT_FOUND', '快照不存在', 404);
    if (contentDigest(snapshot.content) !== snapshot.digest) throw new AppError('SNAPSHOT_INTEGRITY_ERROR', '快照摘要校验失败', 409);
    return snapshot;
  }
  async list(draftId: string) { await this.drafts.get(draftId); return this.repository.list(draftId); }
}
