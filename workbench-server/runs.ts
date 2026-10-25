import {publicExecution} from './execution-settings.js';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,existsSync,statSync,lstatSync,realpathSync,rmSync,readdirSync} from 'node:fs';
import {join,dirname,relative,resolve} from 'node:path';
import {ProjectStore,WorkbenchError,validateFiles,type Role} from './projects.js';
import {ownsProcess,stopOwnedProcess,sanitize,type RunEngine,type OwnedProcess,type RunningJava} from './local-java.js';
export type RunRecord={testing?:string;configuration?:ReturnType<typeof publicExecution>;id:string;projectId:string;role:Role;head:string;sourceReleaseId:string|null;createdAt:string;engine:string;status:'building'|'starting'|'running'|'stopping'|'stopped'|'failed'|'interrupted'|'unresponsive';logs:string[];process?:OwnedProcess;origin?:string;artifact?:{path:string;sha256:string;bytes:number};conversations:string[];unobserved?:string[];error?:{code:string;message:string}};
const liveStatuses=new Set(['building','starting','running','stopping','unresponsive']);
const conversationPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(code:string,message:string,status=409):never{throw new WorkbenchError(code,message,status);}
export class RunManager{
 readonly ready:Promise<void>;
 private records=new Map<string,RunRecord>();private active=new Set<string>();private controllers=new Map<string,AbortController>();
 private launches=new Map<string,Promise<void>>();private handles=new Map<string,RunningJava>();private closed=false;private requests=new Set<Promise<unknown>>();
 constructor(private store:ProjectStore,private engine:RunEngine){
  store.db.exec('CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,record TEXT NOT NULL)');
  this.ready=this.recover();
 }
 directory(id:string){if(!conversationPattern.test(id))fail('NOT_FOUND','运行记录不存在',404);return join(this.store.root,'runs',id);}
 private persist(run:RunRecord){this.records.set(run.id,run);this.store.db.prepare('INSERT INTO runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(run.id,run.projectId,JSON.stringify(run));}
 private record(id:string){const cached=this.records.get(id);if(cached)return cached;const row=this.store.db.prepare('SELECT record FROM runs WHERE id=?').get(id) as {record:string}|undefined;if(!row)fail('NOT_FOUND','运行记录不存在',404);const run=JSON.parse(row.record) as RunRecord;this.records.set(id,run);return run;}
 get(id:string,role:Role){const run=this.record(id);this.store.get(run.projectId,role);return JSON.parse(JSON.stringify(run)) as RunRecord;}
 list(id:string,role:Role){this.store.get(id,role);return (this.store.db.prepare('SELECT id FROM runs WHERE projectId=? ORDER BY rowid DESC LIMIT 24').all(id) as {id:string}[]).map(row=>this.get(row.id,role));}
 listAll(role:Role){return (this.store.db.prepare('SELECT id FROM runs ORDER BY rowid DESC LIMIT 24').all() as {id:string}[]).flatMap(row=>{try{return [this.get(row.id,role)];}catch(error){if(error instanceof WorkbenchError&&error.code==='FORBIDDEN')return [];throw error;}});}
 claimTesting(id:string,role:Role,reportId:string){const run=this.record(id);this.owner(run,role);if(run.testing||run.status!=='running'||run.unobserved?.length)fail('RUN_UNDER_TEST','运行正在测试或有未核对的请求，请先核对原状态');run.testing=reportId;this.persist(run);}
 releaseTesting(id:string,reportId:string){const run=this.record(id);if(run.testing===reportId){delete run.testing;this.persist(run);}}
 private testingAllowed(run:RunRecord,token?:string){if(run.testing&&run.testing!==token)fail('RUN_UNDER_TEST','该运行正在执行业务回归，请查看报告或先取消测试');}
 private owner(run:RunRecord,role:Role){this.store.get(run.projectId,role);if(run.role!==role)fail('FORBIDDEN','请使用发起运行的身份操作',403);}
 private log(run:RunRecord,text:string){const value=sanitize(text).slice(-4000);run.logs.push(value);if(run.logs.length>150)run.logs.shift();const file=join(this.directory(run.id),'process.log');if(!existsSync(file)||statSync(file).size<2_000_000)appendFileSync(file,value);this.persist(run);}
 async start(id:string,role:Role,head:string){
  await this.ready;if(this.closed)fail('WORKBENCH_STOPPED','工作台正在关闭');
  const project=this.store.get(id,role);if((project.kind==='template')!==(role==='platform'))fail('FORBIDDEN','当前身份不能发起该工程的调试',403);
  if(project.head!==head||this.store.git(id,['rev-parse','HEAD'])!==head)fail('REVISION_CONFLICT','请保存并刷新当前版本后运行');
  if(this.active.size)fail('RUN_BUSY','已有构建或 Java 进程，请继续查看原运行或明确停止后再启动');
  if(this.store.git(id,['status','--porcelain']))fail('UNSAVED_EXTERNAL_CHANGE','存在工作台外的修改，请先核对');
  if((this.store.db.prepare('SELECT count(*) AS n FROM runs').get() as {n:number}).n>=24)fail('RETENTION_LIMIT','运行记录已达 24 份，请先下载并清理不再使用的历史运行');
  const files=this.store.snapshot(id,head);validateFiles(files);
  if(!files['pom.xml']||!files['src/main/java/com/openjiuwen/workbench/BusinessApplication.java'])fail('RUNTIME_SOURCE_MISSING','模板缺少 Java 运行源码，请使用包含运行基础的新模板');
  if(Object.values(files).some(text=>/sk-[a-zA-Z0-9_-]{20,}/.test(text)))fail('SECRET_IN_PROJECT','工程包含疑似模型 Key；请移到本机私有配置');
  const run:RunRecord={id:randomUUID(),projectId:id,role,head,sourceReleaseId:project.sourceReleaseId,createdAt:new Date().toISOString(),engine:this.engine.kind,status:'building',logs:[],conversations:[]};
  const root=this.directory(run.id);mkdirSync(root,{recursive:true});writeFileSync(join(root,'owner.json'),JSON.stringify({kind:'workbench-run',id:run.id,projectId:id}));
  const directory=join(root,'project');mkdirSync(directory);for(const [name,text]of Object.entries(files)){const path=join(directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
  mkdirSync(join(root,'observations'));writeFileSync(join(root,'source.json'),JSON.stringify({projectId:id,head,sourceReleaseId:project.sourceReleaseId,files:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,createHash('sha256').update(text).digest('hex')]))},null,2));
  this.active.add(run.id);this.persist(run);const controller=new AbortController();this.controllers.set(run.id,controller);
  const execution=this.launch(run,controller).finally(()=>this.launches.delete(run.id));this.launches.set(run.id,execution);return this.get(run.id,role);
 }
 private async launch(run:RunRecord,controller:AbortController){
  const directory=join(this.directory(run.id),'project');
  const input={directory,runId:run.id,signal:controller.signal,onLog:(value:string)=>this.log(run,value),onProcess:(process:OwnedProcess)=>{run.process=process;this.persist(run);}};
  try{
   const configuration=this.engine.configure?.(directory);if(configuration){Object.assign(input,{configuration});run.configuration=publicExecution(configuration);this.persist(run);if(!configuration.apiKey)throw new WorkbenchError('MODEL_KEY_MISSING','所选模型配置档没有可用凭据，请配置后发起新运行');}
   const result=await this.engine.build(input);if(controller.signal.aborted)throw new Error('cancelled');
   const artifact=realpathSync(result.jar);const path=relative(realpathSync(directory),artifact);if(path.startsWith('..')||path.startsWith('/'))fail('ARTIFACT_INVALID','构建产物不在本次工程中');
   const bytes=statSync(artifact).size;if(bytes>350_000_000)fail('ARTIFACT_TOO_LARGE','本 Demo 单个 JAR 限制为 350 MB');
   run.artifact={path:join('project',path),sha256:createHash('sha256').update(readFileSync(artifact)).digest('hex'),bytes};run.status='starting';delete run.process;this.persist(run);
   const handle=await this.engine.start({...input,jar:artifact,stateDirectory:join(this.directory(run.id),'state')});
   if(controller.signal.aborted){await handle.stop();throw new Error('cancelled');}
   if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(handle.origin)){await handle.stop();fail('JAVA_ORIGIN_INVALID','Java 必须监听本机回环地址');}
   this.handles.set(run.id,handle);run.origin=handle.origin;run.process=handle.process;run.status='running';this.persist(run);
   void handle.exited.then(result=>{const stopped=run.status==='stopping'||controller.signal.aborted;run.status=stopped?'stopped':'interrupted';if(!stopped)run.error={code:'JAVA_EXITED',message:'原 Java 进程已退出，未完成业务需核对；不会自动重放'};this.active.delete(run.id);this.handles.delete(run.id);this.controllers.delete(run.id);this.persist(run);});
  }catch(error){run.status=controller.signal.aborted?'stopped':'failed';run.error=controller.signal.aborted?undefined:error instanceof WorkbenchError?{code:error.code,message:error.message}:{code:'RUN_FAILED',message:'构建或启动失败，请核对本次运行日志'};this.active.delete(run.id);this.controllers.delete(run.id);this.persist(run);}
 }
 async stop(id:string,role:Role){await this.ready;const run=this.record(id);this.owner(run,role);if(!this.closed)this.testingAllowed(run);if(!liveStatuses.has(run.status))return this.get(id,role);run.status='stopping';this.persist(run);
  const handle=this.handles.get(id);this.controllers.get(id)?.abort();
  if(handle)await handle.stop();else if(this.launches.has(id))await this.launches.get(id);else if(run.process&&ownsProcess(run.process))await stopOwnedProcess(run.process);
  run.status='stopped';this.active.delete(id);this.controllers.delete(id);this.handles.delete(id);this.persist(run);return this.get(id,role);
 }
 async reconnect(id:string,role:Role){
  await this.ready;const run=this.record(id);this.owner(run,role);
  if(!run.process||!ownsProcess(run.process)){run.status='interrupted';run.error={code:'PROCESS_MISSING',message:'原进程已退出，未完成业务需核对'};this.active.delete(id);this.persist(run);return this.get(id,role);}
  if(run.process.kind!=='java'||!run.origin)fail('ORIGINAL_PROCESS_ALIVE','原构建仍在运行；只能等待或明确停止，不能重复启动');
  try{const response=await fetch(run.origin+'/workbench/application',{signal:AbortSignal.timeout(2000)});const data=await response.json() as any;if(!response.ok||data.runId!==id)throw new Error('identity');}
  catch{fail('JAVA_NOT_READY','已找到原 Java 进程但服务尚未就绪；不会重复启动');}
  run.status='running';delete run.error;this.active.add(id);this.persist(run);return this.get(id,role);
 }
 private async backend(run:RunRecord,path:string,body?:unknown){
  if(this.closed)fail('WORKBENCH_STOPPED','工作台正在关闭');
  if(run.status!=='running'||!run.origin)fail('RUN_NOT_ACTIVE','该运行当前不接受业务操作；历史只读，请勿重复提交');
  try{
   const response=await fetch(run.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(body===undefined?5000:240000)});
   const raw=await response.text();if(raw.length>4_000_000)fail('JAVA_RESPONSE_TOO_LARGE','Java 返回超出本 Demo 限制');const data=JSON.parse(raw);
   if(!response.ok)throw new WorkbenchError(typeof data.error==='string'&&/^[A-Z_]+$/.test(data.error)?data.error:'JAVA_REQUEST_REJECTED','Java 拒绝该操作；请核对当前任务、确认或运行记录',response.status);
   return data;
  }catch(error){if(error instanceof WorkbenchError)throw error;throw new WorkbenchError('JAVA_REQUEST_UNOBSERVED','没有取得原请求结果；先查看原会话/回执，不要重发写操作',502);}
 }
 private capture(run:RunRecord,view:any){
  if(typeof view?.conversationId!=='string'||!conversationPattern.test(view.conversationId))fail('JAVA_RESPONSE_INVALID','Java 返回缺少有效会话标识');
  if(!run.conversations.includes(view.conversationId)){if(run.conversations.length>=64)fail('CONVERSATION_LIMIT','该运行会话已达上限');run.conversations.push(view.conversationId);this.persist(run);}
  if(!view.busy&&run.unobserved?.includes(view.conversationId)){run.unobserved=run.unobserved.filter(id=>id!==view.conversationId);this.persist(run);}
  writeFileSync(join(this.directory(run.id),'observations',view.conversationId+'.json'),JSON.stringify(view));return {...view,live:true,runId:run.id};
 }
 async message(id:string,role:Role,body:unknown,testingToken?:string){const run=this.record(id);this.owner(run,role);this.testingAllowed(run,testingToken);const value=body as {query?:unknown;conversationId?:unknown};if(typeof value?.query!=='string'||!value.query.trim()||value.query.length>12000)fail('INVALID_QUERY','请输入业务消息',400);
  if(value.conversationId!==undefined&&value.conversationId!==null&&(typeof value.conversationId!=='string'||!conversationPattern.test(value.conversationId)||!run.conversations.includes(value.conversationId)))fail('CONVERSATION_NOT_FOUND','该会话不属于本次运行',404);
  return this.track((async()=>{const conversation=value.conversationId?String(value.conversationId):this.capture(run,await this.backend(run,'/workbench/conversations',{})).conversationId;return this.perform(run,conversation,'/workbench/messages',{...value,conversationId:conversation});})());
 }
 async command(id:string,role:Role,conversation:string,action:string,body:unknown,testingToken?:string){const run=this.record(id);this.owner(run,role);this.testingAllowed(run,testingToken);this.conversationOwned(run,conversation);if(!['reply','decide','resume','receipt'].includes(action))fail('INVALID_ACTION','不支持该业务操作',400);if(!body||typeof body!=='object'||Array.isArray(body))fail('INVALID_ACTION_INPUT','请提供该任务的操作参数',400);return this.track(this.perform(run,conversation,'/workbench/conversations/'+conversation+'/'+action,body));}
 private async perform(run:RunRecord,conversation:string,path:string,body:unknown){
  run.unobserved=[...new Set([...(run.unobserved??[]),conversation])];this.persist(run);
  try{const view=await this.backend(run,path,body);if(view.conversationId!==conversation)fail('JAVA_RESPONSE_INVALID','会话关联不匹配');return this.capture(run,view);}
  catch(error){if(error instanceof WorkbenchError&&error.status<500&&!['JAVA_REQUEST_UNOBSERVED','JAVA_RESPONSE_INVALID','JAVA_RESPONSE_TOO_LARGE'].includes(error.code)){run.unobserved=run.unobserved.filter(id=>id!==conversation);this.persist(run);}throw error;}
 }
 async observe(id:string,role:Role,conversation:string){const run=this.record(id);this.owner(run,role);this.conversationOwned(run,conversation);return this.track(this.backend(run,'/workbench/conversations/'+conversation).then(view=>{if(view.conversationId!==conversation)fail('JAVA_RESPONSE_INVALID','会话关联不匹配');return this.capture(run,view);}));}
 private conversationOwned(run:RunRecord,id:string){if(!conversationPattern.test(id)||!run.conversations.includes(id))fail('CONVERSATION_NOT_FOUND','该会话不属于本次运行',404);}
 async conversation(id:string,role:Role,conversation:string){const run=this.record(id);this.store.get(run.projectId,role);this.conversationOwned(run,conversation);
  if(run.status==='running'){const view=await this.backend(run,'/workbench/conversations/'+conversation);if(view.conversationId!==conversation)fail('JAVA_RESPONSE_INVALID','会话关联不匹配');return {...view,live:true,runId:id,unobserved:run.unobserved?.includes(conversation)??false};}
  const view=JSON.parse(readFileSync(join(this.directory(id),'observations',conversation+'.json'),'utf8'));return {...view,live:false,runId:id,interrupted:run.status==='interrupted'||!!run.unobserved?.includes(conversation)||!!view.stack?.current&&!['COMPLETED','FAILED','ABANDONED'].includes(view.stack.current.state)||!!view.stack?.retained,notice:'仅为停止前的观察快照；未完成业务需核对，不能继续确认或重放'};
 }
 async remove(id:string,role:Role){const run=this.record(id);this.owner(run,role);if(liveStatuses.has(run.status)||this.active.has(id))fail('RUN_STILL_ACTIVE','先明确停止原进程再清理运行目录');
  const directory=this.directory(id);if(!existsSync(directory)||lstatSync(directory).isSymbolicLink()||realpathSync(directory)!==resolve(directory))fail('WORKSPACE_OWNERSHIP_MISMATCH','运行目录归属不匹配');
  const owner=JSON.parse(readFileSync(join(directory,'owner.json'),'utf8'));if(owner.kind!=='workbench-run'||owner.id!==id||owner.projectId!==run.projectId)fail('WORKSPACE_OWNERSHIP_MISMATCH','运行目录归属不匹配');
  this.store.db.transaction(()=>{try{this.store.db.prepare('DELETE FROM runs WHERE id=?').run(id);}catch{fail('RUN_REFERENCED','该运行仍被测试、候选或交付证据引用，不能清理');}rmSync(directory,{recursive:true,force:true});})();this.records.delete(id);
 }
 private findProcess(id:string):OwnedProcess|undefined{
  const marker='-Dworkbench.runId='+id;
  for(const entry of readdirSync('/proc'))if(/^\d+$/.test(entry))try{const args=readFileSync(`/proc/${entry}/cmdline`,'utf8').split('\0');if(!args.includes(marker))continue;const stat=readFileSync(`/proc/${entry}/stat`,'utf8');return {pid:Number(entry),started:stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19],marker,kind:args.includes('-jar')?'java':'build'};}catch{}
 }
 private async recover(){
  const rows=this.store.db.prepare('SELECT record FROM runs').all() as {record:string}[];
  for(const row of rows){const run=JSON.parse(row.record) as RunRecord;if(run.testing){delete run.testing;this.persist(run);}if(!liveStatuses.has(run.status))continue;
   const process=run.process&&ownsProcess(run.process)?run.process:this.findProcess(run.id);
   if(!process){run.status='interrupted';run.error={code:'PROCESS_MISSING',message:'原进程已退出，未完成业务需核对；不会自动恢复或重放'};this.persist(run);continue;}
   run.process=process;this.active.add(run.id);run.status='unresponsive';run.error={code:'ORIGINAL_PROCESS_ALIVE',message:'已找到原进程，需核验或明确停止；不会再启动一个进程'};
   if(process.kind==='java'&&run.origin)try{const response=await fetch(run.origin+'/workbench/application',{signal:AbortSignal.timeout(2000)});const data=await response.json() as any;if(response.ok&&data.runId===run.id){run.status='running';delete run.error;}}catch{}
   this.persist(run);
  }
 }
 private track<T>(pending:Promise<T>){this.requests.add(pending);void pending.then(()=>this.requests.delete(pending),()=>this.requests.delete(pending));return pending;}
 async close(){this.closed=true;await this.ready;for(const id of [...this.active]){const run=this.record(id);await this.stop(id,run.role);}await Promise.all(this.launches.values());await Promise.allSettled(this.requests);}
}
