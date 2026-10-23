import Fastify, { type FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import type { DraftService } from './drafts/application/draft-service.js';
import type { SnapshotService } from './snapshots/application/snapshot-service.js';
import { AppError } from './shared/errors.js';
import type { RunService } from './runs/run-service.js';
import type { PostgresActions } from './actions/postgres-actions.js';
import { actionDecisionSchema, type ActionDecision } from '../../../packages/contracts/src/actions.js';
import type { BaselineService } from './acceptance/application/baseline-service.js';
import { baselineInputSchema, type BaselineInput } from '../../../packages/contracts/src/baselines.js';
import type { ValidationService } from './acceptance/application/validation-service.js';
import type { ReleaseService } from './releases/release-service.js';
import type { InvocationService } from './invocations/invocation-service.js';
import { registerInvocationRoutes } from './invocations/routes.js';
import type {CandidateService} from './candidates/candidate-service.js';
import type {TestDeploymentService} from './candidates/test-deployment-service.js';
import {registerCandidateRoutes} from './candidates/routes.js';
import type {DevelopmentService} from './development/development-service.js';
import {registerDevelopmentRoutes} from './development/routes.js';
import type {ValidationLeaseTokens} from './shared/validation-lease-tokens.js';
import {releaseInputSchema,type ReleaseInput} from '../../../packages/contracts/src/releases.js';
import { validationInputSchema, type ValidationInput } from '../../../packages/contracts/src/validations.js';
import { registerToolProxy, type ToolProxyOptions } from './runs/tool-proxy.js';
import { runInputSchema, type RunInput } from '../../../packages/contracts/src/runs.js';
import { bindingInputSchema, draftInputSchema, draftParamsSchema, draftUpdateSchema, snapshotInputSchema, type SnapshotInput, type BindingInput, type DraftInput, type DraftUpdate, type EnvironmentStatus } from '../../../packages/contracts/src/index.js';
import {registerProjectRoutes} from './projects/routes.js';
import type {ProjectPackageStore} from './projects/project-package-store.js';
import type {MockScenePackage} from '../../../packages/contracts/src/mock-scene.js';
export interface AppOptions {
  drafts: DraftService; databaseReady: () => Promise<boolean>; now: () => string;
  bootstrapToken: string; origin: string; modelConfigured: boolean;
  snapshots?: SnapshotService;
  runs?: RunService;
  actions?: PostgresActions;
  baselines?: BaselineService;
  validations?: ValidationService;
  releases?: ReleaseService;
  invocations?: InvocationService;
  candidates?: CandidateService;
  testDeployments?: TestDeploymentService;
  validationLeaseTokens?:ValidationLeaseTokens;
  development?:DevelopmentService;
  projectPackages?:ProjectPackageStore;
  projectScene?:()=>Promise<MockScenePackage>;
  toolProxy?: ToolProxyOptions;
}
export function createApp(options: AppOptions) {
  if (options.bootstrapToken.length < 24) throw new Error('LOCAL_BOOTSTRAP_TOKEN must contain at least 24 characters');
  const app = Fastify({ bodyLimit: 2 * 1024 * 1024,
    logger: { level: 'info', redact: { paths: ['req.url', 'req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]'], censor: '[REDACTED]' } },
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const sessions = new Map<string, { csrfToken: string; expiresAt: number }>();
  const cookieId = (request: FastifyRequest) => request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('builder_session='))?.slice('builder_session='.length);
  const equal = (left: string, right: string) => timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
  const requireSession = (request: FastifyRequest) => {
    const id = cookieId(request);
    const session = id ? sessions.get(id) : undefined;
    if (!session || session.expiresAt <= Date.parse(options.now())) {
      if (id) sessions.delete(id);
      throw new AppError('UNAUTHENTICATED', '请先使用本地访问令牌登录', 401);
    }
    return session;
  };
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ code: error.code, message: error.message, details: error.details, correlationId: request.id });
    const httpError: { validation?: unknown; statusCode?: number } = error instanceof Error ? error as Error & { validation?: unknown; statusCode?: number } : {};
    if (httpError.validation || (httpError.statusCode && httpError.statusCode >= 400 && httpError.statusCode < 500)) {
      return reply.code(httpError.statusCode ?? 400).send({ code: 'INVALID_REQUEST', message: '请求格式不符合接口契约', details: null, correlationId: request.id });
    }
    // Do not forward driver errors, request bodies, credentials or stack traces.
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: '服务内部错误，请使用关联编号定位', details: null, correlationId: request.id });
  });
  app.setNotFoundHandler((request, reply) => {
    request.log.warn({ method: request.method, path: request.url.split('?')[0] }, 'route.not_found');
    return reply.code(404).send({ code: 'NOT_FOUND', message: '接口不存在', details: null, correlationId: request.id });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (writing && request.headers.origin !== options.origin) throw new AppError('ORIGIN_REJECTED', '请求来源不受信任', 403);
    if (request.method === 'POST' && request.url === '/api/auth/session') return;
    const session = requireSession(request);
    if (writing && (typeof request.headers['x-csrf-token'] !== 'string' || !equal(session.csrfToken, request.headers['x-csrf-token']))) {
      throw new AppError('CSRF_REJECTED', '请求校验失败，请刷新工作台', 403);
    }
  });
  app.post<{ Body: { token: string } }>('/api/auth/session', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', maxLength: 256 } }
  } } }, async (request, reply) => {
    if (!equal(request.body.token, options.bootstrapToken)) throw new AppError('UNAUTHENTICATED', '本地访问令牌无效', 401);
    for (const [id, session] of sessions) if (session.expiresAt <= Date.parse(options.now())) sessions.delete(id);
    if (sessions.size >= 64) throw new AppError('SESSION_LIMIT', '本地会话数量已达上限', 429);
    const oldId = cookieId(request); if (oldId) sessions.delete(oldId);
    const id = randomBytes(32).toString('hex');
    const session = { csrfToken: randomBytes(32).toString('hex'), expiresAt: Date.parse(options.now()) + 8 * 60 * 60 * 1000 };
    sessions.set(id, session);
    const secure = options.origin.startsWith('https:') ? '; Secure' : '';
    reply.header('Set-Cookie', `builder_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
    return { csrfToken: session.csrfToken };
  });
  app.get('/api/auth/session', async request => ({ csrfToken: requireSession(request).csrfToken }));
  app.delete('/api/auth/session', async (request, reply) => {
    const id = cookieId(request); if (id) sessions.delete(id);
    reply.header('Set-Cookie', 'builder_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0').code(204).send();
  });
  const environment = async (): Promise<EnvironmentStatus> => {
    const ready = await options.databaseReady().catch(() => false);
    const execution = options.runs ? await options.runs.readiness() : null;
    return {
      checkedAt: options.now(), executionMode: 'trusted-local', sandboxEnabled: false,
      database: ready ? 'ready' : 'unavailable', model: (execution?.runtime?.modelConfigured ?? options.modelConfigured) ? 'configured_unverified' : 'not_configured', runtime: execution ? execution.runtime ? 'ready' : 'unavailable' : 'not_implemented',
      canSaveDraft: ready, canRun: ready && Boolean(execution?.canRun),
      blockers: [
        ...(!ready ? [{ code: 'DATABASE_UNAVAILABLE', message: '数据库不可用', path: '/environment' }] : []),
        ...(!(execution?.runtime?.modelConfigured ?? options.modelConfigured) ? [{ code: 'MODEL_NOT_CONFIGURED', message: '模型凭据未配置', path: '/environment' }] : []),
        ...(!options.runs ? [{ code: 'RUNTIME_NOT_IMPLEMENTED', message: 'Java Runtime 尚未接入，不能启动业务 Agent', path: '/environment' }] : []),
        ...(execution && !execution.runtime ? [{ code: 'RUNNER_UNAVAILABLE', message: 'Runner 不可用', path: '/environment' }] : []),
        ...(execution && !execution.mock ? [{ code: 'MOCK_UNAVAILABLE', message: 'Mock 服务不可用', path: '/environment' }] : [])
      ]
    };
  };
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const ready = await options.databaseReady().catch(() => false);
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'unavailable' });
  });
  app.get('/api/environment', environment);
  app.get('/api/drafts', async () => ({ items: await options.drafts.list() }));
  if(options.releases){
    const releases=options.releases;
    app.post<{Params:{id:string};Body:ReleaseInput}>('/api/drafts/:id/releases',{schema:{params:draftParamsSchema,body:releaseInputSchema}},async(request,reply)=>reply.code(202).send(await releases.start(request.params.id,request.body)));
    app.get<{Params:{id:string}}>('/api/drafts/:id/releases',{schema:{params:draftParamsSchema}},async request=>{await options.drafts.get(request.params.id);return releases.overview(request.params.id);});
    app.get<{Params:{id:string}}>('/api/releases/:id',{schema:{params:draftParamsSchema}},async request=>releases.get(request.params.id));
  }
  app.post<{ Body: DraftInput }>('/api/drafts', { schema: { body: draftInputSchema } }, async (request, reply) => reply.code(201).send(await options.drafts.create(request.body)));
  app.get<{ Params: { id: string } }>('/api/drafts/:id', { schema: { params: draftParamsSchema } }, async request => options.drafts.get(request.params.id));
  app.put<{ Params: { id: string }; Body: DraftUpdate }>('/api/drafts/:id', { schema: { params: draftParamsSchema, body: draftUpdateSchema } }, async request => options.drafts.update(request.params.id, request.body));
  if (options.snapshots) {
    const snapshots = options.snapshots;
    app.post<{ Params: { id: string }; Body: SnapshotInput }>('/api/drafts/:id/snapshots', { schema: { params: draftParamsSchema, body: snapshotInputSchema } }, async (request, reply) => reply.code(201).send(await snapshots.create(request.params.id, request.body)));
    app.get<{ Params: { id: string } }>('/api/drafts/:id/snapshots', { schema: { params: draftParamsSchema } }, async request => ({ items: await snapshots.list(request.params.id) }));
    app.get<{ Params: { id: string } }>('/api/snapshots/:id', { schema: { params: draftParamsSchema } }, async request => snapshots.get(request.params.id));
  }
  registerProjectRoutes(app,options.drafts,options.snapshots,options.baselines,options.now,options.development,options.candidates,options.projectPackages,options.projectScene);
  if (options.validations) {
    const validations = options.validations;
    app.post<{ Params: { id: string }; Body: ValidationInput }>('/api/snapshots/:id/validations', { schema: { params: draftParamsSchema, body: validationInputSchema } }, async (request, reply) => reply.code(202).send(await validations.start(request.params.id, request.body)));
    app.get<{ Params: { id: string } }>('/api/snapshots/:id/validations', { schema: { params: draftParamsSchema } }, async request => ({ items: await validations.list(request.params.id) }));
    app.get<{ Params: { id: string } }>('/api/validations/:id', { schema: { params: draftParamsSchema } }, async request => validations.get(request.params.id));
    app.get<{ Params: { id: string } }>('/api/validations/:id/report', { schema: { params: draftParamsSchema } }, async request => validations.report(request.params.id));
    app.get<{ Params: { id: string; evidenceId: string } }>('/api/validations/:id/evidence/:evidenceId', { schema: { params: { type: 'object', additionalProperties: false, required: ['id','evidenceId'], properties: { id: { type: 'string', format: 'uuid' }, evidenceId: { type: 'string', format: 'uuid' } } } } }, async request => validations.evidence(request.params.id, request.params.evidenceId));
    app.post<{ Params: { id: string } }>('/api/validations/:id/cancel', { schema: { params: draftParamsSchema, body: { type: 'object', additionalProperties: false } } }, async (request, reply) => reply.code(202).send(await validations.cancel(request.params.id)));
  }
  if (options.baselines) {
    const baselines = options.baselines;
    app.get<{ Params: { id: string }; Querystring: { templateId: string } }>('/api/drafts/:id/baseline-preview', { schema: { params: draftParamsSchema, querystring: {
      type: 'object', additionalProperties: false, required: ['templateId'], properties: { templateId: { enum: ['equipment-read@1','equipment-workorder@1','wealth-balance-read@1'] } }
    } } }, async request => baselines.preview(request.params.id, request.query.templateId));
    app.post<{ Params: { id: string }; Body: BaselineInput }>('/api/drafts/:id/baselines', { schema: { params: draftParamsSchema, body: baselineInputSchema } }, async (request, reply) => reply.code(201).send(await baselines.confirm(request.params.id, request.body)));
    app.get<{ Params: { id: string } }>('/api/drafts/:id/baselines', { schema: { params: draftParamsSchema } }, async request => { await options.drafts.get(request.params.id); return { items: await baselines.list(request.params.id) }; });
    app.get<{ Params: { id: string } }>('/api/baselines/:id', { schema: { params: draftParamsSchema } }, async request => baselines.get(request.params.id));
  }
  if (options.runs) {
    const runs = options.runs;
    const streams = new Set<ServerResponse>();
    app.addHook('preClose', async () => { for (const stream of streams) stream.end(); });
    app.post<{ Params: { id: string }; Body: RunInput }>('/api/snapshots/:id/runs', { schema: { params: draftParamsSchema, body: runInputSchema } }, async (request, reply) => reply.code(202).send(await runs.create(request.params.id, request.body)));
    app.get<{ Params: { id: string } }>('/api/snapshots/:id/runs', { schema: { params: draftParamsSchema } }, async request => ({ items: await runs.list(request.params.id) }));
    app.get<{ Params: { id: string } }>('/api/runs/:id', { schema: { params: draftParamsSchema } }, async request => runs.get(request.params.id));
    app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/api/runs/:id/events', { schema: { params: draftParamsSchema, querystring: { type: 'object', additionalProperties: false, properties: { after: { type: 'string', pattern: '^\\d{1,10}$' } } } } }, async request => ({ items: await runs.events(request.params.id, Number(request.query.after ?? 0)) }));
    app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/api/runs/:id/events/stream', { schema: { params: draftParamsSchema, querystring: { type: 'object', additionalProperties: false, properties: { after: { type: 'string', pattern: '^\\d{1,10}$' } } } } }, async (request, reply) => {
      const cursor = request.headers['last-event-id'] ?? request.query.after ?? '0';
      if (typeof cursor !== 'string' || !/^\d{1,10}$/.test(cursor)) throw new AppError('INVALID_EVENT_CURSOR', '事件游标无效', 400);
      await runs.get(request.params.id);
      reply.hijack(); const stream = reply.raw; streams.add(stream);
      stream.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Content-Type-Options': 'nosniff' });
      const controller = new AbortController(); stream.once('close', () => controller.abort());
      const lifetime = setTimeout(() => controller.abort(), 20000);
      let after = Number(cursor);
      const pump = async () => {
        stream.write('retry: 1500\n\n');
        while (!controller.signal.aborted) {
          requireSession(request);
          const events = await runs.events(request.params.id, after);
          for (const event of events) {
            if (controller.signal.aborted) return;
            if (!stream.write(`id: ${event.seq}\nevent: trace\ndata: ${JSON.stringify(event)}\n\n`)) await once(stream, 'drain', { signal: controller.signal });
            after = event.seq;
          }
          if (events.length === 500) continue;
          const state = await runs.get(request.params.id);
          if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state.status)) return;
          stream.write(': keepalive\n\n'); await delay(750, undefined, { signal: controller.signal });
        }
      };
      void pump().catch(() => { if (!controller.signal.aborted) stream.write('event: stream_error\ndata: {"code":"EVENT_STREAM_UNAVAILABLE"}\n\n'); })
        .finally(() => { clearTimeout(lifetime); streams.delete(stream); stream.end(); });
      return reply;
    });
    app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', { schema: { params: draftParamsSchema, body: { type: 'object', additionalProperties: false } } }, async (request, reply) => reply.code(202).send(await runs.cancel(request.params.id)));
  }
  if (options.actions && options.runs) {
    const actions = options.actions; const runs = options.runs;
    app.get<{ Params: { id: string } }>('/api/runs/:id/actions', { schema: { params: draftParamsSchema } }, async request => { await runs.get(request.params.id); return { items: await actions.list(request.params.id) }; });
    app.post<{ Params: { id: string; actionId: string }; Body: ActionDecision }>('/api/runs/:id/actions/:actionId/decision', { schema: { body: actionDecisionSchema, params: {
      type: 'object', additionalProperties: false, required: ['id','actionId'], properties: { id: { type: 'string', format: 'uuid' }, actionId: { type: 'string', format: 'uuid' } }
    } } }, async request => actions.decide(request.params.actionId, request.params.id, 'U1001', request.body));
  }
  if(options.invocations)registerInvocationRoutes(app,options.invocations,{origin:options.origin,now:options.now});
  if(options.candidates&&options.testDeployments&&options.invocations)registerCandidateRoutes(app,options.candidates,options.testDeployments,options.invocations,{origin:options.origin,now:options.now,...(options.validationLeaseTokens?{validationLeaseTokens:options.validationLeaseTokens}:{})});
  if (options.toolProxy) registerToolProxy(app, options.toolProxy);
  app.post<{ Params: { id: string } }>('/api/drafts/:id/runs', { schema: { params: draftParamsSchema, body: { type: 'object', additionalProperties: false } } }, async request => {
    await options.drafts.get(request.params.id);
    if (options.runs) throw new AppError('SNAPSHOT_REQUIRED', '请先确认需求、固定测试版本，再从该版本启动调试', 409);
    throw new AppError('ENVIRONMENT_BLOCKED', '当前环境不能执行真实业务 Agent', 409, { blockers: (await environment()).blockers });
  });
  app.post<{ Body: BindingInput }>('/api/connection-bindings', { schema: { body: bindingInputSchema } }, async request => {
    if (request.body.kind !== 'mock') throw new AppError('CONNECTION_TYPE_NOT_ALLOWED', '首期仅允许登记的 Mock 业务连接', 422);
    throw new AppError('MOCK_NOT_IMPLEMENTED', 'Mock 服务尚未接入，无法创建有效连接', 409);
  });
  app.addHook('onClose', async () => { sessions.clear(); });
  if(options.development)registerDevelopmentRoutes(app,options.development);
  return app;
}
