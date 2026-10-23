import type { AssemblyInput } from '../../../packages/contracts/src/index.js';
import { equipmentAssembly, workOrderAssembly } from '../../../packages/contracts/src/equipment-template.js';

export function selectCapability(current: AssemblyInput, workOrder: boolean, goal = ''): AssemblyInput {
  const preset = workOrder ? workOrderAssembly(goal) : equipmentAssembly(goal);
  const defaultPrompt = [equipmentAssembly(goal).systemPrompt, workOrderAssembly(goal).systemPrompt].includes(current.systemPrompt);
  return { ...current, toolIds: preset.toolIds, railIds: preset.railIds,
    ...(defaultPrompt ? { systemPrompt: preset.systemPrompt, maxIterations: preset.maxIterations } : {}) };
}

export function selectToolCallLimit(current: AssemblyInput, enabled: boolean, maximum = 1): AssemblyInput {
  const prefix = 'tool-call-limit@1:';
  const railIds = current.railIds.filter(id => !id.startsWith(prefix));
  if (enabled) railIds.push(`${prefix}${maximum}`);
  return { ...current, railIds };
}

export function selectMcpEquipmentTool(current: AssemblyInput, enabled: boolean): AssemblyInput {
  const toolId = 'equipment-status-mcp@1';
  const toolIds = current.toolIds.filter(id => id !== toolId);
  if (enabled) toolIds.push(toolId);
  return { ...current, toolIds };
}

export function selectMaintenanceSearchTool(current: AssemblyInput, enabled: boolean): AssemblyInput {
  const toolId = 'maintenance-search@1';
  const toolIds = current.toolIds.filter(id => id !== toolId);
  if (enabled) toolIds.push(toolId);
  return { ...current, toolIds };
}

export const componentCatalog = [
  { id: 'equipment-status@1', kind: 'Tool', name: '设备状态查询', description: '查询设备状态、温度和数据来源。设备编号缺失时先追问。', detail: 'GET · enterprise-mock-http@1', status: '内置可用' },
  { id: 'maintenance-search@1', kind: 'Tool', name: '维护资料检索', description: '检索维护资料；空结果需要明确告知用户依据不足。', detail: 'GET · enterprise-mock-http@1', status: '内置可用' },
  { id: 'equipment-status-mcp@1', kind: 'Tool', name: '设备查询（MCP）', description: '通过版本化远程 MCP 连接查询同一 Mock 设备状态。', detail: 'equipment_status · enterprise-mock-mcp@1', status: '内置可用' },
  { id: 'work-order-create@1', kind: 'Tool', name: '维修工单创建', description: '查询设备后申请维修工单，等待用户确认后执行写入。', detail: 'create_work_order · 依赖设备查询与写入确认', status: '内置可用' },
  { id: 'equipment-query', kind: 'Skill', name: '设备查询 Skill', description: '指导模型使用设备查询工具。由开发 Agent 生成 SKILL.md，与生成 Tool 一起固定在候选制品中。', detail: '仅设备只读场景 · 生成后在候选来源中选择', status: '需自动开发' },
  { id: 'audit@1', kind: 'Rail', name: '执行审计', description: '记录模型输出与工具执行事件，支持轨迹查看和证据核验。', detail: '两种能力模板默认启用', status: '内置可用' },
  { id: 'tool-allowlist@1', kind: 'Rail', name: '工具白名单', description: '只允许 Agent 调用当前装配中注册的工具。', detail: '所有装配必需', status: '内置可用' },
  { id: 'write-confirm@1', kind: 'Rail', name: '写入确认', description: '拦截工单写操作并等待用户确认，配合平台执行审批控制。', detail: '选择工单 Tool 时自动启用', status: '内置可用' },
  { id: 'tool-call-limit@1', kind: 'Rail', name: '单次工具调用上限', description: '限制每次任务允许执行的工具调用次数；超过上限时在调用前终止。', detail: '已审阅固定模板 · 参数范围 1–20', status: '可配置模板' }
] as const;
