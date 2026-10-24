import Database from 'better-sqlite3';
import {execFileSync} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, existsSync, rmSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {Ajv} from 'ajv';

export type Role='platform'|'application';
export type Files=Record<string,string>;
export type Project={id:string;kind:'template'|'application';name:string;head:string;sourceReleaseId:string|null;createdAt:string};
export type Release={id:string;projectId:string;version:string;commit:string;digest:string;createdAt:string};
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
export function applicationEditable(name:string){return name==='application.json'||name==='instructions.md'||name==='README.md'||['skills/','adapters/','tests/','src/main/java/com/openjiuwen/workbench/app/'].some(prefix=>name.startsWith(prefix));}
const forbidden=/(^|\/)(\.git|\.env(?:\..*)?|node_modules|target)(\/|$)/;
export function validatePath(path:string){
  if(!path || path.length>500 || path.startsWith('/') || /[\\\x00-\x1f:]/.test(path) || path.split('/').some(p=>p==='..'||p==='.'||!p) || forbidden.test(path))fail('INVALID_PATH','文件路径不在工程允许范围内');
}
export function validateFiles(files:Files):Definition{
  for(const [name,content] of Object.entries(files)){validatePath(name);if(Buffer.byteLength(content)>2_000_000)fail('FILE_TOO_LARGE','单文件不能超过 2 MB',413);}
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
  constructor(root:string){
    this.root=resolve(root);mkdirSync(join(this.root,'projects'),{recursive:true});mkdirSync(join(this.root,'changes'),{recursive:true});
    this.db=new Database(join(this.root,'index.sqlite'));this.db.pragma('journal_mode = WAL');this.db.pragma('foreign_keys = ON');
    this.db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,head TEXT NOT NULL,sourceReleaseId TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,version TEXT NOT NULL,"commit" TEXT NOT NULL,digest TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(projectId,version),UNIQUE(projectId,"commit"));`);
  }
  close(){if(this.db.open)this.db.close();}
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
    this.git(id,['add','--',...Object.keys(files)]);this.git(id,['commit','-m','Create '+kind+' from fixed template']);const head=this.git(id,['rev-parse','HEAD']);
    const p:Project={id,kind,name,head,sourceReleaseId,createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO projects VALUES(@id,@kind,@name,@head,@sourceReleaseId,@createdAt)').run(p);return p;
  }
  seedTemplate(files:Files){const existing=this.db.prepare("SELECT * FROM projects WHERE id='moa-platform'").get() as Project|undefined;return existing??this.init('moa-platform','template','MOA 开发模板',files,null);}
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
  definition(id:string,role:Role){return validateFiles(this.files(id,role));}
  snapshot(id:string,commit:string):Files{
    const p=this.get(id,'platform');if(!/^[a-f0-9]{40}$/.test(commit))fail('REVISION_CONFLICT','提交无效',409);
    // Only commits reachable from this project may supply content.
    try{this.git(p.id,['merge-base','--is-ancestor',commit,'HEAD']);}catch{fail('REVISION_CONFLICT','提交不属于当前工程',409);}
    const names=this.git(id,['ls-tree','-r','--name-only','-z',commit]).split('\0').filter(Boolean);const files:Files={};
    for(const name of names){validatePath(name);const mode=this.git(id,['ls-tree',commit,'--',name]).split(' ')[0];if(mode==='120000')fail('INVALID_PATH','版本包含符号链接');files[name]=execFileSync('git',['-C',this.path(id),'show',`${commit}:${name}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:3_000_000,timeout:15_000});}
    validateFiles(files);return files;
  }
  save(id:string,role:Role,baseHead:string,changes:Record<string,string|null>):Project{
    const p=this.get(id,role);if((p.kind==='template')!==(role==='platform'))fail('FORBIDDEN','当前身份不能修改该工程',403);
    if(p.head!==baseHead||this.git(id,['rev-parse','HEAD'])!==baseHead)fail('REVISION_CONFLICT','工程已更新，请刷新后审阅差异',409);
    if(!changes||!Object.keys(changes).length)fail('EMPTY_CHANGE','没有待保存变更');
    const files=this.files(id,role);
    for(const [name,content]of Object.entries(changes)){
      validatePath(name);if(role==='application'&&!applicationEditable(name))fail('FORBIDDEN_PATH','此文件是模板固定部分；请在开放的配置、Skill 或适配代码中修改',403);
      if(content!==null&&typeof content!=='string')fail('INVALID_CONTENT','文件内容必须是文本');
      if(content===null)delete files[name];else files[name]=content;
    }
    const spec=validateFiles(files);
    if(this.git(id,['status','--porcelain']))fail('UNSAVED_EXTERNAL_CHANGE','存在工作台以外修改，请先核对',409);
    const worktree=join(this.root,'changes',randomUUID());let commit:string|undefined;
    const run=(args:string[])=>execFileSync('git',['-C',worktree,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15_000}).trim();
    try{
      this.git(id,['worktree','add','--detach',worktree,baseHead]);
      for(const [name,content]of Object.entries(changes)){const dest=join(worktree,name);if(content===null){rmSync(dest,{force:true});}else{mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,content);}}
      run(['add','--',...Object.keys(changes)]);
      if(!run(['diff','--cached','--name-only']))return p;
      run(['commit','-m','Save reviewed workbench revision']);commit=run(['rev-parse','HEAD']);
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
    const files=this.snapshot(id,p.head);const digest=createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
    const release:Release={id:randomUUID(),projectId:id,version,commit:p.head,digest,createdAt:new Date().toISOString()};
    this.db.prepare('INSERT INTO releases VALUES(@id,@projectId,@version,@commit,@digest,@createdAt)').run(release);return release;
  }
  createApplication(releaseId:string,name:string,role:Role):Project{
    if(role!=='application')fail('FORBIDDEN','请切换到应用开发者创建应用',403);if(!name?.trim()||name.length>120)fail('INVALID_NAME','请输入 1～120 字的应用名称');
    const release=this.release(releaseId);const files=this.snapshot(release.projectId,release.commit);const spec=validateFiles(files);spec.name=name.trim();files['application.json']=JSON.stringify(spec,null,2)+'\n';
    return this.init(randomUUID(),'application',name.trim(),files,releaseId);
  }
}
