import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,openSync,closeSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {settings,compatibleBaseUrl} from './settings.js';
import {WorkbenchError} from './projects.js';
import type {CodingEngine,CodingEvidence,CodingResult} from './coding.js';
type Request=(path:string,body?:unknown,timeout?:number)=>Promise<any>;
export class OpenCodeEngine implements CodingEngine{
 readonly kind='opencode';
 private active=new Map<string,{request:Request;sessionId:string}>();
 constructor(private repository=process.cwd()){}
 async answer(directory:string,id:string,answers:string[][]){
  const active=this.active.get(directory);if(!active)throw new WorkbenchError('CODING_NOT_ACTIVE','原助手进程已结束',409);
  const questions=await active.request('/question');if(!questions.some((q:any)=>q.id===id&&q.sessionID===active.sessionId))throw new WorkbenchError('STALE_QUESTION','该问题已过期或不属于当前任务',409);
  await active.request('/question/'+encodeURIComponent(id)+'/reply',{answers});
 }
 async run(input:Parameters<CodingEngine['run']>[0]):Promise<CodingResult>{
  const config=settings(this.repository);if(!config.apiKey)throw new WorkbenchError('MODEL_KEY_MISSING','本机未配置模型 Key（MODEL_API_KEY）');
  const port=await new Promise<number>(resolve=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const p=(server.address() as any).port;server.close(()=>resolve(p));});});
  const root=dirname(input.directory),native=join(config.repository,'.workbench/opencode-native');mkdirSync(native,{recursive:true});
  const clientConfig={model:'workbench/'+config.model,small_model:'workbench/'+config.model,autoupdate:false,provider:{'workbench':{npm:'@ai-sdk/openai-compatible',name:'Workbench OpenAI compatible',options:{baseURL:compatibleBaseUrl(config.baseUrl),apiKey:'{env:MODEL_API_KEY}'},models:{[config.model]:{name:config.model,limit:{context:131072,output:8192},options:config.model==='deepseek-flash'?{thinking:{type:'disabled'}}:{}}}}},agent:{build:{steps:40}},permission:{'*':'deny',read:'allow',glob:'allow',grep:'allow',list:'allow',edit:'allow',skill:'allow',question:'allow',bash:'deny',external_directory:'deny',webfetch:'deny'}};
  const log=openSync(join(root,'opencode.log'),'a');
  const child=spawn(config.opencode,['serve','--port',String(port),'--hostname','127.0.0.1'],{cwd:input.directory,stdio:['ignore',log,log],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',XDG_CONFIG_HOME:join(native,'config'),XDG_DATA_HOME:join(native,'data'),XDG_CACHE_HOME:join(config.repository,'.workbench/opencode-cache'),MODEL_API_KEY:config.apiKey,OPENCODE_CONFIG_CONTENT:JSON.stringify(clientConfig),OPENCODE_DISABLE_MODELS_FETCH:'true'}});
  closeSync(log);let startError:unknown;child.once('error',error=>{startError=error;});let sessionId='';
  const request:Request=async(path,body,timeout=20_000)=>{
   const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-opencode-directory':input.directory},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([input.signal,AbortSignal.timeout(timeout)])});
   if(!response.ok)throw new WorkbenchError('OPENCODE_HTTP','OpenCode 接口 '+path.split('?')[0]+' 返回 HTTP '+response.status,502);
   return response.status===204?undefined:response.json();
  };
  const abort=()=>{if(sessionId)void fetch(`http://127.0.0.1:${port}/session/${sessionId}/abort`,{method:'POST',headers:{'x-opencode-directory':input.directory},signal:AbortSignal.timeout(2000)}).catch(()=>{});child.kill('SIGTERM');};
  input.signal.addEventListener('abort',abort,{once:true});
  try{
   input.onEvent({type:'starting',message:'启动本机 OpenCode，会话将使用固定范式 Skill'});
   let health:any;const bootDeadline=Date.now()+90_000;
   while(Date.now()<bootDeadline){
    if(input.signal.aborted)throw new WorkbenchError('CANCELLED','任务已取消');if(startError||child.exitCode!==null)throw new WorkbenchError('OPENCODE_START_FAILED','OpenCode 未启动，请核对本机可执行程序和端口');
    try{health=await request('/global/health',undefined,2000);if(health.healthy)break;}catch{}await delay(250);
   }
   if(!health?.healthy)throw new WorkbenchError('OPENCODE_START_TIMEOUT','OpenCode 健康检查超时，请核对原进程状态');
   if(health.version!=='1.18.9')throw new WorkbenchError('OPENCODE_VERSION','当前验证版本为 OpenCode 1.18.9；请核验新版本 API 后更新基线');
   const session=await request('/session',{title:'Agent 工程修订'},90_000);sessionId=session.id;
   this.active.set(input.directory,{request,sessionId});input.onEvent({type:'session',sessionId,version:health.version,model:config.model});
   const prompt=`必须先通过 skill 工具读取 ${input.skill}，再读取 application.json、instructions.md 和相关 Skill。\n本工程是固定提交的任务副本。只修改本角色允许的文件，用实际编辑工具交付差异；不触碰固定约束、密钥或运行数据。若有业务范围/System Prompt/Skill 冲突，联合修订并说明理由；目标不清晰才使用 question。Bash 未授权，不能声称运行了 Bash 检查。\n用户需求：\n${input.prompt}`;
   await request('/session/'+sessionId+'/prompt_async',{model:{providerID:'workbench',modelID:config.model},parts:[{type:'text',text:prompt}]},20_000);
   const seen=new Set<string>();let deadline=Date.now()+240_000;let pendingQuestion='';
   while(Date.now()<deadline){
    if(input.signal.aborted)throw new WorkbenchError('CANCELLED','任务已取消');if(child.exitCode!==null)throw new WorkbenchError('OPENCODE_EXITED','编码过程中 OpenCode 退出');
    const [statuses,messages,questions]=await Promise.all([request('/session/status'),request('/session/'+sessionId+'/message'),request('/question')]);
    for(const message of messages as any[])for(const part of message.parts??[]){if(part.type==='tool'&&part.state?.status==='completed'&&!seen.has(part.id)){seen.add(part.id);input.onEvent({type:'tool',tool:part.tool,status:'completed',input:part.state.input});}}
    const question=(questions as any[]).find(q=>q.sessionID===sessionId);
    if(question){if(question.id!==pendingQuestion){pendingQuestion=question.id;deadline=Date.now()+300_000;input.onEvent({type:'question',id:question.id,questions:question.questions});}}
    else if(pendingQuestion){pendingQuestion='';deadline=Date.now()+240_000;input.onEvent({type:'question_answered'});}
    const assistant=(messages as any[]).filter(m=>m.info?.role==='assistant').at(-1);
    if(assistant?.info?.error)throw new WorkbenchError('MODEL_CALL_FAILED','模型返回错误；请核对本机 Key、额度和服务状态');
    if(!question&&assistant?.info?.time?.completed&&assistant?.info?.finish==='stop'&&statuses[sessionId]?.type!=='busy'){
     const evidence:CodingEvidence[]=(messages as any[]).flatMap(m=>m.parts??[]).filter(p=>p.type==='tool').map(p=>({tool:p.tool,status:p.state?.status??'unknown',input:p.state?.input}));
     const summary=(assistant.parts??[]).filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n').slice(0,16000);
     return {sessionId,model:config.model,summary,evidence};
    }
    await delay(750);
   }
   throw new WorkbenchError('CODING_TIMEOUT','助手任务达到运行或等待期限，已停止；请查看原任务记录');
  }finally{
   this.active.delete(input.directory);input.signal.removeEventListener('abort',abort);
   if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise<void>(resolve=>child.once('exit',()=>resolve())),delay(2000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  }
 }
}
