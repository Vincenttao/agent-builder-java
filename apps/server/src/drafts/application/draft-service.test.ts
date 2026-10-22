import { describe, expect, it } from 'vitest';
import { DraftService } from './draft-service.js';
import { MemoryDraftRepository } from '../../../../../tests/support/memory-drafts.js';
import { draftInput } from '../../../../../tests/support/fixtures.js';

function fixture() {
  let at = '2026-10-22T01:00:00.000Z';
  const repository = new MemoryDraftRepository();
  const service = new DraftService(repository, { now: () => at }, { next: () => '1580c89a-afd3-41fd-88cb-07e766d1ab4e' });
  return { service, setTime: (value: string) => { at = value; } };
}
describe('TD-01/02 草稿行为', () => {
  it('AC-01: 无模型依赖也可创建、保存并恢复草稿', async () => {
    const { service } = fixture();
    const saved = await service.create(draftInput);
    expect(saved).toMatchObject({ ...draftInput, revision: 1, createdAt: '2026-10-22T01:00:00.000Z' });
    expect(await service.get(saved.id)).toEqual(saved);
    expect(await service.list()).toEqual([saved]);
  });
  it('AC-02: 更新保留字段来源与确认状态，修订递增', async () => {
    const { service, setTime } = fixture();
    const first = await service.create(draftInput);
    setTime('2026-10-22T02:00:00.000Z');
    const next = await service.update(first.id, { ...draftInput, name: '新名称', expectedRevision: 1 });
    expect(next).toMatchObject({ name: '新名称', revision: 2, brief: draftInput.brief, createdAt: first.createdAt, updatedAt: '2026-10-22T02:00:00.000Z' });
    expect(next).not.toHaveProperty('expectedRevision');
  });
  it('AC-14 部分: 旧修订更新冲突，不能覆盖新内容', async () => {
    const { service } = fixture();
    const first = await service.create(draftInput);
    await service.update(first.id, { ...draftInput, name: '新内容', expectedRevision: 1 });
    await expect(service.update(first.id, { ...draftInput, name: '旧页面内容', expectedRevision: 1 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await service.get(first.id)).toMatchObject({ name: '新内容', revision: 2 });
  });
  it('不存在的草稿明确返回未找到', async () => {
    await expect(fixture().service.get('missing')).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND', status: 404 });
  });
});
