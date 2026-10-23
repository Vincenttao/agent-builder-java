import Fastify from 'fastify';
import {createHash,timingSafeEqual} from 'node:crypto';
import type {EngineeringWorkspace} from './workspace.js';
import type {EngineeringRole} from '../../../../packages/contracts/src/development.js';
import {PolicyError} from './profile.js';
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const tools=[
 {name:'profile',description:'Inspect fixed generation policy and real TDD/build state.',inputSchema:object({})},
 {name:'read',description:'Read context.json, engineering-skill.md or a profile-allowed relative file. Tester can read implementation/ paths but never write them.',inputSchema:object({path:{type:'string'}})},
 {name:'write',description:'Write an allowed file. Developer must first write and run a failing unit test; its assertions freeze after valid red. Tester may only write test plan/proposal.',inputSchema:object({path:{type:'string'},content:{type:'string'}})},
 {name:'run',description:'Execute a fixed command: unit-test (compile and run Java tests) or build (independent contract checks and immutable JAR bundle). No shell or extra args.',inputSchema:object({commandId:{type:'string',enum:['unit-test','build']}})}
];
export function createEngineeringMcp(workspace:EngineeringWorkspace,tokens:{developer:string;tester:string}){
 const app=Fastify({bodyLimit:65536,ajv:{customOptions:{removeAdditional:false,coerceTypes:false}}});
 const hash=(value:string)=>createHash('sha256').update(value).digest();
 app.addHook('onRequest',async(request,reply)=>{
  const role=(request.params as {role?:string}).role;
  if((role!=='developer'&&role!=='tester')||!timingSafeEqual(hash(request.headers.authorization??''),hash(`Bearer ${tokens[role]}`)))return reply.code(401).send({error:'MCP_UNAUTHENTICATED'});
 });
 app.setErrorHandler((_error,_request,reply)=>reply.code(400).send({error:'MCP_INVALID_REQUEST'}));
 app.post<{Params:{role:EngineeringRole};Body:{jsonrpc:string;id?:string|number;method:string;params?:Record<string,unknown>}}>('/mcp/:role',{schema:{body:object({jsonrpc:{const:'2.0'},id:{anyOf:[{type:'string'},{type:'number'}]},method:{type:'string'},params:{type:'object'}},['jsonrpc','method'])}},async(request,reply)=>{
  const {id,method,params={}}=request.body;const role=request.params.role;
  if(method.startsWith('notifications/')&&id===undefined)return reply.code(202).send();
  let result:unknown;
  if(method==='initialize')result={protocolVersion:typeof params.protocolVersion==='string'?params.protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'agent-builder-engineering',version:'1'}};
  else if(method==='ping')result={};
  else if(method==='tools/list')result={tools:tools.filter(tool=>role==='developer'||tool.name!=='run')};
  else if(method==='tools/call'){
   try{
    const name=params.name;const args=params.arguments??{};
    if(!args||typeof args!=='object'||Array.isArray(args))throw new PolicyError('TOOL_ARGUMENTS_INVALID');
    const values=args as Record<string,unknown>;const expected=name==='read'?['path']:name==='write'?['path','content']:name==='run'&&role==='developer'?['commandId']:name==='profile'?[]:null;
    if(!expected||Object.keys(values).length!==expected.length||expected.some(key=>typeof values[key]!=='string'))throw new PolicyError('TOOL_ARGUMENTS_INVALID');
    const value=name==='read'?await workspace.read(role,values.path as string):name==='write'?await workspace.write(role,values.path as string,values.content as string):name==='run'?await workspace.run(role,values.commandId as string):{profile:workspace.profile,state:workspace.inspect()};
    result={content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]};
   }catch(error){result={isError:true,content:[{type:'text',text:error instanceof PolicyError?error.code:(error as NodeJS.ErrnoException).code==='ENOENT'?'FILE_NOT_FOUND':'ENGINEERING_OPERATION_FAILED'}]};}
  }else return{jsonrpc:'2.0',id:id??null,error:{code:-32601,message:'Method not found'}};
  return{jsonrpc:'2.0',id:id??null,result};
 });
 return app;
}
