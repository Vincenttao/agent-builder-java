import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MockError, type BusinessContext, type EnvironmentConfig, type MockRepository } from './repository.js';
import { uuidParamsSchema } from '../../../packages/contracts/src/runtime.js';
import {mockBusinessPath,mockBusinessReadRoutes,mockScenePackage} from './scene.js';
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
  app.get('/control/project-scene',async()=>mockScenePackage);
  // Stateless Streamable HTTP MCP endpoint for the registered read-only equipment capability.
  // Each tools/call is routed through the same repository as the HTTP contract so call evidence,
  // environment state, identity, and fault behavior remain identical across both transports.
  app.post<{ Body: { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown> } }>('/mcp', async (request, reply) => {
    const body = request.body;
    const respond = (result: unknown) => ({ jsonrpc: '2.0', id: body.id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: body.id, error: { code, message } });
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string')
      return reply.code(400).send(fail(-32600, 'Invalid Request'));
    if (body.method.startsWith('notifications/')) return reply.code(202).send();
    if (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)) return reply.code(400).send(fail(-32600, 'Invalid Request'));
    if (body.method === 'initialize') {
      const requested = body.params.protocolVersion;
      const supported = ['2025-03-26', '2025-06-18'];
      if (typeof requested !== 'string') return reply.code(400).send(fail(-32602, 'Invalid protocol version'));
      if (!supported.includes(requested)) return reply.code(400).send(fail(-32602, 'Unsupported protocol version'));
      return respond({ protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'agent-builder-mock', version: '1.0.0' } });
    }
    if (body.method === 'ping') return respond({});
    if (body.method === 'tools/list') return respond({ tools: [{ name: 'equipment_status', description: 'Query mock equipment status.', _meta: { version: 'equipment-status-mcp@1' }, inputSchema: {
      type: 'object', properties: { equipmentId: { type: 'string' } }, required: ['equipmentId'], additionalProperties: false
    }, outputSchema: { type: 'object', properties: { equipmentId: { type: 'string' }, status: { type: 'string' }, temperatureCelsius: { type: 'integer' }, source: { type: 'string' } }, required: ['equipmentId', 'status', 'temperatureCelsius', 'source'], additionalProperties: false } }] });
    if (body.method === 'tools/call') {
      if (body.params.name !== 'equipment_status') return respond({ isError: true, content: [{ type: 'text', text: 'MCP_TOOL_NOT_FOUND' }] });
      const args = body.params.arguments;
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || typeof (args as Record<string, unknown>).equipmentId !== 'string')
        return respond({ isError: true, content: [{ type: 'text', text: 'INVALID_TOOL_ARGUMENTS' }] });
      try {
        const callContext = context(request.headers);
        const outcome = await options.repository.invoke(callContext, 'equipment-status', args as Record<string, unknown>);
        if (outcome.delay) await new Promise(resolve => setTimeout(resolve, options.faultDelayMs ?? 6000));
        const isError = outcome.status < 200 || outcome.status >= 300;
        return respond({ isError, structuredContent: outcome.result, content: [{ type: 'text', text: JSON.stringify(outcome.result) }] });
      } catch (error) {
        const code = error instanceof MockError ? error.code : 'MOCK_INTERNAL_ERROR';
        return respond({ isError: true, content: [{ type: 'text', text: code }] });
      }
    }
    return reply.code(400).send(fail(-32601, 'Method not found'));
  });
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
  for (const route of mockBusinessReadRoutes) app.get<{ Params: Record<string, string> }>(route.path, async (request, reply) => {
    const response = await options.repository.invoke(context(request.headers), route.operationId, request.params);
    if (response.delay) await new Promise(r => setTimeout(r, options.faultDelayMs ?? 6000));
    return reply.code(response.status).send(response.result);
  });
  app.post<{ Body: { accountId: string; productId: string; amountFen: number } }>(mockBusinessPath('createMockSubscription'), { schema: { body: {
    type: 'object', additionalProperties: false, required: ['accountId', 'productId', 'amountFen'], properties: { accountId: { type: 'string', maxLength: 80 }, productId: { type: 'string', maxLength: 80 }, amountFen: { type: 'integer' } }
  } } }, async (request, reply) => {
    const response = await options.repository.invoke(context(request.headers), 'createMockSubscription', request.body);
    if (response.delay) await new Promise(r => setTimeout(r, options.faultDelayMs ?? 6000));
    return reply.code(response.status).send(response.result);
  });
  app.post<{ Body: { equipmentId: string; description: string; priority: string } }>(mockBusinessPath('work-order-create'), { schema: { body: {
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
