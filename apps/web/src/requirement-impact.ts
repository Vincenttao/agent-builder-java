export interface RequirementImpact {
  confirmation: string;
  resourceGap: string;
}

/** Deterministic first-pass checks for explicit write intent in the requirement goal. */
export function requirementImpact(goal: string): RequirementImpact | null {
  const writeIntent = /创建.{0,8}(工单|订单|申请)|(?:工单|订单|申请).{0,8}(创建|提交)|允许.{0,8}(创建|写入)|执行.{0,8}写操作/u.test(goal);
  if (!writeIntent) return null;
  return {
    confirmation: '执行前需要用户确认工单内容；拒绝后不得调用写接口。',
    resourceGap: '当前需求未指定工单写入接口。请绑定已有接口，或在受限代码生成中基于已提供的接口契约生成适配。',
  };
}
