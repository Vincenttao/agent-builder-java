import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MockError, type BusinessContext, type EnvironmentConfig, type MockRepository } from './repository.js';
import { uuidParamsSchema } from '../../../packages/contracts/src/runtime.js';
export interface MockAppOptions { repository: MockRepository; controlToken: string; businessToken: string; faultDelayMs?: number }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function createMockApp(options: MockAppOptions) {
  // Fingerprint the loaded implementation, not a manually maintained version label.
  const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
  const implementationDigest = createHash('sha256').update(readFileSync(new URL(`app.${extension}`, import.meta.url))).update(readFileSync(new URL(`repository.${extension}`, import.meta.url))).update(String(options.faultDelayMs ?? 6000)).digest('hex');
  if (options.controlToken.length < 24 || options.businessToken.length < 24 || options.controlToken === options.businessToken) throw new Error('Distinct Mock credentials are required');
  const app = Fastify({ bodyLimit: 16384, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.addHook('onRequest', async request => {
    if (request.url === '/health/ready' || request.url === '/health/live') return;
    const token = request.url.startsWith('/control/') ? options.controlToken : options.businessToken;
    const actual = createHash('sha256').update(request.headers.authorization ?? '').digest();
    if (!timingSafeEqual(actual, createHash('sha256').update(`Bearer ${token}`).digest())) throw new MockError('UNAUTHENTICATED', 401);
  });
  app.setErrorHandler((error, request, reply) => {
    const invalid = error instanceof Error && 'validation' in error;
    const code = error instanceof MockError ? error.code : invalid ? 'INVALID_REQUEST' : 'MOCK_INTERNAL_ERROR';
    return reply.code(error instanceof MockError ? error.status : invalid ? 400 : 500).send({ code, message: code, correlationId: request.id });
  });
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/control/manifest', async () => ({ implementationDigest }));
  app.get('/health/ready', async (_r, reply) => { const ready = await options.repository.ready().catch(() => false); return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'unavailable' }); });
  app.put<{ Params: { id: string }; Body: EnvironmentConfig }>('/control/environments/:id', { schema: { params: uuidParamsSchema, body: {
    type: 'object', additionalProperties: false, required: ['seed', 'fault', 'clock'], properties: {
      seed: { enum: ['enterprise-default@1', 'enterprise-low-balance@1'] }, fault: { enum: ['normal', 'read-timeout', 'write-before-failure', 'write-after-timeout', 'missing-field'] }, clock: { type: 'string', format: 'date-time' }
    }
  } } }, async (request, reply) => reply.code(201).send(await options.repository.create(request.params.id, request.body)));
  app.get<{ Params: { id: string } }>('/control/environments/:id', { schema: { params: uuidParamsSchema } }, async request => options.repository.get(request.params.id));
  app.get<{ Params: { id: string }; Querystring: { after?: string; runId?: string } }>('/control/environments/:id/calls', { schema: { params: uuidParamsSchema, querystring: {
    type: 'object', additionalProperties: false, properties: { after: { type: 'string', pattern: '^\\d{1,10}$' }, runId: { type: 'string', format: 'uuid' } }
  } } }, async request => ({ items: await options.repository.calls(request.params.id, Number(request.query.after ?? 0), request.query.runId) }));
  app.post<{ Params: { id: string }; Body: { expectedRevision: number } }>('/control/environments/:id/reset', { schema: { params: uuidParamsSchema, body: {
    type: 'object', additionalProperties: false, required: ['expectedRevision'], properties: { expectedRevision: { type: 'integer', minimum: 1 } }
  } } }, async request => options.repository.reset(request.params.id, request.body.expectedRevision));
  for (const action of ['reserve', 'release'] as const) app.post<{ Params: { id: string }; Body: { runId: string } }>(`/control/environments/:id/${action}`, { schema: { params: uuidParamsSchema, body: {
    type: 'object', additionalProperties: false, required: ['runId'], properties: { runId: { type: 'string', format: 'uuid' } }
  } } }, async request => { await options.repository[action](request.params.id, request.body.runId); return { status: 'ok' }; });
  const context = (headers: Record<string, string | string[] | undefined>): BusinessContext => {
    const env = headers['x-environment-id']; const run = headers['x-run-id']; const actor = headers['x-actor-id']; const key = headers['idempotency-key'];
    if (typeof env !== 'string' || !uuid.test(env) || typeof run !== 'string' || !uuid.test(run) || typeof actor !== 'string' || actor.length > 80 || key !== undefined && (typeof key !== 'string' || key.length > 100)) throw new MockError('INVALID_CONTEXT', 400);
    return { environmentId: env, actorId: actor, runId: run, ...(typeof key === 'string' ? { idempotencyKey: key } : {}) };
  };
  const routes = [
    ['/equipment/:equipmentId', 'equipment-status'], ['/accounts/:accountId/balance', 'getAccountBalance'],
    ['/wealth/products', 'listWealthProducts'], ['/wealth/products/:productId', 'getWealthProduct'], ['/accounts/:accountId/holdings', 'listHoldings'],
    ['/wealth/orders/by-key/:key', 'getOrderByIdempotencyKey'], ['/wealth/orders/:orderId', 'getMockOrder'], ['/work-orders/by-key/:key', 'work-order-by-key']
  ] as const;
  for (const [path, operation] of routes) app.get<{ Params: Record<string, string> }>(`/mock-business/v1${path}`, async (request, reply) => {
    const response = await options.repository.invoke(context(request.headers), operation, request.params);
    if (response.delay) await new Promise(r => setTimeout(r, options.faultDelayMs ?? 6000));
    return reply.code(response.status).send(response.result);
  });
  app.post<{ Body: { accountId: string; productId: string; amountFen: number } }>('/mock-business/v1/wealth/orders', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['accountId', 'productId', 'amountFen'], properties: { accountId: { type: 'string', maxLength: 80 }, productId: { type: 'string', maxLength: 80 }, amountFen: { type: 'integer' } }
  } } }, async (request, reply) => {
    const response = await options.repository.invoke(context(request.headers), 'createMockSubscription', request.body);
    if (response.delay) await new Promise(r => setTimeout(r, options.faultDelayMs ?? 6000));
    return reply.code(response.status).send(response.result);
  });
  app.post<{ Body: { equipmentId: string; description: string; priority: string } }>('/mock-business/v1/work-orders', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['equipmentId','description','priority'], properties: {
      equipmentId: { type: 'string', minLength: 1, maxLength: 80 }, description: { type: 'string', minLength: 1, maxLength: 2000 }, priority: { enum: ['normal','urgent'] }
    }
  } } }, async (request, reply) => {
    const response = await options.repository.invoke(context(request.headers), 'work-order-create', request.body);
    if (response.delay) await new Promise(r => setTimeout(r, options.faultDelayMs ?? 6000));
    return reply.code(response.status).send(response.result);
  });
  return app;
}
