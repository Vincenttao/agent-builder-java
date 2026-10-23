import { createHash } from 'node:crypto';
import type { AssemblyInput, RuntimeSpec } from '../../../../../packages/contracts/src/index.js';
import { AppError } from '../../shared/errors.js';
import { canonicalJson } from '../../../../../packages/contracts/src/canonical.js';

const rails = new Map([['audit@1', 'audit'], ['tool-allowlist@1', 'tool-allowlist'], ['write-confirm@1', 'write-confirm']]);
const generatedRail = /^tool-call-limit@1:(?:[1-9]|1[0-9]|20)$/;
const tools = new Map<string, RuntimeSpec['tools'][number]>([['equipment-status@1', {
  name: 'get_equipment', description: '按设备编号查询 Mock 设备状态；equipmentId 必填，例如 PUMP-001。',
  operationId: 'equipment-status', inputFields: { equipmentId: 'string' },
  responseFields: { equipmentId: 'string', status: 'string', temperatureCelsius: 'integer', source: 'string' },
  protocol: 'http', connectionRef: 'enterprise-mock-http@1', toolVersion: 'equipment-status-http@1'
}], ['work-order-create@1', {
  name: 'create_work_order', description: '申请创建模拟维修工单；执行前必须获得用户确认。priority 为 normal 或 urgent。',
  operationId: 'work-order-create', inputFields: { equipmentId: 'string', description: 'string', priority: 'string' },
  responseFields: { workOrderId: 'string', status: 'string' },
  protocol: 'http', connectionRef: 'enterprise-mock-http@1', toolVersion: 'work-order-create-http@1'
}], ['equipment-status-mcp@1', {
  name: 'get_equipment_mcp', description: '通过已绑定的企业 Mock MCP 连接查询设备状态；equipmentId 必填，例如 PUMP-001。',
  operationId: 'equipment-status', inputFields: { equipmentId: 'string' },
  responseFields: { equipmentId: 'string', status: 'string', temperatureCelsius: 'integer', source: 'string' },
  protocol: 'mcp', connectionRef: 'enterprise-mock-mcp@1', remoteToolName: 'equipment_status', toolVersion: 'equipment-status-mcp@1'
}], ['maintenance-search@1', {
  name: 'search_maintenance_manuals', description: '检索设备维护资料。结果为空时必须明确说明依据不足，不得编造资料来源或维修结论。equipmentId 必填。',
  operationId: 'maintenance-search', inputFields: { equipmentId: 'string' },
  responseFields: { equipmentId: 'string', found: 'boolean', resultCount: 'integer' },
  protocol: 'http', connectionRef: 'enterprise-mock-http@1', toolVersion: 'maintenance-search-http@1'
}]]);
export function assemble(id: string, input: AssemblyInput): RuntimeSpec {
  const reasons: string[] = [];
  if (input.agentType !== 'DeepAgent') reasons.push('UNSUPPORTED_AGENT_TYPE');
  if (!input.systemPrompt.trim()) reasons.push('EMPTY_SYSTEM_PROMPT');
  if (!Number.isInteger(input.maxIterations) || input.maxIterations < 1 || input.maxIterations > 20) reasons.push('INVALID_ITERATION_LIMIT');
  if (new Set(input.railIds).size !== input.railIds.length) reasons.push('CONFLICTING_RAILS');
  if (!input.railIds.includes('tool-allowlist@1')) reasons.push('TOOL_ALLOWLIST_REQUIRED');
  if (input.toolIds.includes('work-order-create@1') && !input.railIds.includes('write-confirm@1')) reasons.push('WRITE_CONFIRM_REQUIRED');
  if (new Set(input.toolIds).size !== input.toolIds.length) reasons.push('DUPLICATE_TOOLS');
  for (const rail of input.railIds) if (!rails.has(rail) && !generatedRail.test(rail)) reasons.push(`UNKNOWN_RAIL:${rail}`);
  for (const tool of input.toolIds) if (!tools.has(tool)) reasons.push(`UNKNOWN_TOOL:${tool}`);
  if (reasons.length) throw new AppError('INVALID_ASSEMBLY', '装配配置不受支持', 422, { reasons });
  return { agent: { id: `snapshot-${id}`, type: input.agentType, systemPrompt: input.systemPrompt, maxIterations: input.maxIterations, rails: input.railIds.map(id => rails.get(id) ?? id) },
    tools: input.toolIds.map(id => structuredClone(tools.get(id)!)) };
}

export const contentDigest = (content: unknown) => createHash('sha256').update(canonicalJson(content)).digest('hex');
