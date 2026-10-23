import { afterAll, expect, it, vi } from 'vitest';
import { createMockApp } from './app.js';
import type { MockRepository } from './repository.js';

const invocation = vi.fn(async (_context: unknown, _operation: string, _input: Record<string, unknown>) => ({
  status: 200, result: { equipmentId: 'PUMP-001', status: 'warning', temperatureCelsius: 82, source: 'mock-equipment@1' }, delay: false
}));
const app = createMockApp({ repository: { invoke: invocation } as unknown as MockRepository,
  controlToken: 'mock-mcp-control-token-0123456789', businessToken: 'mock-mcp-business-token-0123456789' });
afterAll(async () => app.close());

it('serves the registered business capability over MCP Streamable HTTP and records normal mock evidence', async () => {
  const headers = { authorization: 'Bearer mock-mcp-business-token-0123456789', 'x-environment-id': 'e0131ad8-0000-4000-8000-000000000001',
    'x-run-id': 'e0131ad8-0000-4000-8000-000000000002', 'x-actor-id': 'U1001' };
  const init = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'agent-builder-test', version: '1' } } } });
  expect(init.statusCode).toBe(200);
  expect(init.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'agent-builder-mock', version: expect.any(String) } } });
  const unsupported = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 9, method: 'initialize', params: { protocolVersion: '1900-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' } } } });
  expect(unsupported.statusCode).toBe(400); expect(unsupported.json()).toMatchObject({ error: { code: -32602 } });
  expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } })).statusCode).toBe(202);
  const list = await app.inject({ method: 'POST', url: '/mcp', headers: { ...headers, 'mcp-session-id': init.headers['mcp-session-id'] ?? '' }, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } });
  expect(list.statusCode).toBe(200);
  expect(list.json().result.tools).toContainEqual(expect.objectContaining({ name: 'equipment_status', _meta: { version: 'equipment-status-mcp@1' }, inputSchema: expect.objectContaining({ required: ['equipmentId'] }) }));
  const call = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'equipment_status', arguments: { equipmentId: 'PUMP-001' } } } });
  expect(call.statusCode).toBe(200);
  expect(call.json()).toMatchObject({ jsonrpc: '2.0', id: 3, result: { isError: false, structuredContent: { equipmentId: 'PUMP-001', status: 'warning' } } });
  expect(invocation).toHaveBeenCalledWith({ environmentId: headers['x-environment-id'], runId: headers['x-run-id'], actorId: 'U1001' }, 'equipment-status', { equipmentId: 'PUMP-001' });
});
