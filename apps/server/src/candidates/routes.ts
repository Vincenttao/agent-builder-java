import {createHash,randomBytes} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {CandidateService} from './candidate-service.js';
import type {TestDeploymentService} from './test-deployment-service.js';
import type {InvocationService} from '../invocations/invocation-service.js';
import {candidateInputSchema,testDeploymentInputSchema,type TestDeploymentInput} from '../../../../packages/contracts/src/candidates.js';
import {messageInputSchema,type InvocationIdentity,type MessageInput} from '../../../../packages/contracts/src/invocations.js';
import {actionDecisionSchema,type ActionDecision} from '../../../../packages/contracts/src/actions.js';
import {AppError} from '../shared/errors.js';
import type {ValidationLeaseTokens} from '../shared/validation-lease-tokens.js';
import type {ValidationTestAuthority} from '../shared/validation-claim.js';
const uuid={type:'string',format:'uuid'} as const;
const params=(names:string[])=>({type:'object',additionalProperties:false,required:names,properties:Object.fromEntries(names.map(name=>[name,uuid]))});
const empty={type:'object',additionalProperties:false} as const;
export function registerCandidateRoutes(app:FastifyInstance,candidates:CandidateService,tests:TestDeploymentService,invocations:InvocationService,options:{origin:string;now:()=>string;validationLeaseTokens?:ValidationLeaseTokens}){
  function authority(request:FastifyRequest){
    const value=request.headers['x-builder-validation-grant'];
    if(value!==undefined&&!options.validationLeaseTokens)throw new AppError('VALIDATION_AUTHORITY_INVALID','自动验收执行授权不可用',403);
    return options.validationLeaseTokens?.read(value);
  }
  app.post<{Body:{snapshotId:string;developmentJobId?:string}}>('/api/candidates',{schema:{body:candidateInputSchema}},async(request,reply)=>reply.code(201).send(await candidates.create(request.body.snapshotId,request.body.developmentJobId)));
  app.get<{Params:{id:string}}>('/api/candidates/:id',{schema:{params:params(['id'])}},async request=>candidates.get(request.params.id));
  app.get<{Params:{id:string}}>('/api/drafts/:id/candidates',{schema:{params:params(['id'])}},async request=>({items:await candidates.list(request.params.id)}));
  app.post<{Body:TestDeploymentInput}>('/api/test-deployments',{schema:{body:testDeploymentInputSchema}},async(request,reply)=>reply.code(202).send(await tests.create(request.body,authority(request))));
  app.get<{Params:{runId:string}}>('/api/test-deployments/by-validation-run/:runId',{schema:{params:params(['runId'])}},async request=>({target:await tests.findValidation(request.params.runId)}));
  app.get<{Params:{id:string}}>('/api/test-deployments/:id',{schema:{params:params(['id'])}},async request=>tests.get(request.params.id));
  app.get<{Params:{id:string}}>('/api/candidates/:id/test-deployments',{schema:{params:params(['id'])}},async request=>({items:await tests.list(request.params.id)}));
  app.post<{Params:{id:string}}>('/api/test-deployments/:id/stop',{schema:{params:params(['id']),body:empty}},async(request,reply)=>reply.code(202).send(await tests.stop(request.params.id,authority(request))));
  app.get<{Params:{id:string;requestId:string}}>('/api/test-deployments/:id/requests/:requestId',{schema:{params:params(['id','requestId'])}},async request=>
    invocations.get(await tests.requestIdentity(request.params.id,request.params.requestId),request.params.requestId));

  const grants=new Map<string,{identity:InvocationIdentity;expiresAt:number;authority?:ValidationTestAuthority}>();
  const requestAuthorities=new WeakMap<FastifyRequest,ValidationTestAuthority>();
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  async function identity(request:FastifyRequest):Promise<InvocationIdentity>{
    const header=request.headers.authorization;
    const token=typeof header==='string'&&/^Bearer [a-f0-9]{64}$/.test(header)?header.slice(7):'';
    const grant=grants.get(hash(token));
    if(!grant||grant.expiresAt<=Date.parse(options.now())){if(grant)grants.delete(hash(token));throw new AppError('TEST_UNAUTHENTICATED','测试授权无效或已过期',401);}
    const id=(request.params as {deploymentId?:string}).deploymentId;
    if(!id||grant.identity.testDeploymentId!==id)throw new AppError('TEST_DEPLOYMENT_FORBIDDEN','授权不属于此测试部署',403);
    const current=await tests.identity(id,grant.identity.actorId,grant.authority);
    if(current.agentId!==grant.identity.agentId||current.environmentId!==grant.identity.environmentId)throw new AppError('TEST_IDENTITY_MISMATCH','测试授权目标已变化',403);
    if(grant.authority)requestAuthorities.set(request,grant.authority);
    return grant.identity;
  }
  app.addHook('onRequest',async(request,reply)=>{
    if(!request.url.startsWith('/test-api/'))return;
    reply.header('Cache-Control','no-store');
    if(request.headers.origin&&request.headers.origin!==options.origin)throw new AppError('ORIGIN_REJECTED','请求来源不受信任',403);
    await identity(request);
  });
  app.post<{Params:{id:string};Body:{actorId:'U1001'|'U1002'}}>('/api/test-deployments/:id/sessions',{schema:{params:params(['id']),body:{type:'object',additionalProperties:false,required:['actorId'],properties:{actorId:{enum:['U1001','U1002']}}}}},async(request,reply)=>{
    const now=Date.parse(options.now());for(const [key,grant]of grants)if(grant.expiresAt<=now)grants.delete(key);
    const claim=authority(request);const bound=await tests.identity(request.params.id,request.body.actorId,claim);const target=await tests.get(request.params.id);
    if(claim)for(const [key,grant]of grants)if(grant.identity.testDeploymentId===target.id&&grant.identity.actorId===bound.actorId)grants.delete(key);
    if(grants.size>=64)throw new AppError('SESSION_LIMIT','测试授权数量已达上限',429);
    const expiresAt=Math.min(now+15*60*1000,Date.parse(target.expiresAt));const token=randomBytes(32).toString('hex');
    grants.set(hash(token),{identity:bound,expiresAt,...(claim?{authority:claim}:{})});return reply.code(201).send({...bound,token,expiresAt:new Date(expiresAt).toISOString()});
  });
  const root='/test-api/deployments/:deploymentId';
  app.post<{Params:{deploymentId:string};Body:MessageInput}>(`${root}/messages`,{schema:{params:params(['deploymentId']),body:messageInputSchema}},async(request,reply)=>reply.code(202).send(await invocations.send(await identity(request),request.body,requestAuthorities.get(request))));
  app.get<{Params:{deploymentId:string;requestId:string}}>(`${root}/requests/:requestId`,{schema:{params:params(['deploymentId','requestId'])}},async request=>invocations.get(await identity(request),request.params.requestId));
  app.post<{Params:{deploymentId:string;requestId:string}}>(`${root}/requests/:requestId/cancel`,{schema:{params:params(['deploymentId','requestId']),body:empty}},async(request,reply)=>reply.code(202).send(await invocations.cancel(await identity(request),request.params.requestId,requestAuthorities.get(request))));
  app.post<{Params:{deploymentId:string;requestId:string;actionId:string};Body:ActionDecision}>(`${root}/requests/:requestId/actions/:actionId/decision`,{schema:{params:params(['deploymentId','requestId','actionId']),body:actionDecisionSchema}},async request=>invocations.decide(await identity(request),request.params.requestId,request.params.actionId,request.body,requestAuthorities.get(request)));
  app.get<{Params:{deploymentId:string;requestId:string};Querystring:{after?:string}}>(`${root}/requests/:requestId/events`,{schema:{params:params(['deploymentId','requestId']),querystring:{type:'object',additionalProperties:false,properties:{after:{type:'string',pattern:'^\\d{1,10}$'}}}}},async request=>({items:await invocations.events(await identity(request),request.params.requestId,Number(request.query.after??0))}));
  app.addHook('onClose',async()=>{grants.clear();});
}
