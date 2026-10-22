import { describe, expect, it } from 'vitest';
import { selectCapability } from './assembly-selection.js';
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
});
