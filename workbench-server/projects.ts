import {assemblyContract,contractIssues} from './contracts.js';
import Database from 'better-sqlite3';
import {execFileSync} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, existsSync, rmSync, openSync, closeSync, unlinkSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {Ajv} from 'ajv';

export type Role='platform'|'application';
export type Files=Record<string,string>;
export type Project={id:string;kind:'template'|'application';name:string;head:string;sourceReleaseId:string|null;createdAt:string};
export type Release={id:string;projectId:string;version:string;commit:string;digest:string;createdAt:string;checkId?:string|null};
export type Definition={schemaVersion:1;name:string;description:string;scope:{own:string[];delegated:string[];outside:string[]};skills:{id:string;file:string;operations:string[]}[];capabilities:Record<string,unknown>[];handoff:{enabled:boolean;target:string;unfinished:'ask'|'retain'|'discard';resume:'prompt'|'auto';maxTasks:2};connections:Record<string,string>;mapping:{balancePath:string}};
export class WorkbenchError extends Error {
  constructor(public code:string, message:string, public status=400){super(message);}
}
function fail(code:string,message:string,status=400):never{throw new WorkbenchError(code,message,status);}
const validateDefinition=new Ajv({allErrors:true}).compile({
  type:'object',required:['schemaVersion','name','description','scope','skills','capabilities','handoff','connections','mapping'],additionalProperties:false,
  properties:{
    schemaVersion:{const:1},name:{type:'string',minLength:1,maxLength:120},description:{type:'string',maxLength:12000},
    scope:{type:'object',required:['own','delegated','outside'],additionalProperties:false,properties:Object.fromEntries(['own','delegated','outside'].map(k=>[k,{type:'array',maxItems:100,items:{type:'string',maxLength:2000}}]))},
    skills:{type:'array',maxItems:30,items:{type:'object',required:['id','file','operations'],additionalProperties:false,properties:{id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$'},file:{type:'string'},operations:{type:'array',items:{type:'string'}}}}},
    capabilities:{type:'array',maxItems:50,items:{type:'object'}},
    handoff:{type:'object',required:['enabled','target','unfinished','resume','maxTasks'],additionalProperties:false,properties:{enabled:{type:'boolean'},target:{type:'string'},unfinished:{enum:['ask','retain','discard']},resume:{enum:['prompt','auto']},maxTasks:{const:2}}},
    connections:{type:'object',additionalProperties:{type:'string'}},mapping:{type:'object',required:['balancePath'],additionalProperties:false,properties:{balancePath:{type:'string',pattern:'^[a-zA-Z][a-zA-Z0-9_.]*$'}}}
  }
});
export function applicationEditable(name:string){return name==='runtime-settings.json'||name==='application.json'||name==='instructions.md'||name==='README.md'||['skills/','adapters/','tests/','src/main/java/com/openjiuwen/workbench/app/'].some(prefix=>name.startsWith(prefix));}
const forbidden=/(^|\/)(\.git|\.env(?:\..*)?|node_modules|target)(\/|$)/;
export function validatePath(path:string){
  if(!path || path.length>500 || path.startsWith('/') || /[\\\x00-\x1f:]/.test(path) || path.split('/').some(p=>p==='..'||p==='.'||!p) || forbidden.test(path))fail('INVALID_PATH','文件路径不在工程允许范围内');
}
export function validateFiles(files:Files):Definition{
  for(const [name,content] of Object.entries(files)){validatePath(name);if(Buffer.byteLength(content)>2_000_000)fail('FILE_TOO_LARGE','单文件不能超过 2 MB',413);if(/sk-[a-zA-Z0-9_-]{20,}/.test(content))fail('SECRET_IN_PROJECT','工程包含疑似模型 Key，请使用本机私有配置');}
  if(files['runtime-settings.json']){let runtime:any;try{runtime=JSON.parse(files['runtime-settings.json']);}catch{fail('INVALID_RUNTIME_SETTINGS','运行配置引用须为JSON');}if(!runtime||Object.keys(runtime).some(k=>!['modelProfile','environmentId'].includes(k))||typeof runtime.modelProfile!=='string'||typeof runtime.environmentId!=='string'||!/^([a-z][a-z0-9_-]{0,39})$/.test(runtime.modelProfile)||!/^([a-z][a-z0-9_-]{0,39})$/.test(runtime.environmentId))fail('INVALID_RUNTIME_SETTINGS','运行配置仅允许modelProfile和environmentId引用');}
  let spec:Definition;
  try{spec=JSON.parse(files['application.json']??'');}catch{fail('INVALID_DEFINITION','application.json 必须是有效 JSON');}
  if(!validateDefinition(spec))fail('INVALID_DEFINITION','应用配置不满足 Schema：'+new Ajv().errorsText(validateDefinition.errors));
  if(!files['instructions.md']?.trim())fail('INVALID_DEFINITION','应用指令不能为空');
  const ids=new Set<string>();
  for(const skill of spec.skills){validatePath(skill.file);if(!skill.file.startsWith('skills/')||!files[skill.file]?.trim()||ids.has(skill.id))fail('INVALID_DEFINITION','Skill 引用失效或 ID 重复');ids.add(skill.id);}
  return spec;
}
export class ProjectStore{
  readonly db:Database.Database;
  readonly root:string;
  readonly workspaceId:string;
  private readonly lockToken=randomUUID();
  private lockFile:string;
  private snapshotCache=new Map<string,{files:Files;bytes:number}>();
  private snapshotCacheBytes=0;
  private contracts=new Map<string,ReturnType<typeof assemblyContract>>();
  constructor(root:string){
    this.root=resolve(root);mkdirSync(join(this.root,'projects'),{recursive:true});mkdirSync(join(this.root,'changes'),{recursive:true});
    this.lockFile=join(this.root,'workbench.lock');
    const start=(pid:number)=>{try{const stat=readFileSync(`/proc/${pid}/stat`,'utf8');return stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];}catch{return undefined;}};
    if(existsSync(this.lockFile)){
      if(lstatSync(this.lockFile).isSymbolicLink())fail('DATA_DIR_IN_USE','工作目录锁归属不明，请先核对',409);
      let owner:{kind:string;pid:number;started:string;token:string};try{owner=JSON.parse(readFileSync(this.lockFile,'utf8'));}catch{fail('DATA_DIR_IN_USE','工作目录锁损坏，请先核对',409);}
      if(owner.kind!=='workbench-data'||!Number.isInteger(owner.pid)||owner.pid<=0||!/^\d+$/.test(owner.started)||typeof owner.token!=='string'||start(owner.pid)===owner.started)fail('DATA_DIR_IN_USE','已有工作台使用该数据目录；请使用原服务',409);
      unlinkSync(this.lockFile);
    }
    let lock:number;try{lock=openSync(this.lockFile,'wx',0o600);}catch{fail('DATA_DIR_IN_USE','已有工作台正在打开该数据目录',409);}
    try{writeFileSync(lock,JSON.stringify({kind:'workbench-data',pid:process.pid,started:start(process.pid),token:this.lockToken}));}finally{closeSync(lock);}
    this.db=new Database(join(this.root,'index.sqlite'));this.db.pragma('journal_mode = WAL');this.db.pragma('foreign_keys = ON');
    this.db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,head TEXT NOT NULL,sourceReleaseId TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,version TEXT NOT NULL,"commit" TEXT NOT NULL,digest TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(projectId,version),UNIQUE(projectId,"commit"));`);
    if(!(this.db.prepare('PRAGMA table_info(releases)').all() as {name:string}[]).some(c=>c.name==='checkId'))this.db.exec('ALTER TABLE releases ADD COLUMN checkId TEXT');
    this.db.exec('CREATE TABLE IF NOT EXISTS design_checks(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,record TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS workbench_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    this.db.prepare('INSERT OR IGNORE INTO workbench_metadata VALUES(?,?)').run('workspace-id',randomUUID());
    this.workspaceId=(this.db.prepare('SELECT value FROM workbench_metadata WHERE key=?').get('workspace-id') as {value:string}).value;
  }
  close(){if(this.db.open)this.db.close();try{const lock=JSON.parse(readFileSync(this.lockFile,'utf8'));if(lock.token===this.lockToken)unlinkSync(this.lockFile);}catch{}}
  path(id:string){if(!/^[a-z0-9-]{1,80}$/.test(id))fail('NOT_FOUND','工程不存在',404);return join(this.root,'projects',id);}
  git(id:string,args:string[]){return execFileSync('git',['-C',this.path(id),...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15_000}).trim();}
  get(id:string,role:Role):Project{
    const p=this.db.prepare('SELECT * FROM projects WHERE id=?').get(id) as Project|undefined;
    if(!p)fail('NOT_FOUND','工程不存在',404);
    if(p.kind==='template'&&role!=='platform')fail('FORBIDDEN','请使用已发行模板创建应用',403);
    return p;
  }
  list(role:Role):Project[]{return this.db.prepare(role==='platform'?'SELECT * FROM projects ORDER BY createdAt':'SELECT * FROM projects WHERE kind=\'application\' ORDER BY createdAt').all() as Project[];}
  listReleases():Release[]{return this.db.prepare('SELECT * FROM releases ORDER BY createdAt').all() as Release[];}
  release(id:string){const r=this.db.prepare('SELECT * FROM releases WHERE id=?').get(id) as Release|undefined;if(!r)fail('NOT_FOUND','模板版本不存在',404);return r;}
  private init(id:string,kind:Project['kind'],name:string,files:Files,sourceReleaseId:string|null){
    validateFiles(files);const path=this.path(id);mkdirSync(path,{recursive:true});mkdirSync(join(path,'skills'),{recursive:true});
    for(const [f,content]of Object.entries(files)){mkdirSync(dirname(join(path,f)),{recursive:true});writeFileSync(join(path,f),content);}
    this.git(id,['init','-b','main']);this.git(id,['config','user.name','Agent Workbench']);this.git(id,['config','user.email','workbench@localhost']);this.git(id,['config','core.hooksPath','/dev/null']);this.git(id,['config','commit.gpgsign','false']);
    this.git(id,['add','-f','--',...Object.keys(files)]);this.git(id,['commit','-m','Create '+kind+' from fixed template']);const head=this.git(id,['rev-parse','HEAD']);
    const p:Project={id,kind,name,head,sourceReleaseId,createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO projects VALUES(@id,@kind,@name,@head,@sourceReleaseId,@createdAt)').run(p);return p;
  }
  seedTemplate(files:Files,identity={id:'moa-platform',name:'MOA 开发模板'}){if(!/^[a-z][a-z0-9-]{0,63}$/.test(identity.id))fail('INVALID_TEMPLATE_ID','模板标识无效');const existing=this.db.prepare('SELECT * FROM projects WHERE id=?').get(identity.id) as Project|undefined;if(existing&&existing.kind!=='template')fail('INVALID_TEMPLATE_ID','模板标识已占用');return existing??this.init(identity.id,'template',identity.name,files,null);}
  family(id:string,role:Role,commit?:string):'moa'|'deepagent'{this.get(id,role);try{const text=commit?this.git(id,['show',commit+':template.json']):readFileSync(join(this.path(id),'template.json'),'utf8');return JSON.parse(text).family==='deepagent'?'deepagent':'moa';}catch{return 'moa';}}
  files(id:string,role:Role):Files{
    this.get(id,role);const root=this.path(id);const files:Files={};
    const walk=(directory:string,prefix='')=>{
      for(const entry of readdirSync(directory,{withFileTypes:true})){
        if(!prefix&&entry.name==='.git')continue;
        const name=prefix+entry.name;validatePath(name);const target=join(directory,entry.name);const stat=lstatSync(target);
        if(stat.isSymbolicLink())fail('INVALID_PATH','工程不能包含符号链接');
        if(entry.isDirectory())walk(target,name+'/');else if(entry.isFile()){if(stat.size>2_000_000)fail('FILE_TOO_LARGE','单文件不能超过 2 MB',413);files[name]=readFileSync(target,'utf8');}
      }
    };walk(root);return files;
  }
  contract(id:string,role:Role){const p=this.get(id,role);const key=p.sourceReleaseId??p.id+':'+p.head;const cached=this.contracts.get(key);if(cached)return cached;const source=p.sourceReleaseId?this.release(p.sourceReleaseId):null;const value=assemblyContract(source?this.snapshot(source.projectId,source.commit):this.snapshot(id,p.head));if(this.contracts.size>=128)this.contracts.delete(this.contracts.keys().next().value!);this.contracts.set(key,value);return value;}
  canEdit(id:string,role:Role,name:string){const p=this.get(id,role);if(p.kind==='template')return role==='platform';if(role!=='application'||!applicationEditable(name))return false;const prefixes=this.contract(id,role).editablePrefixes;return !prefixes||prefixes.some((prefix:string)=>prefix.endsWith('/')?name.startsWith(prefix):name===prefix);}
  definition(id:string,role:Role){return validateFiles(this.files(id,role));}
  snapshot(id:string,commit:string):Files{
    const p=this.get(id,'platform');if(!/^[a-f0-9]{40}$/.test(commit))fail('REVISION_CONFLICT','提交无效',409);
    // Only commits reachable from this project may supply content.
    try{this.git(p.id,['merge-base','--is-ancestor',commit,'HEAD']);}catch{fail('REVISION_CONFLICT','提交不属于当前工程',409);}
    const cacheKey=id+':'+commit,cached=this.snapshotCache.get(cacheKey);if(cached){this.snapshotCache.delete(cacheKey);this.snapshotCache.set(cacheKey,cached);return {...cached.files};}
    const names=this.git(id,['ls-tree','-r','--name-only','-z',commit]).split('\0').filter(Boolean);const files:Files={};
    for(const name of names){validatePath(name);const mode=this.git(id,['ls-tree',commit,'--',name]).split(' ')[0];if(mode==='120000')fail('INVALID_PATH','版本包含符号链接');files[name]=execFileSync('git',['-C',this.path(id),'show',`${commit}:${name}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:3_000_000,timeout:15_000});}
    validateFiles(files);const bytes=Object.entries(files).reduce((total,[path,value])=>total+Buffer.byteLength(path)+Buffer.byteLength(value),0);if(bytes<=16_000_000){while(this.snapshotCache.size&&(this.snapshotCacheBytes+bytes>16_000_000||this.snapshotCache.size>=64)){const oldest=this.snapshotCache.keys().next().value!,entry=this.snapshotCache.get(oldest)!;this.snapshotCacheBytes-=entry.bytes;this.snapshotCache.delete(oldest);}this.snapshotCache.set(cacheKey,{files:{...files},bytes});this.snapshotCacheBytes+=bytes;}return files;
  }
  save(id:string,role:Role,baseHead:string,changes:Record<string,string|null>,message='Save reviewed workbench revision'):Project{
    const p=this.get(id,role);if((p.kind==='template')!==(role==='platform'))fail('FORBIDDEN','当前身份不能修改该工程',403);
    if(p.head!==baseHead||this.git(id,['rev-parse','HEAD'])!==baseHead)fail('REVISION_CONFLICT','工程已更新，请刷新后审阅差异',409);
    if(!changes||!Object.keys(changes).length)fail('EMPTY_CHANGE','没有待保存变更');
    const files=this.files(id,role);
    for(const [name,content]of Object.entries(changes)){
      validatePath(name);if(role==='application'&&!this.canEdit(id,role,name))fail('FORBIDDEN_PATH','此文件是模板固定部分；请在开放的配置、Skill 或适配代码中修改',403);
      if(content!==null&&typeof content!=='string')fail('INVALID_CONTENT','文件内容必须是文本');
      if(content===null)delete files[name];else files[name]=content;
    }
    const spec=validateFiles(files);
    if(p.kind==='application'&&p.sourceReleaseId){const r=this.release(p.sourceReleaseId);const problems=contractIssues(files,this.snapshot(r.projectId,r.commit));if(problems.length)fail('ASSEMBLY_CONTRACT',problems.join('；'));}
    if(this.git(id,['status','--porcelain']))fail('UNSAVED_EXTERNAL_CHANGE','存在工作台以外修改，请先核对',409);
    const worktree=join(this.root,'changes',randomUUID());let commit:string|undefined;
    const run=(args:string[])=>execFileSync('git',['-C',worktree,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15_000}).trim();
    try{
      this.git(id,['worktree','add','--detach',worktree,baseHead]);
      for(const [name,content]of Object.entries(changes)){const dest=join(worktree,name);if(content===null){rmSync(dest,{force:true});}else{mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,content);}}
      run(['add','-f','--',...Object.keys(changes)]);
      if(!run(['diff','--cached','--name-only']))return p;
      run(['commit','-m',message]);commit=run(['rev-parse','HEAD']);
      this.git(id,['merge','--ff-only',commit]);
      this.db.prepare('UPDATE projects SET head=?,name=? WHERE id=?').run(commit,p.kind==='application'?spec.name:p.name,id);
      return this.get(id,role);
    }finally{try{this.git(id,['worktree','remove','--force',worktree]);}catch{if(existsSync(worktree))rmSync(worktree,{recursive:true,force:true});}}
  }
  publish(id:string,role:Role,version:string):Release{
    if(role!=='platform')fail('FORBIDDEN','仅平台开发者可发行模板',403);const p=this.get(id,role);
    if(p.kind!=='template')fail('FORBIDDEN','仅模板工程可发行',403);
    if(!/^\d+\.\d+\.\d+$/.test(version))fail('INVALID_VERSION','版本格式须为 x.y.z');
    if(this.db.prepare('SELECT 1 FROM releases WHERE projectId=? AND version=?').get(id,version))fail('RELEASE_EXISTS','版本号已经发行',409);
    if(this.db.prepare('SELECT 1 FROM releases WHERE projectId=? AND "commit"=?').get(id,p.head))fail('ALREADY_PUBLISHED','同一工程修订不能重复发行',409);
    if(this.git(id,['status','--porcelain']))fail('UNSAVED_EXTERNAL_CHANGE','模板含未保存文件',409);
    const inspection=this.db.prepare('SELECT id,record FROM design_checks WHERE projectId=? ORDER BY rowid DESC').all(id) as {id:string;record:string}[];
    const check=inspection.find(r=>JSON.parse(r.record).head===p.head);if(!check||!JSON.parse(check.record).passed)fail('CHECK_REQUIRED','发行前须对当前保存版本完成结构检查，失败或旧版本报告不能发行',409);
    const problems=contractIssues(this.snapshot(id,p.head),this.snapshot(id,p.head));if(problems.length)fail('ASSEMBLY_CONTRACT',problems.join('；'));
    const files=this.snapshot(id,p.head);const digest=createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
    const release:Release={id:randomUUID(),projectId:id,version,commit:p.head,digest,createdAt:new Date().toISOString(),checkId:check.id};
    this.db.prepare('INSERT INTO releases(id,projectId,version,"commit",digest,createdAt,checkId) VALUES(@id,@projectId,@version,@commit,@digest,@createdAt,@checkId)').run(release);return release;
  }
  createApplication(releaseId:string,name:string,role:Role,goal:string=''):Project{
    if(role!=='application')fail('FORBIDDEN','请切换到应用开发者创建应用',403);if(!name?.trim()||name.length>120)fail('INVALID_NAME','请输入 1～120 字的应用名称');
    if(typeof goal!=='string'||goal.length>12000)fail('INVALID_GOAL','业务目标须为不超过 12000 字的文本');
    const release=this.release(releaseId);const files=this.snapshot(release.projectId,release.commit);const spec=validateFiles(files);spec.name=name.trim();if(goal.trim())spec.description=goal.trim();files['application.json']=JSON.stringify(spec,null,2)+'\n';
    return this.init(randomUUID(),'application',name.trim(),files,releaseId);
  }
}
