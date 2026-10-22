import type {FastifyInstance} from 'fastify';
import type {DevelopmentService} from './development-service.js';
import {developmentInputSchema,type DevelopmentInput} from '../../../../packages/contracts/src/development.js';
import {draftParamsSchema} from '../../../../packages/contracts/src/index.js';
export function registerDevelopmentRoutes(app:FastifyInstance,service:DevelopmentService){
 app.post<{Params:{id:string};Body:DevelopmentInput}>('/api/snapshots/:id/development',{schema:{params:draftParamsSchema,body:developmentInputSchema}},async(request,reply)=>reply.code(202).send(await service.start(request.params.id,request.body)));
 app.get<{Params:{id:string}}>('/api/drafts/:id/development',{schema:{params:draftParamsSchema}},async request=>({items:await service.list(request.params.id)}));
 app.get<{Params:{id:string}}>('/api/development/:id',{schema:{params:draftParamsSchema}},async request=>service.get(request.params.id));
 app.post<{Params:{id:string}}>('/api/development/:id/cancel',{schema:{params:draftParamsSchema,body:{type:'object',additionalProperties:false}}},async(request,reply)=>reply.code(202).send(await service.cancel(request.params.id)));
 app.get<{Params:{id:string};Querystring:{after?:string}}>('/api/development/:id/events',{schema:{params:draftParamsSchema,querystring:{type:'object',additionalProperties:false,properties:{after:{type:'string',pattern:'^\\d{1,10}$'}}}}},async request=>({items:await service.events(request.params.id,Number(request.query.after??0))}));
 app.get<{Params:{id:string};Querystring:{path:string}}>('/api/development/:id/file',{schema:{params:draftParamsSchema,querystring:{type:'object',additionalProperties:false,required:['path'],properties:{path:{type:'string',maxLength:200}}}}},async request=>service.file(request.params.id,request.query.path));
 app.get<{Params:{id:string;commandId:string}}>('/api/development/:id/commands/:commandId',{schema:{params:{type:'object',additionalProperties:false,required:['id','commandId'],properties:{id:{type:'string',format:'uuid'},commandId:{type:'string',format:'uuid'}}}}},async request=>service.command(request.params.id,request.params.commandId));
}
