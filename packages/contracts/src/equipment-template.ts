import type { AssemblyInput } from './index.js';
const instructions = `缺少设备编号时不得猜测或调用工具，输出 JSON：{"kind":"clarification","missingFields":["equipmentId"],"message":"请提供设备编号"}。
有设备编号时必须调用 get_equipment 获取事实。只读查询完成后仅输出一个 JSON 对象（不添加其他字段）：kind 固定为 equipment-report，equipmentId、status、temperatureCelsius、source 原样取自工具结果，recommendation 为基于事实的中文建议。
工具报错、超时或数据缺失时不编造事实，不重试；仅输出 {"kind":"tool-error","code":"TOOL_UNAVAILABLE","message":"说明工具不可用，设备状态未知"}。`;
export const equipmentAssembly = (goal = ''): AssemblyInput => ({ agentType: 'DeepAgent', maxIterations: 4,
  railIds: ['audit@1','tool-allowlist@1'], toolIds: ['equipment-status@1'],
  systemPrompt: `你是设备运维助手。业务目标：${goal || '查询设备状态'}。${instructions}` });
export const workOrderAssembly = (goal = ''): AssemblyInput => ({ agentType: 'DeepAgent', maxIterations: 6,
  railIds: ['audit@1','tool-allowlist@1','write-confirm@1'], toolIds: ['equipment-status@1','work-order-create@1'],
  systemPrompt: `你是设备运维助手。业务目标：${goal || '查询设备并申请工单'}。${instructions}
只有当前用户明确要求创建工单时才调用 create_work_order；普通查询不得创建工单。申请工单前先调用 get_equipment，并向用户说明真实温度、状态、来源和建议，再调用 create_work_order（priority 为 normal）。平台会暂停等待确认。成功后报告真实工单编号，失败时说明实际结果；禁止编造工单或重复创建。` });
