import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerToolProxy } from './tool-proxy.js';
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.map(app => app.close())); apps.length = 0; });
describe('business proxy uses trusted runtime context', () => {
  it('write proxy requires native call context and rejects model-supplied identity, approval and idempotency overrides', async () => {
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } }); apps.push(app);
    const runId = randomUUID(); let writes = 0; let bound = true;
    registerToolProxy(app, { token: 'proxy-012345678901234567890123456789', context: async id => ({ runId: id, environmentId: 'env', actorId: 'U1001', operations: bound ? ['work-order-create'] : [] }),
      invoke: async () => { throw new Error('read must not receive writes'); }, write: async (id, actor, call, operation) => {
        expect([id, actor, call, operation]).toEqual([runId, 'U1001', 'native-call', 'work-order-create']); writes++; return { status: 200, result: { workOrderId: 'WO-001' } };
      } });
    const payload = { equipmentId: 'PUMP-001', description: '检查', priority: 'normal' }; const url = '/internal/tool-proxy/operations/work-order-create';
    const headers = { authorization: 'Bearer proxy-012345678901234567890123456789', 'x-builder-session-id': runId, 'x-builder-tool-call-id': 'native-call' };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: { authorization: headers.authorization, 'x-builder-session-id': runId }, payload })).statusCode).toBe(400);
    for (const override of [{ actorId: 'U1002' }, { approved: true }, { idempotencyKey: 'model-key' }, { validationScenario:'workorder-changed-arguments' }, { url: 'http://localhost/admin' }]) expect((await app.inject({ method: 'POST', url, headers, payload: { ...payload, ...override } })).statusCode).toBe(400);
    bound = false; expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(403); expect(writes).toBe(0);
    bound = true; expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(200); expect(writes).toBe(1);
  });
  it('rejects absent credentials/context, spoofed identity and unknown operations without a downstream call', async () => {
    let calls = 0; let captured: unknown; const runId = randomUUID();
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } }); apps.push(app);
    registerToolProxy(app, { token: 'proxy-012345678901234567890123456789', context: async id => { expect(id).toBe(runId); return { runId, environmentId: 'environment-1', actorId: 'U1001', operations: ['equipment-status'] }; },
      invoke: async (context, operation, input) => { calls++; captured = { context, operation, input }; return { status: 200, result: { temperatureCelsius: 86 } }; } });
    const url = '/internal/tool-proxy/operations/equipment-status';
    const headers = { authorization: 'Bearer proxy-012345678901234567890123456789', 'x-builder-session-id': runId };
    expect((await app.inject({ method: 'POST', url, payload: { equipmentId: 'PUMP-001' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url, headers: { authorization: headers.authorization }, payload: { equipmentId: 'PUMP-001' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers, payload: { equipmentId: 'PUMP-001', actorId: 'U1002', url: 'http://localhost/admin' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/internal/tool-proxy/operations/reset', headers, payload: {} })).statusCode).toBe(404);
    expect(calls).toBe(0);
    expect((await app.inject({ method: 'POST', url, headers, payload: { equipmentId: 'PUMP-001' } })).statusCode).toBe(200);
    expect(calls).toBe(1); expect(captured).toMatchObject({ context: { actorId: 'U1001', runId }, operation: 'equipment-status', input: { equipmentId: 'PUMP-001' } });
  });
  it('rejects an operation absent from the pinned snapshot', async () => {
    const app = Fastify(); apps.push(app); let calls = 0;
    registerToolProxy(app, { token: 'proxy-012345678901234567890123456789', context: async id => ({ runId: id, environmentId: 'env', actorId: 'U1001', operations: [] }), invoke: async () => { calls++; return { status: 200, result: {} }; } });
    const response = await app.inject({ method: 'POST', url: '/internal/tool-proxy/operations/equipment-status', headers: { authorization: 'Bearer proxy-012345678901234567890123456789', 'x-builder-session-id': randomUUID() }, payload: { equipmentId: 'PUMP-001' } });
    expect(response.statusCode).toBe(403); expect(calls).toBe(0);
  });
});
