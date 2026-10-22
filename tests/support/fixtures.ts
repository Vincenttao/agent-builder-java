import type { DraftInput } from '../../packages/contracts/src/index.js';
export const draftInput: DraftInput = {
  name: '余额查询助手', brief: {
    audience: { value: '企业 AI 平台开发人员', source: 'user', confirmed: true },
    goal: { value: '查询模拟账户余额', source: 'user', confirmed: true },
    output: { value: '余额和币种', source: 'template', confirmed: false }
  }
};
