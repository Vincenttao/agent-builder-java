import type { Pool } from 'pg';
import type { AcceptanceBaseline, BaselineInput } from '../../../../../packages/contracts/src/baselines.js';
import type { Draft, Snapshot } from '../../../../../packages/contracts/src/index.js';
import type { Clock, IdGenerator } from '../../drafts/domain/ports.js';
import { contentDigest } from '../../snapshots/domain/assembly.js';
import { AppError } from '../../shared/errors.js';
import { equipmentBaseline } from './equipment-baseline.js';

export class BaselineService {
  constructor(private readonly pool: Pool, private readonly clock: Clock, private readonly ids: IdGenerator) {}
  async preview(draftId: string, templateId: string) {
    if (templateId !== 'equipment-read@1' && templateId !== 'equipment-workorder@1') throw new AppError('UNKNOWN_BASELINE_TEMPLATE', '验收模板未登记', 422);
    const draft = (await this.pool.query<{ content: Draft }>('SELECT r.content FROM drafts d JOIN draft_revisions r ON r.draft_id=d.id AND r.revision=d.revision WHERE d.id=$1', [draftId])).rows[0]?.content;
    if (!draft) throw new AppError('DRAFT_NOT_FOUND', '草稿不存在', 404);
    const content = equipmentBaseline(draft, templateId); return { content, digest: contentDigest(content) };
  }
  async confirm(draftId: string, input: BaselineInput): Promise<AcceptanceBaseline> {
    if (input.confirmed !== true) throw new AppError('BASELINE_CONFIRMATION_REQUIRED', '请先审阅并确认验收基线', 422);
    const template = input.templateId;
    if (template !== 'equipment-read@1' && template !== 'equipment-workorder@1') throw new AppError('UNKNOWN_BASELINE_TEMPLATE', '验收模板未登记', 422);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const latest = (await client.query<{ revision: number }>('SELECT revision FROM drafts WHERE id=$1 FOR UPDATE', [draftId])).rows[0];
      if (!latest) throw new AppError('DRAFT_NOT_FOUND', '草稿不存在', 404);
      if (latest.revision !== input.expectedRevision) throw new AppError('REVISION_CONFLICT', '需求已变更，请重新审阅验收基线', 409);
      const draft = (await client.query<{ content: Draft }>('SELECT content FROM draft_revisions WHERE draft_id=$1 AND revision=$2', [draftId, input.expectedRevision])).rows[0]!.content;
      if (Object.values(draft.brief).some(field => !field.confirmed || !field.value.trim())) throw new AppError('BRIEF_NOT_CONFIRMED', '请补齐并确认需求', 422);
      const content = equipmentBaseline(draft, template); const digest = contentDigest(content);
      if (input.expectedDigest !== digest) throw new AppError('BASELINE_PREVIEW_MISMATCH', '验收草案已变化，请重新审阅后确认', 409);
      const old = (await client.query<{ record: AcceptanceBaseline }>('SELECT record FROM acceptance_baselines WHERE draft_id=$1 AND digest=$2', [draftId, digest])).rows[0]?.record;
      if (old) { await client.query('COMMIT'); return old; }
      const record: AcceptanceBaseline = { id: this.ids.next(), draftId, draftRevision: draft.revision, digest, confirmedAt: this.clock.now(), confirmedBy: 'local-operator', content };
      await client.query('INSERT INTO acceptance_baselines(id,draft_id,draft_revision,digest,record) VALUES ($1,$2,$3,$4,$5)', [record.id, draftId, draft.revision, digest, record]);
      await client.query('COMMIT'); return record;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async get(id: string): Promise<AcceptanceBaseline> {
    const record = (await this.pool.query<{ record: AcceptanceBaseline }>('SELECT record FROM acceptance_baselines WHERE id=$1', [id])).rows[0]?.record;
    if (!record) throw new AppError('BASELINE_NOT_FOUND', '验收基线不存在', 404);
    if (contentDigest(record.content) !== record.digest) throw new AppError('BASELINE_INTEGRITY_ERROR', '验收基线摘要校验失败', 409); return record;
  }
  async list(draftId: string): Promise<AcceptanceBaseline[]> {
    const rows = await this.pool.query<{ record: AcceptanceBaseline }>("SELECT record FROM acceptance_baselines WHERE draft_id=$1 ORDER BY record->>'confirmedAt' DESC,id", [draftId]);
    return rows.rows.map(row => row.record);
  }
  async assertTarget(id: string, snapshot: Snapshot) {
    const baseline = await this.get(id);
    if(baseline.content.templateId==='equipment-workorder@1'&&baseline.content.rulesVersion!=='equipment-workorder-assertions@2')throw new AppError('BASELINE_RULES_CHANGED','工单验收规则已更新，请重新审阅并确认基线',409);
    if (contentDigest(snapshot.content) !== snapshot.digest) throw new AppError('SNAPSHOT_INTEGRITY_ERROR', '快照摘要校验失败', 409);
    if (snapshot.draftId !== baseline.draftId || snapshot.draftRevision !== baseline.draftRevision) throw new AppError('BASELINE_TARGET_MISMATCH', '验收基线与需求版本不匹配', 409);
    const operations = snapshot.content.runtimeSpec.tools.map(tool => tool.operationId).sort();
    const covered = baseline.content.templateId === 'equipment-workorder@1' ? ['equipment-status','work-order-create'] : ['equipment-status'];
    if (JSON.stringify(operations) !== JSON.stringify(covered)) throw new AppError('BASELINE_COVERAGE_MISMATCH', '此验收基线不覆盖该版本绑定的工具', 409);
    return baseline;
  }
}
