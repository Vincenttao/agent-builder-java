import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RuntimeSpec } from '../../../packages/contracts/src/index.js';
import { deploymentRequestSchema, executionRequestSchema, resumeRequestSchema, uuidParamsSchema,executionClaimSchema } from '../../../packages/contracts/src/runtime.js';
import { RunnerError, type JavaDeploymentManager } from './runtime/deployment-manager.js';
import type { ExecutionJournal, ExecutionRequest, ResumeRequest } from './executions/journal.js';
import type {EngineeringTaskManager} from './engineering/task-manager.js';
import {registerEngineeringRoutes} from './engineering/routes.js';
import {PolicyError} from './engineering/profile.js';

export interface RunnerAppOptions {
  token: string; runtime: Pick<JavaDeploymentManager, 'start' | 'get' | 'stop' | 'retire' | 'events' | 'artifactDigest' | 'bootId'> & Partial<Pick<JavaDeploymentManager, 'modelProfile'|'artifact'|'artifacts'>>;
  journal: ExecutionJournal; modelConfigured: boolean;
  engineering?:EngineeringTaskManager;
}
export function createRunnerApp(options: RunnerAppOptions) {
  if (options.token.length < 24) throw new Error('RUNNER_CONTROL_TOKEN is required');
  const app = Fastify({ bodyLimit: 65536, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const expected = createHash('sha256').update(`Bearer ${options.token}`).digest();
  app.addHook('onRequest', async request => {
    if (request.url === '/health/live' || request.url === '/health/ready') return;
    const actual = createHash('sha256').update(request.headers.authorization ?? '').digest();
    if (!timingSafeEqual(expected, actual)) throw new RunnerError('RUNNER_UNAUTHENTICATED', 401);
  });
  app.setErrorHandler((error, request, reply) => {
    if(error instanceof PolicyError)return reply.code(error.code.endsWith('_NOT_FOUND')?404:409).send({code:error.code,correlationId:request.id});
    if (error instanceof RunnerError) return reply.code(error.status).send({ code: error.code, correlationId: request.id });
    const invalid = error instanceof Error && 'validation' in error;
    return reply.code(invalid ? 400 : 500).send({ code: invalid ? 'INVALID_REQUEST' : 'RUNNER_INTERNAL_ERROR', correlationId: request.id });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND' }));
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => reply.code(options.runtime.artifactDigest ? 200 : 503).send({ status: options.runtime.artifactDigest ? 'ready' : 'unavailable' }));
  app.get('/capabilities', async () => ({ bootId: options.runtime.bootId, artifactDigest: options.runtime.artifactDigest, executionMode: 'trusted-local', modelConfigured: options.modelConfigured, modelProfile: options.runtime.modelProfile ?? null, invocationConcurrencyPerDeployment: 1 }));
  app.get<{Params:{digest:string}}>('/artifacts/:digest',{schema:{params:{type:'object',required:['digest'],properties:{digest:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}},async request=>{
    if(!options.runtime.artifact)throw new RunnerError('ARTIFACT_NOT_FOUND',404);return options.runtime.artifact(request.params.digest);
  });
  app.post<{Params:{id:string};Body:{bundleDigest:string;specDigest:string}}>('/engineering/tasks/:id/artifact',{schema:{params:uuidParamsSchema,body:{type:'object',additionalProperties:false,required:['bundleDigest','specDigest'],properties:{bundleDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},specDigest:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}},async request=>{
    if(!options.engineering||!options.runtime.artifacts)throw new RunnerError('GENERATED_BUNDLE_MISSING');
    const{bundle,directory}=await options.engineering.builtBundle(request.params.id,request.body.bundleDigest);return options.runtime.artifacts.compose(bundle,directory,request.body.specDigest);
  });
  app.put<{ Params: { id: string }; Body: { artifactDigest: string; spec: RuntimeSpec } }>('/deployments/:id',
    { schema: { params: uuidParamsSchema, body: deploymentRequestSchema } }, async (request, reply) => {
      if (!options.modelConfigured) throw new RunnerError('MODEL_NOT_CONFIGURED', 409);
      return reply.code(201).send(await options.runtime.start(request.params.id, request.body.spec, request.body.artifactDigest));
    });
  app.get<{ Params: { id: string } }>('/deployments/:id', { schema: { params: uuidParamsSchema } }, async request => options.runtime.get(request.params.id));
  app.get<{ Params: { id: string } }>('/deployments/:id/events', { schema: { params: uuidParamsSchema } }, async request => ({ items: await options.runtime.events(request.params.id) }));
  app.post<{ Params: { id: string } }>('/deployments/:id/retire', { schema: { params: uuidParamsSchema, body: { type:'object', additionalProperties:false } } }, async request => {
    if (options.journal.hasActiveDeployment(request.params.id)) throw new RunnerError('DEPLOYMENT_HAS_ACTIVE_EXECUTIONS');
    return options.runtime.retire(request.params.id);
  });
  app.post<{ Params: { id: string } }>('/deployments/:id/stop', { schema: { params: uuidParamsSchema, body: { type: 'object', additionalProperties: false } } }, async request => {
    if (options.journal.hasActiveDeployment(request.params.id)) throw new RunnerError('DEPLOYMENT_HAS_ACTIVE_EXECUTIONS');
    return options.runtime.stop(request.params.id);
  });
  app.post<{Params:{id:string};Body:{fencingToken:string}}>('/executions/:id/claim',{schema:{params:uuidParamsSchema,body:executionClaimSchema}},async request=>options.journal.claim(request.params.id,request.body.fencingToken));
  app.put<{ Params: { id: string }; Body: ExecutionRequest&{fencingToken:string} }>('/executions/:id', { schema: { params: uuidParamsSchema, body: executionRequestSchema } }, async (request, reply) => {
    const {fencingToken,...input}=request.body;const record = await options.journal.begin(request.params.id, input,fencingToken);
    return reply.code(record.status === 'running' ? 202 : 200).send(record);
  });
  app.get<{ Params: { id: string } }>('/executions/:id', { schema: { params: uuidParamsSchema } }, async request => options.journal.get(request.params.id));
  app.post<{ Params: { id: string }; Body: ResumeRequest&{fencingToken:string} }>('/executions/:id/resume', { schema: { params: uuidParamsSchema, body: resumeRequestSchema } }, async (request, reply) => {const{fencingToken,...input}=request.body;return reply.code(202).send(await options.journal.resume(request.params.id,input,fencingToken));});
  app.post<{ Params: { id: string };Body:{fencingToken:string} }>('/executions/:id/cancel', { schema: { params: uuidParamsSchema, body:executionClaimSchema } }, async request => options.journal.cancel(request.params.id,request.body.fencingToken));
  if(options.engineering)registerEngineeringRoutes(app,options.engineering,options.modelConfigured);
  return app;
}
