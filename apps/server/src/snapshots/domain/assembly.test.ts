import { expect, it } from 'vitest';
import { assemble } from './assembly.js';

it('binds MCP protocol, versioned connection reference and remote tool identity into the immutable runtime spec', () => {
  const spec = assemble('snapshot-id', { agentType: 'DeepAgent', systemPrompt: 'query equipment', maxIterations: 4,
    railIds: ['tool-allowlist@1'], toolIds: ['equipment-status-mcp@1'] });
  expect(spec.tools).toContainEqual(expect.objectContaining({ name: 'get_equipment_mcp', operationId: 'equipment-status',
    protocol: 'mcp', connectionRef: 'enterprise-mock-mcp@1', remoteToolName: 'equipment_status', toolVersion: 'equipment-status-mcp@1' }));
});

it('assembles the versioned maintenance manual search as a read-only HTTP Tool', () => {
  const spec = assemble('snapshot-id', { agentType: 'DeepAgent', systemPrompt: 'Search manuals and report when evidence is empty.', maxIterations: 4,
    railIds: ['tool-allowlist@1'], toolIds: ['maintenance-search@1'] });
  expect(spec.tools).toContainEqual(expect.objectContaining({ name: 'search_maintenance_manuals', operationId: 'maintenance-search',
    inputFields: { equipmentId: 'string' }, responseFields: { equipmentId: 'string', found: 'boolean', resultCount: 'integer' },
    protocol: 'http', connectionRef: 'enterprise-mock-http@1', toolVersion: 'maintenance-search-http@1' }));
});
