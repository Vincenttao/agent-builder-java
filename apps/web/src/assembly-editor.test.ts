import { describe, expect, it } from 'vitest';
import { selectCapability, selectMcpEquipmentTool, selectMaintenanceSearchTool, selectToolCallLimit } from './assembly-selection.js';
import { equipmentAssembly } from '../../../packages/contracts/src/equipment-template.js';
import { assemble } from '../../server/src/snapshots/domain/assembly.js';

describe('component selection', () => {
  it('updates default instructions with the capability while retaining the business goal', () => {
    const write = selectCapability(equipmentAssembly('维护设备'), true, '维护设备');
    expect(write.systemPrompt).toContain('维护设备');
    expect(write.systemPrompt).toContain('create_work_order');
    expect(selectCapability(write, false, '维护设备').systemPrompt).not.toContain('create_work_order');
  });
  it('adds work order dependencies and removes them when switching back, preserving custom instructions', () => {
    const initial = { ...equipmentAssembly(), systemPrompt: '自定义指令', maxIterations: 8 };
    const write = selectCapability(initial, true);
    expect(write.toolIds).toEqual(['equipment-status@1', 'work-order-create@1']);
    expect(write.railIds).toContain('write-confirm@1');
    expect(write.systemPrompt).toBe(initial.systemPrompt);
    expect(write.maxIterations).toBe(8);
    expect(assemble('example', write).tools).toHaveLength(2);
    const read = selectCapability(write, false);
    expect(read.railIds).not.toContain('write-confirm@1');
    expect(assemble('example', read).tools).toHaveLength(1);
    expect(initial.toolIds).toEqual(['equipment-status@1']);
  });
  it('assembles a bounded tool-call Rail template and removes it when disabled', () => {
    const initial = equipmentAssembly();
    const bounded = selectToolCallLimit(initial, true, 3);
    expect(bounded.railIds).toContain('tool-call-limit@1:3');
    expect(assemble('bounded', bounded).agent.rails).toContain('tool-call-limit@1:3');
    expect(selectToolCallLimit(bounded, false).railIds).not.toContain('tool-call-limit@1:3');
    expect(initial.railIds).not.toContain('tool-call-limit@1:3');
    expect(() => assemble('invalid-limit', { ...bounded, railIds: ['audit@1', 'tool-allowlist@1', 'tool-call-limit@1:21'] }))
      .toThrow('装配配置不受支持');
  });
  it('selects the MCP Tool beside the HTTP Tool without replacing either tool or its connection identity', () => {
    const http = equipmentAssembly();
    const both = selectMcpEquipmentTool(http, true);
    expect(both.toolIds).toEqual(['equipment-status@1', 'equipment-status-mcp@1']);
    expect(assemble('both-transports', both).tools.map(tool => tool.protocol ?? 'http')).toEqual(['http', 'mcp']);
    expect(selectMcpEquipmentTool(both, false).toolIds).toEqual(http.toolIds);
  });
  it('adds the maintenance search as an independent read-only Tool', () => {
    const initial = equipmentAssembly('maintenance lookup');
    const selected = selectMaintenanceSearchTool(initial, true);
    expect(selected.toolIds).toEqual(['equipment-status@1', 'maintenance-search@1']);
    expect(selectMaintenanceSearchTool(selected, false).toolIds).toEqual(['equipment-status@1']);
  });
});
