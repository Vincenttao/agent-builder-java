import type {FastifyInstance} from 'fastify';
import type {EngineeringTaskManager} from './task-manager.js';
import {engineeringTaskInputSchema,type EngineeringTaskInput} from '../../../../packages/contracts/src/development.js';
import {uuidParamsSchema} from '../../../../packages/contracts/src/runtime.js';
import {generationProfile,PolicyError} from './profile.js';
export function registerEngineeringRoutes(app:FastifyInstance,manager:EngineeringTaskManager,modelConfigured:boolean){
 app.get('/engineering/profile',async()=>({profile:generationProfile,modelConfigured}));
 app.put<{Params:{id:string};Body:EngineeringTaskInput}>('/engineering/tasks/:id',{schema:{params:uuidParamsSchema,body:engineeringTaskInputSchema}},async(request,reply)=>{
  if(!modelConfigured)throw new PolicyError('ENGINE_MODEL_NOT_CONFIGURED');return reply.code(202).send(await manager.submit(request.params.id,request.body));
 });
 app.get<{Params:{id:string}}>('/engineering/tasks/:id',{schema:{params:uuidParamsSchema}},async request=>manager.get(request.params.id));
 app.post<{Params:{id:string}}>('/engineering/tasks/:id/cancel',{schema:{params:uuidParamsSchema,body:{type:'object',additionalProperties:false}}},async(request,reply)=>reply.code(202).send(await manager.cancel(request.params.id)));
 app.get<{Params:{id:string};Querystring:{after?:string}}>('/engineering/tasks/:id/events',{schema:{params:uuidParamsSchema,querystring:{type:'object',additionalProperties:false,properties:{after:{type:'string',pattern:'^\\d{1,10}$'}}}}},async request=>({items:await manager.events(request.params.id,Number(request.query.after??0))}));
 app.get<{Params:{id:string};Querystring:{path:string}}>('/engineering/tasks/:id/file',{schema:{params:uuidParamsSchema,querystring:{type:'object',additionalProperties:false,required:['path'],properties:{path:{type:'string',maxLength:200}}}}},async request=>manager.file(request.params.id,request.query.path));
 app.get<{Params:{id:string;commandId:string}}>('/engineering/tasks/:id/commands/:commandId',{schema:{params:{type:'object',additionalProperties:false,required:['id','commandId'],properties:{id:{type:'string',format:'uuid'},commandId:{type:'string',format:'uuid'}}}}},async request=>manager.command(request.params.id,request.params.commandId));
}
