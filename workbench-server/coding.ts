import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readdirSync,readFileSync,lstatSync,existsSync,unlinkSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {consistencyPath,definitionInputs,parseConsistency,type ConsistencyAnalysis} from './consistency-contract.js';
import {ProjectStore,WorkbenchError,validateFiles,validatePath,applicationEditable,type Role,type Files} from './projects.js';
export type CodingEvidence={tool:string;status:string;input?:Record<string,unknown>};
export type CodingResult={sessionId:string;model:string;summary:string;evidence:CodingEvidence[]};
export interface CodingEngine{readonly kind?:string;answer?(directory:string,id:string,answers:string[][]):Promise<void>;run(input:{directory:string;prompt:string;skill:string;purpose?:'consistency';signal:AbortSignal;onEvent:(event:Record<string,unknown>)=>void}):Promise<CodingResult>;}
export type CodingJob={purpose?:'development'|'consistency';relatedCheckId?:string;analysis?:ConsistencyAnalysis;analysisOutput?:{raw:string;sha256:string};configuration?:{modelProfile:string;environmentId:string;model:string;origin:string;configured:boolean};id:string;projectId:string;role:Role;engineKind?:string;baseHead:string;prompt:string;status:'running'|'awaiting_input'|'awaiting_review'|'analysed'|'applied'|'rejected'|'failed'|'cancelled';createdAt:string;changes:Record<string,string|null>;summary?:string;sessionId?:string;model?:string;evidence:CodingEvidence[];events:Record<string,unknown>[];pendingQuestion?:{id:string;questions:Record<string,unknown>[]};error?:{code:string;message:string};appliedHead?:string};
function worktreeFiles(root:string):Files{
 const files:Files={};
 function visit(dir:string,prefix=''){for(const entry of readdirSync(dir,{withFileTypes:true})){
  if(!prefix&&entry.name==='.git')continue;
  // OpenCode installs its own local provider dependencies. They are execution cache, not application content.
  // Keep this exact list independent of editable ignore rules; all other paths are still validated.
  if(prefix==='.opencode/'&&['node_modules','package.json','package-lock.json','bun.lock'].includes(entry.name))continue;
  const name=prefix+entry.name;validatePath(name);const file=join(dir,entry.name);const stat=lstatSync(file);
  if(stat.isSymbolicLink())throw new WorkbenchError('INVALID_PATH','助手变更包含符号链接');
  if(entry.isDirectory())visit(file,name+'/');else{if(stat.size>2_000_000)throw new WorkbenchError('FILE_TOO_LARGE','助手文件超过 2 MB');files[name]=readFileSync(file,'utf8');}
 }}visit(root);return files;
}
export class CodingJobs{
 private active?:string;private closed=false;
 private executions=new Map<string,Promise<void>>();
 private controllers=new Map<string,AbortController>();
 constructor(private store:ProjectStore,private engine:CodingEngine){
  store.db.exec('CREATE TABLE IF NOT EXISTS coding_jobs(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,record TEXT NOT NULL)');
  // A restarted control service must not silently run or re-apply an old generation.
  for(const row of store.db.prepare('SELECT record FROM coding_jobs').all() as {record:string}[]){const j=JSON.parse(row.record) as CodingJob;if(j.status==='running'||j.status==='awaiting_input'){j.status='failed';j.error={code:'INTERRUPTED',message:'工作台重启中断了助手任务；原记录和副本保留，请核对后重新发起'};this.persist(j);}}
 }
 private persist(job:CodingJob){this.store.db.prepare('INSERT INTO coding_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(job.id,job.projectId,JSON.stringify(job));}
 get(id:string,role:Role){const row=this.store.db.prepare('SELECT record FROM coding_jobs WHERE id=?').get(id) as {record:string}|undefined;if(!row)throw new WorkbenchError('NOT_FOUND','助手任务不存在',404);const job=JSON.parse(row.record) as CodingJob;this.store.get(job.projectId,role);return job;}
 list(projectId:string,role:Role){this.store.get(projectId,role);return (this.store.db.prepare('SELECT record FROM coding_jobs WHERE projectId=? ORDER BY rowid DESC LIMIT 50').all(projectId) as {record:string}[]).map(row=>JSON.parse(row.record) as CodingJob);}
 review(id:string,role:Role){
  const job=this.get(id,role),project=this.store.get(job.projectId,role),names=Object.keys(job.changes);
  const base=names.length?this.store.snapshot(job.projectId,job.baseHead):{};
  return {job,head:project.head,stale:project.head!==job.baseHead,before:Object.fromEntries(names.map(name=>[name,base[name]??null]))};
 }
 private owner(job:CodingJob,role:Role){if(job.role!==role)throw new WorkbenchError('FORBIDDEN','请使用发起任务的身份审阅',403);}
 async start(projectId:string,role:Role,prompt:string,context:{purpose?:'consistency';relatedCheckId?:string}={}){
  if(this.closed)throw new WorkbenchError('WORKBENCH_STOPPED','工作台正在关闭',503);
  const project=this.store.get(projectId,role);if((project.kind==='template')!==(role==='platform'))throw new WorkbenchError('FORBIDDEN','当前身份不能修改该工程',403);
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>16000)throw new WorkbenchError('INVALID_PROMPT','请输入 1～16000 字的开发需求');
  if(this.active)throw new WorkbenchError('ENGINE_BUSY','已有编码任务正在执行，请查看原任务',409);
  const count=(this.store.db.prepare('SELECT count(*) AS count FROM coding_jobs WHERE projectId=?').get(projectId) as {count:number}).count;
  if(count>=50)throw new WorkbenchError('RETENTION_LIMIT','本工程已达 50 份助手记录上限，请先归档旧任务',409);
  const job:CodingJob={...context,id:randomUUID(),projectId,role,engineKind:this.engine.kind??'unspecified',baseHead:project.head,prompt,status:'running',createdAt:new Date().toISOString(),changes:{},evidence:[],events:[]};
  const directory=join(this.store.root,'jobs',job.id,'workspace');mkdirSync(join(this.store.root,'jobs',job.id),{recursive:true});
  this.store.git(projectId,['worktree','add','--detach',directory,project.head]);
  // A user-authored or old report is input data, never proof of a fresh semantic analysis.
  if(context.purpose==='consistency'&&existsSync(join(directory,consistencyPath)))unlinkSync(join(directory,consistencyPath));
  this.active=job.id;const controller=new AbortController();this.controllers.set(job.id,controller);this.persist(job);
  const family=this.store.family(projectId,role);const skill=family+'-'+(role==='platform'?'platform':'application')+'-development';
  const execution=this.engine.run({directory,prompt,skill,purpose:context.purpose,signal:controller.signal,onEvent:event=>{if(event.type==='configuration')job.configuration=event.configuration as CodingJob['configuration'];if(event.type==='question'){job.status='awaiting_input';job.pendingQuestion={id:String(event.id),questions:event.questions as Record<string,unknown>[]};}else if(event.type==='question_answered'){job.status='running';delete job.pendingQuestion;}if(job.events.length<200)job.events.push(event);this.persist(job);}}).then(result=>{
   Object.assign(job,result);if(controller.signal.aborted){job.status='cancelled';return;}
   if(!result.evidence.some(e=>e.tool==='skill'&&e.status==='completed'&&e.input?.name===skill))throw new WorkbenchError('SKILL_NOT_LOADED','未找到本角色范式 Skill 的实际读取证据，变更不进入审阅');
   const before=this.store.snapshot(projectId,job.baseHead),after=worktreeFiles(directory);validateFiles(after);
   for(const name of new Set([...Object.keys(before),...Object.keys(after)]))if(before[name]!==after[name]){
    // OpenCode creates this exact cache-control file during startup; never ignore custom or pre-existing rules.
    if(name==='.opencode/.gitignore'&&!Object.hasOwn(before,name)&&after[name]?.replace(/\r\n/g,'\n').replace(/\n$/,'')==='node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore')continue;
    if(job.purpose==='consistency'&&name!==consistencyPath)throw new WorkbenchError('CONSISTENCY_SOURCE_CHANGED','诊断任务只能写结构化报告，不能修改工程定义：'+name);
    if(role==='application'&&!applicationEditable(name))throw new WorkbenchError('FORBIDDEN_PATH','助手修改了模板固定文件：'+name);
    job.changes[name]=after[name]??null;
   }
   if(job.purpose==='consistency'){
    const source=definitionInputs(before),reads=new Set(result.evidence.filter(e=>e.tool==='read'&&e.status==='completed'&&typeof e.input?.filePath==='string').map(e=>relative(directory,resolve(directory,String(e.input!.filePath)))));
    if(source.required.some(p=>!reads.has(p)))throw new WorkbenchError('CONSISTENCY_SOURCE_NOT_READ','缺少业务范围、应用指令或业务Skill的实际读取证据');
    const raw=after[consistencyPath];if(typeof raw==='string'&&raw.length<=128000)job.analysisOutput={raw,sha256:createHash('sha256').update(raw).digest('hex')};job.analysis=parseConsistency(raw,source);job.changes={};job.status='analysed';this.clean(job);return;
   }
   if(!Object.keys(job.changes).length)throw new WorkbenchError('NO_CHANGES','助手未产生文件差异；原建议和记录保留');
   job.status='awaiting_review';
  }).catch(error=>{
   job.status=controller.signal.aborted?'cancelled':'failed';job.error=error instanceof WorkbenchError?{code:error.code,message:error.message}:{code:'CODING_FAILED',message:'编码执行未完成，请查看任务记录并核对模型/进程状态'};
  }).finally(()=>{this.persist(job);this.controllers.delete(job.id);this.executions.delete(job.id);if(this.active===job.id)this.active=undefined;});
  this.executions.set(job.id,execution);
  return job;
 }
 async apply(id:string,role:Role){
  const job=this.get(id,role);this.owner(job,role);if(job.status!=='awaiting_review')throw new WorkbenchError('INVALID_JOB_STATE','该任务当前不可应用',409);
  const saved=this.store.save(job.projectId,role,job.baseHead,job.changes);job.status='applied';job.appliedHead=saved.head;this.persist(job);this.clean(job);return job;
 }
 async reject(id:string,role:Role){const job=this.get(id,role);this.owner(job,role);if(job.status!=='awaiting_review')throw new WorkbenchError('INVALID_JOB_STATE','该任务当前不可拒绝',409);job.status='rejected';this.persist(job);this.clean(job);return job;}
 async cancel(id:string,role:Role){const job=this.get(id,role);this.owner(job,role);if(job.status!=='running'&&job.status!=='awaiting_input')throw new WorkbenchError('INVALID_JOB_STATE','任务已不在执行中，请查看原结果',409);this.controllers.get(id)?.abort();return job;}
 async answer(id:string,role:Role,questionId:string,answers:string[][]){
  const job=this.get(id,role);this.owner(job,role);if(job.status!=='awaiting_input'||job.pendingQuestion?.id!==questionId)throw new WorkbenchError('STALE_QUESTION','当前问题已经变化，请刷新原任务',409);
  if(!Array.isArray(answers)||!answers.every(a=>Array.isArray(a)&&a.every(v=>typeof v==='string'))||!this.engine.answer)throw new WorkbenchError('INVALID_ANSWER','请按问题顺序提供回答');
  await this.engine.answer(join(this.store.root,'jobs',job.id,'workspace'),questionId,answers);return this.get(id,role);
 }
 async close(){this.closed=true;for(const controller of this.controllers.values())controller.abort();await Promise.allSettled(this.executions.values());}
 private clean(job:CodingJob){const directory=join(this.store.root,'jobs',job.id,'workspace');if(existsSync(directory))this.store.git(job.projectId,['worktree','remove','--force',directory]);}
}
