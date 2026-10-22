import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { InvocationService } from './invocation-service.js';
import { messageInputSchema, type DemoGrant, type DemoIdentity, type MessageInput } from '../../../../packages/contracts/src/invocations.js';
import { actionDecisionSchema, type ActionDecision } from '../../../../packages/contracts/src/actions.js';
import { AppError } from '../shared/errors.js';
const uuid={type:'string',format:'uuid'} as const;
const params=(names:string[])=>({type:'object',additionalProperties:false,required:names,properties:Object.fromEntries(names.map(name=>[name,uuid]))});
export function registerInvocationRoutes(app:FastifyInstance,service:InvocationService,options:{origin:string;now:()=>string}){
  // Local demo credentials are separate from management sessions, never persisted in logs or URLs.
  const grants=new Map<string,{identity:DemoIdentity;expiresAt:number}>();
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  const identity=(request:FastifyRequest):DemoIdentity=>{
    const header=request.headers.authorization;
    const token=typeof header==='string'&&/^Bearer [a-f0-9]{64}$/.test(header)?header.slice(7):'';
    const grant=grants.get(hash(token));
    if(!grant||grant.expiresAt<=Date.parse(options.now())){if(grant)grants.delete(hash(token));throw new AppError('DEMO_UNAUTHENTICATED','请重新选择模拟业务身份',401);}
    return grant.identity;
  };
  app.addHook('onRequest',async(request,reply)=>{
    if(!request.url.startsWith('/agent-api/'))return;
    reply.header('Cache-Control','no-store');
    if(request.headers.origin&&request.headers.origin!==options.origin)throw new AppError('ORIGIN_REJECTED','请求来源不受信任',403);
    identity(request);
  });
  app.post<{Body:{agentId:string;actorId:DemoIdentity['actorId']}}>('/api/demo-sessions',{schema:{body:{type:'object',additionalProperties:false,required:['agentId','actorId'],properties:{agentId:uuid,actorId:{enum:['U1001','U1002']}}}}},async(request,reply)=>{
    const now=Date.parse(options.now());for(const [key,value]of grants)if(value.expiresAt<=now)grants.delete(key);
    if(grants.size>=64)throw new AppError('SESSION_LIMIT','模拟登录会话已达上限',429);
    const bound=await service.identity(request.body.agentId,request.body.actorId);
    const token=randomBytes(32).toString('hex');const expiresAt=now+8*60*60*1000;
    grants.set(hash(token),{identity:bound,expiresAt});
    return reply.code(201).send({...bound,token,expiresAt:new Date(expiresAt).toISOString()} satisfies DemoGrant);
  });
  app.post<{Params:{agentId:string};Body:MessageInput}>('/agent-api/agents/:agentId/messages',{schema:{params:params(['agentId']),body:messageInputSchema}},async(request,reply)=>{
    const bound=identity(request);if(bound.agentId!==request.params.agentId)throw new AppError('DEMO_AGENT_FORBIDDEN','模拟登录不属于此 Agent',403);
    return reply.code(202).send(await service.send(bound,request.body));
  });
  app.get<{Params:{id:string}}>('/agent-api/requests/:id',{schema:{params:params(['id'])}},async request=>service.get(identity(request),request.params.id));
  app.post<{Params:{id:string}}>('/agent-api/requests/:id/cancel',{schema:{params:params(['id']),body:{type:'object',additionalProperties:false}}},async(request,reply)=>reply.code(202).send(await service.cancel(identity(request),request.params.id)));
  app.post<{Params:{id:string;actionId:string};Body:ActionDecision}>('/agent-api/requests/:id/actions/:actionId/decision',{schema:{params:params(['id','actionId']),body:actionDecisionSchema}},async request=>service.decide(identity(request),request.params.id,request.params.actionId,request.body));
  app.get<{Params:{id:string};Querystring:{after?:string}}>('/agent-api/requests/:id/events',{schema:{params:params(['id']),querystring:{type:'object',additionalProperties:false,properties:{after:{type:'string',pattern:'^\\d{1,10}$'}}}}},async request=>({items:await service.events(identity(request),request.params.id,Number(request.query.after??0))}));
  app.addHook('onClose',async()=>{grants.clear();});
}
