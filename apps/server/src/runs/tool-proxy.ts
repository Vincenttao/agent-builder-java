import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
export interface ToolContext { runId: string; environmentId: string; actorId: string; operations: string[] }
export interface ToolProxyOptions { token: string; context(sessionId: string): Promise<ToolContext>; invoke(context: ToolContext, operation: string, input: Record<string, unknown>): Promise<{ status: number; result: unknown }>;
  mcp?(context: ToolContext | undefined, request: Record<string, unknown>): Promise<{ status: number; result: unknown }>;
  write?(runId: string, actorId: string, toolCallId: string, operation: string, input: unknown): Promise<{ status: number; result: unknown }> }
export function registerToolProxy(app: FastifyInstance, options: ToolProxyOptions) {
  if (options.token.length < 24) throw new Error('TOOL_PROXY_TOKEN is required');
  const expected = createHash('sha256').update(`Bearer ${options.token}`).digest();
  const registerReadOperation = (operation: string, fields: string[]) => app.post<{ Body: Record<string, unknown> }>(`/internal/tool-proxy/operations/${operation}`, { schema: { body: {
    type: 'object', additionalProperties: false, required: fields, properties: Object.fromEntries(fields.map(field => [field, { type: 'string', minLength: 1, maxLength: 200 }]))
  } }, onRequest: async (request, reply) => {
    if (!timingSafeEqual(expected, createHash('sha256').update(request.headers.authorization ?? '').digest())) return reply.code(401).send({ code: 'PROXY_UNAUTHENTICATED' });
    const id = request.headers['x-builder-session-id'];
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return reply.code(400).send({ code: 'RUNTIME_CONTEXT_REQUIRED' });
    request.headers['x-builder-session-id'] = id;
  } }, async (request, reply) => {
    const context = await options.context(request.headers['x-builder-session-id'] as string);
    if (!context.operations.includes(operation)) return reply.code(403).send({ code: 'OPERATION_NOT_BOUND' });
    const response = await options.invoke(context, operation, request.body);
    return reply.code(response.status).send(response.result);
  });
  registerReadOperation('getAccountBalance', ['accountId']);
  registerReadOperation('listWealthProducts', []);
  // Each exposed operation has a fixed schema and backend mapping; no arbitrary forwarding route.
  app.post<{ Body: { equipmentId: string } }>('/internal/tool-proxy/operations/equipment-status', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['equipmentId'], properties: { equipmentId: { type: 'string', minLength: 1, maxLength: 80 } }
  } }, onRequest: async (request, reply) => {
    if (!timingSafeEqual(expected, createHash('sha256').update(request.headers.authorization ?? '').digest())) return reply.code(401).send({ code: 'PROXY_UNAUTHENTICATED' });
    const id = request.headers['x-builder-session-id'];
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return reply.code(400).send({ code: 'RUNTIME_CONTEXT_REQUIRED' });
    // Fastify defaults can otherwise silently discard an attempted identity/URL override.
    request.headers['x-builder-session-id'] = id;
  } }, async (request, reply) => {
    const keys = Object.keys(request.body);
    if (keys.some(key => key !== 'equipmentId')) return reply.code(400).send({ code: 'INVALID_TOOL_ARGUMENTS' });
    const context = await options.context(request.headers['x-builder-session-id'] as string);
    if (!context.operations.includes('equipment-status')) return reply.code(403).send({ code: 'OPERATION_NOT_BOUND' });
    const response = await options.invoke(context, 'equipment-status', request.body);
    return reply.code(response.status).send(response.result);
  });
  app.post<{ Body: { equipmentId: string } }>('/internal/tool-proxy/operations/maintenance-search', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['equipmentId'], properties: { equipmentId: { type: 'string', minLength: 1, maxLength: 80 } }
  } }, onRequest: async (request, reply) => {
    if (!timingSafeEqual(expected, createHash('sha256').update(request.headers.authorization ?? '').digest())) return reply.code(401).send({ code: 'PROXY_UNAUTHENTICATED' });
    const id = request.headers['x-builder-session-id'];
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return reply.code(400).send({ code: 'RUNTIME_CONTEXT_REQUIRED' });
    request.headers['x-builder-session-id'] = id;
  } }, async (request, reply) => {
    const context = await options.context(request.headers['x-builder-session-id'] as string);
    if (!context.operations.includes('maintenance-search')) return reply.code(403).send({ code: 'OPERATION_NOT_BOUND' });
    const response = await options.invoke(context, 'maintenance-search', request.body);
    return reply.code(response.status).send(response.result);
  });
  if (options.write) app.post<{ Body: { equipmentId: string; description: string; priority: string } }>('/internal/tool-proxy/operations/work-order-create', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['equipmentId','description','priority'], properties: {
      equipmentId: { type: 'string', minLength: 1, maxLength: 80 }, description: { type: 'string', minLength: 1, maxLength: 2000 }, priority: { enum: ['normal','urgent'] }
    }
  } }, onRequest: async (request, reply) => {
    if (!timingSafeEqual(expected, createHash('sha256').update(request.headers.authorization ?? '').digest())) return reply.code(401).send({ code: 'PROXY_UNAUTHENTICATED' });
    const id = request.headers['x-builder-session-id']; const call = request.headers['x-builder-tool-call-id'];
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || typeof call !== 'string' || !call || call.length > 200) return reply.code(400).send({ code: 'RUNTIME_CONTEXT_REQUIRED' });
  } }, async (request, reply) => {
    const context = await options.context(request.headers['x-builder-session-id'] as string);
    if (!context.operations.includes('work-order-create')) return reply.code(403).send({ code: 'OPERATION_NOT_BOUND' });
    const response = await options.write!(context.runId, context.actorId, request.headers['x-builder-tool-call-id'] as string, 'work-order-create', request.body);
    return reply.code(response.status).send(response.result);
  });
  if (options.mcp) {
  // This read-only service does not open server-initiated SSE streams. Streamable
  // HTTP clients may probe GET; answer with the protocol's explicit unsupported
  // method response instead of an unrelated application 404.
  app.get('/internal/tool-proxy/mcp', async (_request, reply) => reply.header('allow', 'POST').code(405).send());
  app.post<{ Body: Record<string, unknown> }>('/internal/tool-proxy/mcp', { schema: { body: {
    type: 'object', additionalProperties: true, required: ['jsonrpc', 'method'], properties: { jsonrpc: { const: '2.0' }, id: { anyOf: [{ type: 'string' }, { type: 'number' }] }, method: { type: 'string', maxLength: 100 }, params: { type: 'object' } }
  } }, onRequest: async (request, reply) => {
    if (!timingSafeEqual(expected, createHash('sha256').update(request.headers.authorization ?? '').digest())) return reply.code(401).send({ code: 'PROXY_UNAUTHENTICATED' });
    const id = request.headers['x-builder-session-id'];
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return reply.code(400).send({ code: 'RUNTIME_CONTEXT_REQUIRED' });
    request.headers['x-builder-session-id'] = id;
  } }, async (request, reply) => {
    const method = request.body.method;
    let context: ToolContext | undefined;
    if (method === 'tools/call') {
      const params = request.body.params as Record<string, unknown> | undefined;
      if (params?.name !== 'equipment_status' || !params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments))
        return reply.code(400).send({ code: 'MCP_OPERATION_NOT_ALLOWED' });
      const args = params.arguments as Record<string, unknown>;
      if (Object.keys(args).length !== 1 || typeof args.equipmentId !== 'string' || !args.equipmentId.trim()) return reply.code(400).send({ code: 'INVALID_TOOL_ARGUMENTS' });
      context = await options.context(request.headers['x-builder-session-id'] as string);
      if (!context.operations.includes('equipment-status')) return reply.code(403).send({ code: 'OPERATION_NOT_BOUND' });
    }
    const response = await options.mcp!(context, request.body);
    if (response.status === 202) return reply.code(202).send();
    return reply.code(response.status).send(response.result);
  });
  }
}
