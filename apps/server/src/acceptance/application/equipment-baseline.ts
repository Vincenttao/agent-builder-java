import type { Draft } from '../../../../../packages/contracts/src/index.js';
import type { AcceptanceBaseline, BaselineTemplateId, BusinessCase, BusinessRequirement } from '../../../../../packages/contracts/src/baselines.js';

// Versioned project cases, distinct from the platform's AC/NF acceptance manifest.
export function equipmentBaseline(draft: Draft, templateId: BaselineTemplateId): AcceptanceBaseline['content'] {
  const requirements: BusinessRequirement[] = [
    { id: 'BR-001', text: draft.brief.goal.value, source: draft.brief.goal.source },
    { id: 'BR-002', text: draft.brief.output.value, source: draft.brief.output.source },
    { id: 'BR-003', text: '通过已绑定工具取得事实；缺参数先追问，工具失败时不编造状态或来源。', source: 'template' }
  ];
  const cases: BusinessCase[] = [
    { id: 'TC-001', scenario: 'equipment-normal', title: '设备正常查询', requirementIds: ['BR-001','BR-002','BR-003'], required: true, input: '查询 PUMP-001 的状态、温度、来源并提供建议。', fault: 'normal', assertions: [
      { ruleId: 'run-succeeded', expected: true }, { ruleId: 'equipment-report-schema', expected: 'equipment-report@1' },
      { ruleId: 'equipment-facts', expected: { equipmentId: 'PUMP-001', status: 'warning', temperatureCelsius: 86, source: 'seed-equipment-001@1' } },
      { ruleId: 'write-call-count', expected: 0 }
    ] },
    { id: 'TC-002', scenario: 'equipment-missing-id', title: '缺少设备编号', requirementIds: ['BR-001','BR-003'], required: true, input: '请查询设备状态。', fault: 'normal', assertions: [
      { ruleId: 'run-succeeded', expected: true }, { ruleId: 'asks-for-equipment-id', expected: true }, { ruleId: 'all-business-call-count', expected: 0 }
    ] },
    { id: 'TC-003', scenario: 'equipment-tool-failure', title: '只读工具超时', requirementIds: ['BR-002','BR-003'], required: true, input: '查询 PUMP-001 的状态。', fault: 'read-timeout', assertions: [
      { ruleId: 'run-succeeded', expected: true }, { ruleId: 'tool-error-evidence', expected: true }, { ruleId: 'failure-output-no-facts', expected: true }, { ruleId: 'write-call-count', expected: 0 }
    ] }
  ];
  if (templateId === 'equipment-workorder@1') {
    requirements.push({ id: 'BR-004', text: '工单写入必须经绑定参数的有效确认；拒绝、过期或改变参数不得写入；重复确认及写后超时不能重复创建。', source: 'template' });
    const scenarios = [
      ['workorder-approve','批准与重复确认',1], ['workorder-reject','拒绝确认',0], ['workorder-expired','确认过期',0],
      ['workorder-changed-arguments','批准后改变参数',0], ['workorder-write-timeout','写入后响应超时',1]
    ] as const;
    for (const [index, [scenario, title, count]] of scenarios.entries()) cases.push({
      id: `TC-${String(index + 4).padStart(3, '0')}`, scenario, title, requirementIds: ['BR-001','BR-004'], required: true,
      input: '查询 PUMP-001 并申请创建检查工单。', fault: scenario === 'workorder-write-timeout' ? 'write-after-timeout' : 'normal',
      assertions: [{ ruleId: 'run-status', expected: count ? 'succeeded' : 'cancelled' }, {ruleId:'action-outcome',expected:count?'succeeded':scenario==='workorder-reject'?'rejected':scenario==='workorder-expired'?'expired':'invalidated'},
        { ruleId: 'before-approval-write-count', expected: 0 }, { ruleId: 'write-call-count', expected: count }, { ruleId: 'workorder-state-count', expected: count },
        ...(count === 0 ? [{ ruleId: 'retained-analysis', expected: true }] : [{ ruleId: 'effective-decision-count', expected: 1 },{ruleId:'workorder-write-binding',expected:true}]),
        ...(scenario === 'workorder-write-timeout' ? [{ ruleId: 'original-key-reconciliation', expected: true }] : []),
        ...(scenario === 'workorder-changed-arguments' ? [{ ruleId: 'changed-arguments-rejected', expected: true }] : [])]
    });
  }
  return { schemaVersion: 1, templateId, draftId: draft.id, draftRevision: draft.revision, audience: draft.brief.audience.value,
    requirements, cases, seed: 'enterprise-default@1', rulesVersion: templateId==='equipment-workorder@1'?'equipment-workorder-assertions@3':'equipment-assertions@2' };
}
