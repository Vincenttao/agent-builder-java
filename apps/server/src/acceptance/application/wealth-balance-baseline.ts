import type { Draft } from '../../../../../packages/contracts/src/index.js';
import type { AcceptanceBaseline, BusinessCase, BusinessRequirement } from '../../../../../packages/contracts/src/baselines.js';

export function wealthBalanceBaseline(draft: Draft): AcceptanceBaseline['content'] {
  const requirements: BusinessRequirement[] = [
    { id: 'BR-BAL-001', text: draft.brief.goal.value, source: draft.brief.goal.source },
    { id: 'BR-BAL-002', text: draft.brief.output.value, source: draft.brief.output.source },
    { id: 'BR-BAL-003', text: '余额必须来自当前模拟账户查询；缺少账户编号先追问，接口失败时不编造余额或时间。', source: 'template' }
  ];
  const cases: BusinessCase[] = [
    { id: 'TC-BAL-001', scenario: 'balance-normal', title: '查询可用余额', requirementIds: ['BR-BAL-001','BR-BAL-002','BR-BAL-003'], required: true,
      input: '查询账户 A1001 的可用余额、币种和更新时间。', fault: 'normal', assertions: [
        { ruleId: 'run-succeeded', expected: true }, { ruleId: 'balance-report-schema', expected: 'account-balance@1' },
        { ruleId: 'balance-facts', expected: { accountId: 'A1001', currency: 'CNY', availableBalanceFen: 1000000, asOf: '2026-10-21T08:00:00.000Z' } },
        { ruleId: 'write-call-count', expected: 0 }
      ] },
    { id: 'TC-BAL-002', scenario: 'balance-missing-id', title: '缺少账户编号', requirementIds: ['BR-BAL-001','BR-BAL-003'], required: true,
      input: '查询我的可用余额。', fault: 'normal', assertions: [
        { ruleId: 'run-succeeded', expected: true }, { ruleId: 'asks-for-account-id', expected: true }, { ruleId: 'all-business-call-count', expected: 0 }
      ] },
    { id: 'TC-BAL-003', scenario: 'balance-tool-failure', title: '余额接口超时', requirementIds: ['BR-BAL-002','BR-BAL-003'], required: true,
      input: '查询账户 A1001 的余额。', fault: 'read-timeout', assertions: [
        { ruleId: 'run-succeeded', expected: true }, { ruleId: 'tool-error-evidence', expected: true },
        { ruleId: 'failure-output-no-facts', expected: true }, { ruleId: 'write-call-count', expected: 0 }
      ] }
  ];
  return { schemaVersion: 1, templateId: 'wealth-balance-read@1', draftId: draft.id, draftRevision: draft.revision,
    audience: draft.brief.audience.value, requirements, cases, seed: 'enterprise-default@1', rulesVersion: 'wealth-balance-assertions@2' };
}
