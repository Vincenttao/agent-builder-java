import type {EngineeringRole} from '../../../../packages/contracts/src/development.js';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {startManagedProcess} from '../processes/supervisor.js';
import {generationProfile,PolicyError,type GenerationProfile} from './profile.js';
export interface EngineOptions {root:string;executable:string;modelKey:string;mcpBase:string;tokens:{developer:string;tester:string};maxTaskMs?:number;apiTimeoutMs?:number;profile?:GenerationProfile}
export interface RoleResult {sessionId:string;role:EngineeringRole;status:'completed'|'failed'|'cancelled';publicParts:unknown[];usage:unknown;error?:string}
export class OpenCodeEngine {
 private process:ReturnType<typeof startManagedProcess>|undefined;private base='';private version='unknown';private stopped=false;private stopping:Promise<void>|undefined;
 private readonly password=randomBytes(32).toString('hex');private active:{role:EngineeringRole;sessionId:string}|undefined;
 constructor(private readonly options:EngineOptions){}
 private directory(role:EngineeringRole){return resolve(this.options.root,role);}
 private async api<T>(path:string,method='GET',body?:unknown,role?:EngineeringRole):Promise<T>{
  const url=new URL(this.base+path);if(role)url.searchParams.set('directory',this.directory(role));
  const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(this.options.apiTimeoutMs??60_000),headers:{authorization:`Basic ${Buffer.from('opencode:'+this.password).toString('base64')}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw new PolicyError('ENGINE_REQUEST_FAILED');if(response.status===204)return undefined as T;return response.json() as Promise<T>;
 }
 async start():Promise<void>{
  if(this.process)return;if(this.stopped)throw new PolicyError('ENGINE_STOPPED');
  const profile=this.options.profile??generationProfile;
  const control=resolve(this.options.root,'control');await mkdir(control,{recursive:true});
  const permission={'*':'deny','builder_*':'allow'};
  const agents=Object.fromEntries((['developer','tester'] as const).map(role=>[`builder-${role}`,{description:`Agent Builder ${role}`,mode:'primary',model:profile.model,temperature:0,steps:profile.maxSteps,prompt:profile.engineeringSkills[role],permission}]));
  const config={model:profile.model,small_model:profile.model,permission,autoupdate:false,share:'disabled',agent:agents,provider:{'deepseek-local':{npm:'@ai-sdk/openai-compatible',options:{apiKey:'{env:DEEPSEEK_API_KEY}',baseURL:'https://api.deepseek.com/v1'},models:{'deepseek-v4-flash':{name:'DeepSeek V4 Flash'}}}}};
  const configPath=join(control,'opencode.json');await writeFile(configPath,JSON.stringify(config));
  for(const role of ['developer','tester'] as const){await mkdir(this.directory(role),{recursive:true});
   await writeFile(join(this.directory(role),'opencode.json'),JSON.stringify({permission,agent:agents,mcp:{builder:{type:'remote',url:`${this.options.mcpBase}/mcp/${role}`,enabled:true,oauth:false,headers:{Authorization:`Bearer {env:BUILDER_${role.toUpperCase()}_MCP_TOKEN}`}}}}));
  }
  const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const address=listener.address();if(!address||typeof address==='string')throw new Error('ENGINE_PORT_UNAVAILABLE');const port=address.port;await new Promise<void>(r=>listener.close(()=>r()));this.base=`http://127.0.0.1:${port}`;
  if(this.stopped)throw new PolicyError('ENGINE_STOPPED');
  this.process=startManagedProcess({executable:this.options.executable,args:['serve','--hostname','127.0.0.1','--port',String(port)],cwd:resolve(this.options.root),
   env:{DEEPSEEK_API_KEY:this.options.modelKey,OPENCODE_SERVER_PASSWORD:this.password,OPENCODE_CONFIG:configPath,
    OPENCODE_CONFIG_CONTENT:JSON.stringify({permission,autoupdate:false}),XDG_CONFIG_HOME:join(control,'engine-config'),XDG_DATA_HOME:join(control,'engine-data'),XDG_CACHE_HOME:resolve(this.options.root,'..','engine-cache'),
    BUILDER_DEVELOPER_MCP_TOKEN:this.options.tokens.developer,BUILDER_TESTER_MCP_TOKEN:this.options.tokens.tester},
   secrets:[this.options.modelKey,this.password,...Object.values(this.options.tokens)],onLine:()=>{}
  });
  const deadline=Date.now()+45000;
  while(Date.now()<deadline&&!this.stopped){
   if(['failed','exited','stopped'].includes(this.process.state()))throw new PolicyError('ENGINE_START_FAILED');
   try{const health=await this.api<{healthy:boolean;version:string}>('/global/health');if(health.healthy){this.version=health.version;if(this.version!==profile.engineVersion)throw new PolicyError('ENGINE_VERSION_MISMATCH');return;}}catch(error){if(error instanceof PolicyError&&error.code==='ENGINE_VERSION_MISMATCH')throw error;}
   await new Promise(r=>setTimeout(r,200));
  }
  await this.stop();throw new PolicyError('ENGINE_START_TIMEOUT');
 }
 private safe<T>(value:T):T{let text=JSON.stringify(value);for(const secret of [this.options.modelKey,this.password,...Object.values(this.options.tokens)])if(secret)text=text.replaceAll(secret,'[REDACTED]');return JSON.parse(text) as T;}
 async runRole(role:EngineeringRole,prompt:string):Promise<RoleResult>{
  if(this.stopped||!this.process)throw new PolicyError('ENGINE_NOT_RUNNING');if(this.active)throw new PolicyError('ENGINE_ROLE_BUSY');
  const recordPath=resolve(this.options.root,'control',`${role}-session.json`);
  try{await readFile(recordPath);throw new PolicyError('ENGINE_TASK_REQUIRES_RECONCILIATION');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const session=await this.api<{id:string}>('/session','POST',{title:`Agent Builder ${role}`},role);this.active={role,sessionId:session.id};
  await writeFile(recordPath,JSON.stringify({role,sessionId:session.id,status:'running'}));
  const deadline=Date.now()+(this.options.maxTaskMs??(this.options.profile??generationProfile).maxTaskSeconds*1000);
  try{
   await this.api(`/session/${session.id}/prompt_async`,'POST',{agent:`builder-${role}`,model:{providerID:'deepseek-local',modelID:'deepseek-v4-flash'},parts:[{type:'text',text:prompt}]},role);
   while(Date.now()<deadline&&!this.stopped){
    const messages=await this.api<Array<{info:{role:string;time?:{completed?:number};finish?:string;error?:unknown;tokens?:unknown;cost?:number};parts:Array<{type:string}>}>>(`/session/${session.id}/message?limit=100`,'GET',undefined,role);
    const statuses=await this.api<Record<string,{type:string}>>('/session/status','GET',undefined,role);
    const assistants=messages.filter(message=>message.info.role==='assistant');const last=assistants.at(-1);
    if(last?.info.time?.completed&&(!statuses[session.id]||statuses[session.id]?.type==='idle')&&last.info.finish!=='tool-calls'){
     const publicParts=this.safe(assistants.flatMap(message=>message.parts.filter(part=>['text','tool','step-finish'].includes(part.type))));
     if(Buffer.byteLength(JSON.stringify(publicParts))>2_000_000)throw new PolicyError('ENGINE_EVIDENCE_LIMIT');
     const result:RoleResult={role,sessionId:session.id,status:last.info.error?'failed':'completed',publicParts,usage:assistants.map(message=>({tokens:message.info.tokens??null,cost:message.info.cost??null})),...(last.info.error?{error:'ENGINE_MODEL_FAILED'}:{})};
     await writeFile(recordPath,JSON.stringify(result,null,2));return result;
    }
    if(['failed','exited','stopped'].includes(this.process.state()))throw new PolicyError('ENGINE_PROCESS_EXITED');await new Promise(r=>setTimeout(r,500));
   }
   if(!this.stopped){await this.stop();throw new PolicyError('ENGINE_BUDGET_EXCEEDED');}
   const result:RoleResult={sessionId:session.id,role,status:'cancelled',publicParts:[],usage:null};await writeFile(recordPath,JSON.stringify(result));return result;
  }finally{this.active=undefined;}
 }
 async stop():Promise<void>{
  return this.stopping??=this.stopOwned();
 }
 private async stopOwned(){this.stopped=true;if(this.active)await this.api(`/session/${this.active.sessionId}/abort`,'POST',{},this.active.role).catch(()=>{});if(this.process)await this.process.stop();}
 inspect(){return{version:this.version,base:this.base};}
}
