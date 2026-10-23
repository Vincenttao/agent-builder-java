import { describe, expect, it } from 'vitest';
import { requirementImpact } from './requirement-impact.js';

describe('requirementImpact', () => {
  it('does not add write constraints to a read-only goal', () => {
    expect(requirementImpact('只查询设备状态，不进行写操作')).toBeNull();
  });

  it('adds confirmation and a concrete resource gap when the goal adds work-order creation', () => {
    expect(requirementImpact('查询设备状态，并允许创建维修工单')).toEqual({
      confirmation: '执行前需要用户确认工单内容；拒绝后不得调用写接口。',
      resourceGap: '当前需求未指定工单写入接口。请绑定已有接口，或在受限代码生成中基于已提供的接口契约生成适配。',
    });
  });
});
