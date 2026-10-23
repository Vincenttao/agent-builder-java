import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canonicalJson } from '../../../packages/contracts/src/canonical.js';
import {mockSceneContent} from './scene.js';

export class MockError extends Error { constructor(public code: string, public status = 409) { super(code); } }
export interface EnvironmentConfig { seed: 'enterprise-default@1' | 'enterprise-low-balance@1'; fault: 'normal' | 'read-timeout' | 'write-before-failure' | 'write-after-timeout' | 'missing-field'; clock: string }
interface Order { orderId: string; accountId: string; productId: string; amountFen: number; status: string; createdAt: string }
interface WorkOrder { workOrderId: string; equipmentId: string; description: string; priority: string; actorId: string; status: string; createdAt: string }
export interface BusinessState { balances: Record<string, number>; holdings: Record<string, Record<string, number>>; orders: Record<string, Order>; keys: Record<string, { input: string; orderId: string }>;
  workOrders?: Record<string, WorkOrder>; workOrderKeys?: Record<string, { input: string; workOrderId: string }> }
export interface MockEnvironment { id: string; config: EnvironmentConfig; revision: number; state: BusinessState }
export interface BusinessContext { environmentId: string; actorId: string; runId: string; idempotencyKey?: string }
const seed = (config: EnvironmentConfig): BusinessState => {const profile=mockSceneContent.seeds.find(item=>item.id===config.seed)!;return{balances:Object.fromEntries(profile.accounts.map(account=>[account.accountId,account.availableBalanceFen])),holdings:Object.fromEntries(profile.accounts.map(account=>[account.accountId,{}])),orders:{},keys:{}};};
export class MockRepository {
  constructor(private readonly pool: Pool) {}
  async ready() { await this.pool.query('SELECT id FROM mock_environments LIMIT 0'); return true; }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async create(id: string, config: EnvironmentConfig) {
    await this.pool.query('INSERT INTO mock_environments(id,config,revision,state) VALUES ($1,$2,1,$3) ON CONFLICT DO NOTHING', [id, config, seed(config)]);
    const env = await this.get(id);
    if (canonicalJson(env.config) !== canonicalJson(config)) throw new MockError('ENVIRONMENT_INPUT_CONFLICT');
    return env;
  }
  async get(id: string): Promise<MockEnvironment> {
    const { rows } = await this.pool.query<MockEnvironment>('SELECT id,config,revision,state FROM mock_environments WHERE id=$1', [id]);
    if (!rows[0]) throw new MockError('ENVIRONMENT_NOT_FOUND', 404); return rows[0];
  }
  private async locked(client: PoolClient, id: string) {
    const { rows } = await client.query<MockEnvironment>('SELECT id,config,revision,state FROM mock_environments WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) throw new MockError('ENVIRONMENT_NOT_FOUND', 404); return rows[0];
  }
  async reserve(id: string, runId: string) {
    await this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,183421059))',[`${id}/${runId}`]);
      if((await client.query('SELECT 1 FROM mock_retired_reservations WHERE environment_id=$1 AND run_id=$2',[id,runId])).rowCount)throw new MockError('RUN_RESERVATION_RETIRED');
      await this.locked(client, id); await client.query('INSERT INTO mock_reservations(environment_id,run_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, runId]);
    });
  }
  async release(id: string, runId: string) {
    await this.transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,183421059))',[`${id}/${runId}`]);
      await client.query('INSERT INTO mock_retired_reservations(environment_id,run_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,runId]);
      await client.query('UPDATE mock_reservations SET active=false WHERE environment_id=$1 AND run_id=$2',[id,runId]);
    });
  }
  async reset(id: string, expectedRevision: number) {
    return this.transaction(async client => {
      const env = await this.locked(client, id);
      if (env.revision !== expectedRevision) throw new MockError('REVISION_CONFLICT');
      if ((await client.query('SELECT 1 FROM mock_reservations WHERE environment_id=$1 AND active', [id])).rowCount) throw new MockError('ENVIRONMENT_IN_USE');
      await client.query('INSERT INTO mock_batches(environment_id,revision,state) VALUES ($1,$2,$3)', [id, env.revision, env.state]);
      env.state = seed(env.config); env.revision++;
      await client.query('UPDATE mock_environments SET state=$2,revision=$3 WHERE id=$1', [id, env.state, env.revision]); return env;
    });
  }
  async calls(id: string, after = 0, runId?: string) {
    await this.get(id);
    return (await this.pool.query('SELECT seq::integer, state_revision AS "stateRevision", run_id AS "runId", actor_id AS "actorId", operation,input,status,result,created_at AS "createdAt" FROM mock_calls WHERE environment_id=$1 AND seq>$2 AND ($3::uuid IS NULL OR run_id=$3) ORDER BY seq LIMIT 1000', [id, after, runId ?? null])).rows;
  }
  async invoke(context: BusinessContext, operation: string, input: Record<string, unknown>) {
    return this.transaction(async client => {
      const env = await this.locked(client, context.environmentId);
      const write = operation === 'createMockSubscription' || operation === 'work-order-create';
      let status = 200; let result: Record<string, unknown>; let changed = false;
      try {
        if (!['U1001', 'U1002'].includes(context.actorId)) throw new MockError('FORBIDDEN', 403);
        if (write && env.config.fault === 'write-before-failure') throw new MockError('INJECTED_WRITE_FAILURE', 503);
        const before = canonicalJson(env.state); result = this.business(env, context, operation, input);
        changed = before !== canonicalJson(env.state);
        if (!write && env.config.fault === 'missing-field') { result = { ...result }; delete result['temperatureCelsius']; delete result['availableBalanceFen']; }
      } catch (error) {
        if (!(error instanceof MockError)) throw error;
        status = error.status; result = { code: error.code, message: error.code, correlationId: context.runId };
      }
      if (changed) { env.revision++; await client.query('UPDATE mock_environments SET state=$2,revision=$3 WHERE id=$1', [env.id, env.state, env.revision]); }
      await client.query('INSERT INTO mock_calls(environment_id,state_revision,run_id,actor_id,operation,input,status,result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [env.id, env.revision, context.runId, context.actorId, operation, input, status, result]);
      return { status, result, delay: (!write && env.config.fault === 'read-timeout') || (write && status === 200 && env.config.fault === 'write-after-timeout') };
    });
  }
  private business(env: MockEnvironment, context: BusinessContext, operation: string, input: Record<string, unknown>): Record<string, unknown> {
    const account = (id: unknown) => {
      if (typeof id !== 'string' || !(id in env.state.balances)) throw new MockError('ACCOUNT_NOT_FOUND', 404);
      if (id !== (context.actorId === 'U1001' ? 'A1001' : 'A1002')) throw new MockError('FORBIDDEN', 403); return id;
    };
    const profile=mockSceneContent.seeds.find(item=>item.id===env.config.seed)!;
    const product = (id: unknown) => { const p = profile.products.find(p => p.productId === id); if (!p) throw new MockError('PRODUCT_NOT_FOUND', 404); return p; };
    switch (operation) {
      case 'work-order-by-key': {
        const key = env.state.workOrderKeys?.[`${context.actorId}:${String(input.key)}`]; if (!key) throw new MockError('NOT_FOUND', 404);
        return { ...env.state.workOrders![key.workOrderId]! };
      }
      case 'work-order-create': {
        if (input.equipmentId !== 'PUMP-001') throw new MockError('EQUIPMENT_NOT_FOUND', 404);
        if (typeof input.description !== 'string' || !input.description.trim() || input.description.length > 2000 || !['normal','urgent'].includes(String(input.priority))) throw new MockError('INVALID_WORK_ORDER', 422);
        if (!context.idempotencyKey) throw new MockError('IDEMPOTENCY_KEY_REQUIRED', 400);
        const key = `${context.actorId}:${context.idempotencyKey}`; const digest = canonicalJson(input); const existing = env.state.workOrderKeys?.[key];
        if (existing) { if (existing.input !== digest) throw new MockError('IDEMPOTENCY_CONFLICT'); return { ...env.state.workOrders![existing.workOrderId]! }; }
        const order: WorkOrder = { workOrderId: randomUUID(), equipmentId: input.equipmentId, description: input.description, priority: String(input.priority), actorId: context.actorId, status: 'created', createdAt: env.config.clock };
        (env.state.workOrders ??= {})[order.workOrderId] = order; (env.state.workOrderKeys ??= {})[key] = { input: digest, workOrderId: order.workOrderId }; return { ...order };
      }
      case 'equipment-status':
        {const item=profile.equipment.find(item=>item.equipmentId===input.equipmentId);if(!item)throw new MockError('EQUIPMENT_NOT_FOUND',404);return structuredClone(item);}
      case 'maintenance-search':
        if (typeof input.equipmentId !== 'string' || !input.equipmentId.trim() || input.equipmentId.length > 80) throw new MockError('INVALID_EQUIPMENT_ID', 400);
        // The demo scene intentionally has no maintenance documents. Return explicit empty search evidence.
        return { equipmentId: input.equipmentId, found: false, resultCount: 0 };
      case 'getAccountBalance': { const id = account(input.accountId); return { accountId: id, currency: 'CNY', availableBalanceFen: env.state.balances[id], asOf: env.config.clock }; }
      case 'listWealthProducts': return { items: profile.products, version: 'seed-finance-001@1' };
      case 'getWealthProduct': return product(input.productId);
      case 'listHoldings': { const id = account(input.accountId); return { accountId: id, items: Object.entries(env.state.holdings[id] ?? {}).map(([productId, amountFen]) => ({ productId, amountFen })) }; }
      case 'getOrderByIdempotencyKey': {
        const key = env.state.keys[`${context.actorId}:${String(input.key)}`]; if (!key) throw new MockError('NOT_FOUND', 404);
        return { ...env.state.orders[key.orderId]! };
      }
      case 'getMockOrder': {
        const order = env.state.orders[String(input.orderId)]; if (!order) throw new MockError('NOT_FOUND', 404); account(order.accountId); return { ...order };
      }
      case 'createMockSubscription': {
        const accountId = account(input.accountId); const p = product(input.productId); const amount = input.amountFen;
        if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount < p.minimumAmountFen) throw new MockError('INVALID_AMOUNT', 422);
        if (!context.idempotencyKey) throw new MockError('IDEMPOTENCY_KEY_REQUIRED', 400);
        const key = `${context.actorId}:${context.idempotencyKey}`; const digest = canonicalJson(input); const existing = env.state.keys[key];
        if (existing) { if (existing.input !== digest) throw new MockError('IDEMPOTENCY_CONFLICT'); return { ...env.state.orders[existing.orderId]! }; }
        if (p.status !== 'available') throw new MockError('PRODUCT_UNAVAILABLE', 422);
        if (env.state.balances[accountId]! < amount) throw new MockError('INSUFFICIENT_BALANCE', 422);
        const order: Order = { orderId: randomUUID(), accountId, productId: p.productId, amountFen: amount, status: 'succeeded', createdAt: env.config.clock };
        env.state.balances[accountId]! -= amount;
        const holdings = env.state.holdings[accountId]!; holdings[p.productId] = (holdings[p.productId] ?? 0) + amount;
        env.state.orders[order.orderId] = order; env.state.keys[key] = { input: digest, orderId: order.orderId }; return { ...order };
      }
      default: throw new MockError('OPERATION_NOT_ALLOWED', 422);
    }
  }
}
