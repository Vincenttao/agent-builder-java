import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Pool } from '../../apps/server/src/db/pool.js';
import { migrate } from '../../apps/server/src/db/migrations.js';
import { MockRepository } from '../../apps/mock-services/src/repository.js';
import { createMockApp } from '../../apps/mock-services/src/app.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://builder_test:local-test-only@127.0.0.1:15432/builder_test';
const schema = `it_mock_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const controlToken = 'mock-admin-only-01234567890123456789';
const businessToken = 'mock-business-only-0123456789012345';
const repository = new MockRepository(pool);
it('a release before a delayed environment setup permanently prevents that Run reservation from becoming active',async()=>{
  const id=randomUUID();const runId=randomUUID();await repository.release(id,runId);
  await repository.create(id,{seed:'enterprise-default@1',fault:'normal',clock:'2026-10-21T08:00:00.000Z'});
  await expect(repository.reserve(id,runId)).rejects.toMatchObject({code:'RUN_RESERVATION_RETIRED'});
  expect((await repository.reset(id,1)).revision).toBe(2);
  await new MockRepository(pool).release(id,runId);await expect(repository.reserve(id,runId)).rejects.toMatchObject({code:'RUN_RESERVATION_RETIRED'});
});
const app = createMockApp({ repository, controlToken, businessToken, faultDelayMs: 1000 });
const auth = { authorization: `Bearer ${controlToken}` };
const input = { seed: 'enterprise-default@1', fault: 'normal', clock: '2026-10-21T08:00:00.000Z' };
const create = async (patch = {}) => {
  const id = randomUUID();
  const response = await app.inject({ method: 'PUT', url: `/control/environments/${id}`, headers: auth, payload: { ...input, ...patch } });
  expect(response.statusCode, response.body).toBe(201); return id;
};
const headers = (id: string, actor = 'U1001', runId = randomUUID()) => ({ authorization: `Bearer ${businessToken}`, 'x-environment-id': id, 'x-actor-id': actor, 'x-run-id': runId });
const calls = async (id: string) => (await app.inject({ url: `/control/environments/${id}/calls`, headers: auth })).json().items as Array<{ operation: string; status: number; runId: string; result: Record<string, unknown> }>;
beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); await migrate(pool, 'db/mock-migrations'); });
afterAll(async () => { await app.close(); await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });

describe('persistent enterprise Mock / external state evidence', () => {
  it('deduplicates work orders, binds their owner and reconciles committed writes after timeout', async () => {
    const id = await create({ fault: 'write-after-timeout' }); const key = randomUUID(); const context = { ...headers(id), 'idempotency-key': key };
    const request = { method: 'POST' as const, url: '/mock-business/v1/work-orders', headers: context, payload: { equipmentId: 'PUMP-001', description: '检查温度告警', priority: 'normal' } };
    const [a, b] = await Promise.all([app.inject(request), app.inject(request)]);
    expect(a.statusCode).toBe(200); expect(a.json()).toEqual(b.json());
    const lookup = await app.inject({ url: `/mock-business/v1/work-orders/by-key/${key}`, headers: headers(id) });
    expect(lookup.json()).toEqual(a.json()); expect(Object.keys((await repository.get(id)).state.workOrders ?? {})).toHaveLength(1);
    expect((await app.inject({ url: `/mock-business/v1/work-orders/by-key/${key}`, headers: headers(id, 'U1002') })).statusCode).toBe(404);
    expect((await app.inject({ ...request, payload: { ...request.payload, priority: 'urgent' } })).statusCode).toBe(409);
    expect((await app.inject({ ...request, headers: headers(id) })).statusCode).toBe(400);
    expect((await repository.get(id)).state.balances.A1001).toBe(1000000);
  });
  it('separates control and business authentication and rejects missing context', async () => {
    const id = await create();
    expect((await app.inject({ url: '/mock-business/v1/equipment/PUMP-001' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/mock-business/v1/equipment/PUMP-001', headers: auth })).statusCode).toBe(401);
    expect((await app.inject({ url: `/control/environments/${id}/calls`, headers: headers(id) })).statusCode).toBe(401);
    expect((await app.inject({ url: '/mock-business/v1/equipment/PUMP-001', headers: { authorization: `Bearer ${businessToken}` } })).statusCode).toBe(400);
    expect(await calls(id)).toEqual([]);
  });
  it('records actual equipment output, denied account access and immutable call history', async () => {
    const id = await create(); const context = headers(id);
    const response = await app.inject({ url: '/mock-business/v1/equipment/PUMP-001', headers: context });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ equipmentId: 'PUMP-001', status: 'warning', temperatureCelsius: 86, source: 'seed-equipment-001@1' });
    const denied = await app.inject({ url: '/mock-business/v1/accounts/A1002/balance', headers: context });
    expect(denied.statusCode).toBe(403); expect(denied.body).not.toContain('500000');
    expect(await calls(id)).toMatchObject([{ operation: 'equipment-status', status: 200, runId: context['x-run-id'] }, { operation: 'getAccountBalance', status: 403 }]);
    await expect(pool.query('DELETE FROM mock_calls WHERE environment_id=$1', [id])).rejects.toThrow('immutable');
    const restored = new MockRepository(pool); expect((await restored.get(id)).revision).toBe(1);
    expect((await restored.calls(id)).length).toBe(2);
  });
  it('atomically deduplicates writes, rejects changed parameters, and isolates environments', async () => {
    const id = await create(); const other = await create(); const context = { ...headers(id), 'idempotency-key': randomUUID() };
    const request = { method: 'POST' as const, url: '/mock-business/v1/wealth/orders', headers: context, payload: { accountId: 'A1001', productId: 'SIM-W001', amountFen: 100000 } };
    const [a, b] = await Promise.all([app.inject(request), app.inject(request)]);
    expect(a.statusCode).toBe(200); expect(a.json()).toEqual(b.json());
    const conflict = await app.inject({ ...request, payload: { ...request.payload, amountFen: 120000 } }); expect(conflict.statusCode).toBe(409);
    const balance = await app.inject({ url: '/mock-business/v1/accounts/A1001/balance', headers: context });
    expect(balance.json().availableBalanceFen).toBe(900000);
    expect((await app.inject({ url: '/mock-business/v1/accounts/A1001/balance', headers: headers(other) })).json().availableBalanceFen).toBe(1000000);
    expect((await calls(id)).filter(c => c.operation === 'createMockSubscription')).toHaveLength(3);
    const state = (await repository.get(id)).state;
    expect(Object.keys(state.orders)).toHaveLength(1); expect(state.holdings.A1001?.['SIM-W001']).toBe(100000);
  });
  it('rejects invalid and insufficient amounts without ledger effects; write-timeout retains reconcilable success', async () => {
    const low = await create({ seed: 'enterprise-low-balance@1' });
    const order = { accountId: 'A1001', productId: 'SIM-W001', amountFen: 100000 };
    const post = (id: string, key: string, amountFen: number) => app.inject({ method: 'POST', url: '/mock-business/v1/wealth/orders', headers: { ...headers(id), 'idempotency-key': key }, payload: { ...order, amountFen } });
    expect((await post(low, randomUUID(), 100000)).json().code).toBe('INSUFFICIENT_BALANCE');
    expect((await post(low, randomUUID(), -1)).json().code).toBe('INVALID_AMOUNT');
    expect(Object.keys((await repository.get(low)).state.orders)).toHaveLength(0);
    const id = await create({ fault: 'write-after-timeout' }); const key = randomUUID();
    const start = Date.now(); const result = await post(id, key, 100000);
    expect(Date.now() - start).toBeGreaterThanOrEqual(75); expect(result.statusCode).toBe(200);
    const recovered = await app.inject({ url: `/mock-business/v1/wealth/orders/by-key/${key}`, headers: headers(id) });
    expect(recovered.json()).toEqual(result.json());
    expect((await repository.get(id)).state.balances.A1001).toBe(900000);
  });
  it('prevents reset during a run, enforces revision and retains prior state batches', async () => {
    const id = await create(); const runId = randomUUID();
    await app.inject({ url: '/mock-business/v1/equipment/PUMP-001', headers: headers(id, 'U1001', runId) });
    await repository.reserve(id, runId);
    await expect(repository.reset(id, 1)).rejects.toMatchObject({ code: 'ENVIRONMENT_IN_USE' });
    await repository.release(id, runId);
    await expect(repository.reset(id, 2)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await repository.reset(id, 1)).revision).toBe(2);
    expect(await calls(id)).toHaveLength(1);
    const collision = await app.inject({ method: 'PUT', url: `/control/environments/${id}`, headers: auth, payload: { ...input, fault: 'read-timeout' } });
    expect(collision.statusCode).toBe(409);
  });
  it('preserves a committed order after the real HTTP caller times out and retries the same key', async () => {
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const id = await create({ fault: 'write-after-timeout' }); const key = randomUUID();
    const context = { ...headers(id), 'idempotency-key': key, 'content-type': 'application/json' };
    // Abort at the observed commit boundary; a fixed 50 ms timer could fire before admission under load.
    const controller = new AbortController();
    const pending = fetch(`${base}/mock-business/v1/wealth/orders`, { method: 'POST', headers: context,
      body: JSON.stringify({ accountId: 'A1001', productId: 'SIM-W001', amountFen: 100000 }), signal: controller.signal });
    const outcome = pending.then(response => ({ response }), error => ({ error }));
    await expect.poll(async () => Object.keys((await repository.get(id)).state.orders).length, { interval: 5 }).toBe(1);
    controller.abort(); expect(await outcome).toHaveProperty('error');
    const response = await fetch(`${base}/mock-business/v1/wealth/orders/by-key/${key}`, { headers: context });
    expect(response.status).toBe(200); const order = await response.json();
    const retry = await app.inject({ method: 'POST', url: '/mock-business/v1/wealth/orders', headers: context, payload: { accountId: 'A1001', productId: 'SIM-W001', amountFen: 100000 } });
    expect(retry.json()).toEqual(order); expect(Object.keys((await repository.get(id)).state.orders)).toHaveLength(1);
    expect((await repository.get(id)).state.balances.A1001).toBe(900000);
  });
});
