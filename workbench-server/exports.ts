import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdirSync,readFileSync,writeFileSync,lstatSync,realpathSync,existsSync,rmSync,statSync,readdirSync} from 'node:fs';
import {copyFile} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProjectStore,WorkbenchError,validatePath,type Files,type Role} from './projects.js';
import {RunManager,type RunRecord} from './runs.js';
const execute=promisify(execFile),hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const MAX_FILE=400_000_000,FORMAT_VERSION=3;
export type ExportKind='application'|'source';
export type ExportRecord={formatVersion:number;id:string;projectId:string;runId:string;role:Role;head:string;sourceReleaseId:string|null;createdAt:string;engine:string;manifestSha256:string;verification:{build:'maven-package-passed'|'fixture';standalone:'not-verified';business:'not-verified'};artifacts:Record<ExportKind,{filename:string;sha256:string;bytes:number}>};
function fail(code:string,message:string,status=409):never{throw new WorkbenchError(code,message,status);}
async function digestFile(path:string){const stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX_FILE)fail('EXPORT_FILE_INVALID','文件类型或大小不符合交付范围');const digest=createHash('sha256');for await(const part of createReadStream(path))digest.update(part);return digest.digest('hex');}
const reserved=new Set(['manifest.json','SHA256SUMS','verify.sh','start.sh','build.sh','runtime.env.example','DELIVERY.md']);
const verifyScript=`#!/bin/sh
set -eu
package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$package_root"
sha256sum --check --quiet SHA256SUMS
`;
const shellLiteral=(value:string)=>"'"+value.replaceAll("'", "'\\''")+"'";
function startScript(kind:ExportKind,fixture:boolean,configuration?:RunRecord['configuration']){return `#!/bin/sh
set -eu
package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$package_root/verify.sh"
${fixture?'echo "此为 contract fixture 测试包，不能作为真实 Java 服务启动。" >&2\nexit 1\n':''}export MODEL_API_KEY="\${MODEL_API_KEY:-\${DEEPSEEK_API_KEY:-}}"
: "\${MODEL_API_KEY:?请通过外部环境提供 MODEL_API_KEY，不要写进交付包}"
export DEEPSEEK_API_KEY="$MODEL_API_KEY"
default_model=${shellLiteral(configuration?.model??'deepseek-flash')}
default_base_url=${shellLiteral(configuration?.baseUrl??'https://api.deepseek.com')}
export MODEL_NAME="\${MODEL_NAME:-\${DEEPSEEK_MODEL:-$default_model}}"
export DEEPSEEK_MODEL="$MODEL_NAME"
export WORKBENCH_APP_DIR="$package_root${kind==='application'?'/assets':''}"
export WORKBENCH_STATE_DIR="\${WORKBENCH_STATE_DIR:-$package_root/.runtime-state}"
export MODEL_BASE_URL="\${MODEL_BASE_URL:-\${DEEPSEEK_BASE_URL:-$default_base_url}}"
export DEEPSEEK_BASE_URL="$MODEL_BASE_URL"
${kind==='application'?'application_jar="$package_root/application.jar"':'set -- "$package_root"/target/*.jar\n[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "请先构建且仅保留一个可执行 JAR。" >&2; exit 1; }\napplication_jar=$1'}
exec "\${JAVA_BIN:-java}" -Xmx768m -jar "$application_jar" --server.address=127.0.0.1 --server.port="\${APP_PORT:-8780}"
`;}
const buildScript=`#!/bin/sh
set -eu
package_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$package_root/verify.sh"
cd "$package_root"
exec "\${MAVEN_BIN:-mvn}" -B -ntp package "$@"
`;
export class ExportManager{
 private execution?:Promise<ExportRecord>;private closed=false;
 constructor(private store:ProjectStore,private runs:RunManager){
  const schema="(id TEXT PRIMARY KEY,projectId TEXT NOT NULL,runId TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,formatVersion INTEGER NOT NULL,record TEXT NOT NULL,UNIQUE(projectId,runId,formatVersion))";
  store.db.exec('CREATE TABLE IF NOT EXISTS exports '+schema);
  const columns=store.db.prepare('PRAGMA table_info(exports)').all() as {name:string}[];
  if(!columns.some(c=>c.name==='formatVersion'))store.db.transaction(()=>{
   store.db.exec('CREATE TABLE exports_format_migration '+schema);
   store.db.exec('INSERT INTO exports_format_migration SELECT id,projectId,runId,1,record FROM exports');
   store.db.exec('DROP TABLE exports');store.db.exec('ALTER TABLE exports_format_migration RENAME TO exports');
  })();
 }

 directory(id:string){if(!/^[a-f0-9-]{36}$/.test(id))fail('NOT_FOUND','交付包不存在',404);return join(this.store.root,'exports',id);}
 get(id:string,role:Role){const row=this.store.db.prepare('SELECT record,formatVersion FROM exports WHERE id=?').get(id) as {record:string;formatVersion:number}|undefined;if(!row)fail('NOT_FOUND','交付包不存在',404);const record={...JSON.parse(row.record),formatVersion:row.formatVersion} as ExportRecord;this.store.get(record.projectId,role);return record;}
 list(id:string,role:Role){this.store.get(id,role);return (this.store.db.prepare('SELECT id FROM exports WHERE projectId=? ORDER BY rowid DESC').all(id) as {id:string}[]).map(row=>this.get(row.id,role));}
 private owned(record:ExportRecord){const root=this.directory(record.id);if(!existsSync(root)||lstatSync(root).isSymbolicLink()||realpathSync(root)!==resolve(root))fail('EXPORT_OWNERSHIP_MISMATCH','交付目录归属不匹配');const owner=JSON.parse(readFileSync(join(root,'owner.json'),'utf8'));if(owner.kind!=='workbench-export'||owner.id!==record.id||owner.projectId!==record.projectId)fail('EXPORT_OWNERSHIP_MISMATCH','交付目录归属不匹配');return root;}
 private owner(record:ExportRecord,role:Role){if(record.role!==role)fail('FORBIDDEN','请使用导出应用的身份操作',403);}
 async manifest(id:string,role:Role){const record=this.get(id,role),path=join(this.owned(record),'manifest.json');if(await digestFile(path)!==record.manifestSha256)fail('EXPORT_CHANGED','交付清单已变化，不能作为原包使用');return JSON.parse(readFileSync(path,'utf8'));}
 async file(id:string,role:Role,kind:string){if(!['application','source'].includes(kind))fail('NOT_FOUND','交付文件不存在',404);const record=this.get(id,role),artifact=record.artifacts[kind as ExportKind],path=join(this.owned(record),artifact.filename);if(lstatSync(path).size!==artifact.bytes||await digestFile(path)!==artifact.sha256)fail('EXPORT_CHANGED','交付文件已变化，请保留记录并核对');return {path,artifact};}
 async create(projectId:string,role:Role,runId:string){
  if(this.closed)fail('WORKBENCH_STOPPED','工作台正在关闭');await this.runs.ready;if(this.closed)fail('WORKBENCH_STOPPED','工作台正在关闭');
  if(typeof runId!=='string'||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(runId))fail('INVALID_RUN','请选择一个已有运行',400);
  const project=this.store.get(projectId,role);if(project.kind!=='application'||role!=='application')fail('FORBIDDEN','应用导出由应用开发者发起',403);
  const run=this.runs.get(runId,role);if(run.projectId!==projectId||run.role!==role)fail('RUN_NOT_OWNED','运行不属于当前应用',404);
  const existing=(this.store.db.prepare('SELECT id FROM exports WHERE projectId=? AND runId=? AND formatVersion=?').get(projectId,runId,FORMAT_VERSION) as {id:string}|undefined);if(existing){const record=this.get(existing.id,role);await this.manifest(record.id,role);for(const kind of ['application','source'])await this.file(record.id,role,kind);return {record,reused:true};}
  if(this.execution)fail('EXPORT_BUSY','已有交付打包正在进行，请等待原操作');
  if(!run.artifact||!run.origin||!['running','stopped','interrupted'].includes(run.status))fail('NO_BUILD_ARTIFACT','请选择已成功构建并启动过的运行；不会自动重新构建');
  const exportRoot=join(this.store.root,'exports');
  if((this.store.db.prepare('SELECT count(*) AS n FROM exports').get() as {n:number}).n>=8||existsSync(exportRoot)&&readdirSync(exportRoot).length>=8)fail('RETENTION_LIMIT','最多保留 8 份交付目录；请下载并清理历史包，未完成目录需先核对归属');
  const execution=this.prepare(run);this.execution=execution;try{return {record:await execution,reused:false};}finally{if(this.execution===execution)this.execution=undefined;}
 }
 private async prepare(run:RunRecord):Promise<ExportRecord>{
  const files=this.store.snapshot(run.projectId,run.head);if(Object.keys(files).length>2000||Object.values(files).reduce((sum,text)=>sum+Buffer.byteLength(text),0)>64_000_000)fail('EXPORT_SOURCE_LIMIT','源码文件数量或总大小超出本机 Demo 范围');
  for(const name of Object.keys(files))if(reserved.has(name)||/sk-[a-zA-Z0-9_-]{20,}/.test(name))fail('EXPORT_RESERVED_PATH','工程包含交付保留名称或疑似密钥文件名');
  const runRoot=this.runs.directory(run.id),owner=JSON.parse(readFileSync(join(runRoot,'owner.json'),'utf8'));
  if(realpathSync(runRoot)!==resolve(runRoot)||owner.kind!=='workbench-run'||owner.id!==run.id||owner.projectId!==run.projectId)fail('WORKSPACE_OWNERSHIP_MISMATCH','原运行目录归属不匹配');
  const source=JSON.parse(readFileSync(join(runRoot,'source.json'),'utf8')),hashes=Object.fromEntries(Object.entries(files).map(([name,text])=>[name,hash(text)]));
  if(source.head!==run.head||source.projectId!==run.projectId||Object.keys(source.files??{}).length!==Object.keys(files).length)fail('RUN_SOURCE_CHANGED','原运行源码清单已变化');
  for(const [name,digest]of Object.entries(hashes)){
   const path=join(runRoot,'project',name);if(source.files[name]!==digest||!existsSync(path)||lstatSync(path).isSymbolicLink()||realpathSync(path)!==resolve(path)||hash(readFileSync(path))!==digest)fail('RUN_SOURCE_CHANGED','原构建输入已变化，不能将旧 JAR 与新资产混合导出');
  }
  const jar=join(runRoot,run.artifact!.path);if(!realpathSync(jar).startsWith(resolve(runRoot,'project')+sep)||await digestFile(jar)!==run.artifact!.sha256)fail('ARTIFACT_CHANGED','原 JAR 摘要不一致，停止导出');
  const id=randomUUID(),root=this.directory(id),stage=join(root,'staging');mkdirSync(stage,{recursive:true});writeFileSync(join(root,'owner.json'),JSON.stringify({kind:'workbench-export',id,projectId:run.projectId}));
  try{
   const verification:ExportRecord['verification']={build:run.engine==='local-java'?'maven-package-passed':'fixture',standalone:'not-verified',business:'not-verified'};
   const spec=JSON.parse(files['application.json']);
   const manifest={schemaVersion:1,formatVersion:FORMAT_VERSION,purpose:'technical-export',exportId:id,projectId:run.projectId,runId:run.id,sourceHead:run.head,sourceReleaseId:run.sourceReleaseId,createdAt:new Date().toISOString(),engine:run.engine,verification,jar:{sha256:run.artifact!.sha256,bytes:run.artifact!.bytes},buildInputFiles:hashes,dependencyFiles:['pom.xml',...(files['runtime-source.json']?['runtime-source.json']:[])],runtime:{modelBaseline:run.configuration?.model??'not-recorded',executionConfiguration:run.configuration??null,configuration:'external environment; not exported from the workbench',assets:'application/assets or source root',state:'external WORKBENCH_STATE_DIR or package-local .runtime-state',connections:spec.connections,taskRecovery:files['template.json']&&JSON.parse(files['template.json']).family==='deepagent'?'single goal per conversation; workspace files persist in the owned run; no recovery after restart':'same process; current A plus B; no automatic recovery after restart'},exclusions:['.git','.opencode','.env.local','workbench database','runtime events and conversations','build workspace paths'],publication:'not-published'};
   const text=JSON.stringify(manifest,null,2)+'\n';writeFileSync(join(root,'manifest.json'),text);
   const artifacts={} as ExportRecord['artifacts'];
   for(const kind of ['application','source'] as ExportKind[]){
    const packageRoot=join(stage,kind);mkdirSync(packageRoot);
    const contents:Files={};
    for(const [name,content]of Object.entries(files)){
     if(kind==='source'){if(!name.startsWith('.opencode/'))contents[name]=content;}
     else if(name==='runtime-settings.json'||name==='application.json'||name==='instructions.md'||name==='template.json'||/^(skills|adapters|tests)\//.test(name))contents['assets/'+name]=content;
     else if(['LICENSE','Third_Party_Open_Source_Software_Notice.txt','runtime-source.json','SOURCE.md'].includes(name))contents[name]=content;
    }
    contents['manifest.json']=text;contents['verify.sh']=verifyScript;contents['start.sh']=startScript(kind,run.engine!=='local-java',run.configuration);if(kind==='source')contents['build.sh']=buildScript;
    contents['runtime.env.example']='# Inject MODEL_API_KEY externally. No private registry or key is included.\nMODEL_BASE_URL='+shellLiteral(run.configuration?.baseUrl??'https://api.deepseek.com')+'\nMODEL_NAME='+shellLiteral(run.configuration?.model??'deepseek-flash')+'\nAPP_PORT=8780\nOTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14318\n# runtime-settings.json records source references; standalone uses these external environment variables.\n';
    contents['DELIVERY.md']=this.instructions(kind,run.engine,files['template.json']&&JSON.parse(files['template.json']).family==='deepagent'?'deepagent':'moa');
    for(const [name,content]of Object.entries(contents)){validatePath(name);const path=join(packageRoot,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content,{mode:name.endsWith('.sh')?0o755:0o644});}
    const sums=Object.fromEntries(Object.entries(contents).map(([name,content])=>[name,hash(content)]));
    if(kind==='application'){
     const destination=join(packageRoot,'application.jar');await copyFile(jar,destination);if(await digestFile(destination)!==run.artifact!.sha256)fail('ARTIFACT_CHANGED','复制时 JAR 内容发生变化');sums['application.jar']=run.artifact!.sha256;
    }
    writeFileSync(join(packageRoot,'SHA256SUMS'),Object.entries(sums).sort(([a],[b])=>a.localeCompare(b)).map(([name,digest])=>digest+'  '+name+'\n').join(''));
    const filename=kind+'.tar.gz',archive=join(root,filename);
    // Epoch zero makes Maven resources treat absent target files as up to date; use the nonzero ZIP epoch.
    try{await execute('tar',['--sort=name','--mtime=@315532800','--owner=0','--group=0','--numeric-owner','-czf',archive,'-C',stage,kind],{timeout:90000,maxBuffer:1_000_000});}catch{fail('ARCHIVE_FAILED','交付打包未完成，请核对本机 tar 与磁盘空间');}
    artifacts[kind]={filename,sha256:await digestFile(archive),bytes:statSync(archive).size};rmSync(packageRoot,{recursive:true,force:true});
   }
   rmSync(stage,{recursive:true,force:true});
   const record:ExportRecord={formatVersion:FORMAT_VERSION,id,projectId:run.projectId,runId:run.id,role:run.role,head:run.head,sourceReleaseId:run.sourceReleaseId,createdAt:manifest.createdAt,engine:run.engine,verification,manifestSha256:hash(text),artifacts};
   this.store.db.prepare('INSERT INTO exports VALUES(?,?,?,?,?)').run(id,run.projectId,run.id,FORMAT_VERSION,JSON.stringify(record));return record;
  }catch(error){rmSync(root,{recursive:true,force:true});throw error;}
 }
 private instructions(kind:ExportKind,engine:string,family='moa'){if(family==='deepagent')return `# DeepAgent 固定版本技术交付包\n\n来源引擎：${engine}。导出不代表独立运行、业务验收或企业发布已通过。${engine==='local-java'?'':'这是契约测试包，start.sh 不允许把它作为真实 Java 服务启动。'}\n\n需要 Linux/WSL、sh、sha256sum、Java17+；源码包还需要 Maven 和 POM 声明的 Core/Runtime 依赖。DeepAgent文件工具不依赖Python或业务Mock。本模板未接入OTel。\n\n模型通过 MODEL_API_KEY / MODEL_NAME / MODEL_BASE_URL（兼容DEEPSEEK_*）从外部注入，不能把Key写入包。资产位于${kind==='application'?'assets/':'源码根目录/'}；本包不包含开发会话、运行材料或工作台数据。\n\n解压进入${kind}/后执行 sh verify.sh。${kind==='source'?'执行 sh build.sh，生成唯一的target/*.jar；重建二进制需重新核验。':''}配置模型后执行 sh start.sh，APP_PORT默认8780，WORKBENCH_STATE_DIR应为独立目录。\n\nGET /workbench/application核对服务；先POST /workbench/conversations取得conversationId，再POST /workbench/messages，JSON包含conversationId和query。同一conversationId用于增量修改；响应包含brief.md内容与读写/核实事件。只处理单一业务目标，没有MOA的A/B接管或reply/decide/resume/receipt接口。\n\n生成文件位于运行状态目录的artifacts/<conversationId>/brief.md；它们不属于源码包或已发行制品。重启不恢复Agent执行会话。本包不替代业务验收和企业CI/CD。\n`;return `# 固定版本技术交付包\n\n来源引擎：${engine}。本包只表明固定版本已导出；独立运行、业务验收、CI 和发布均未由导出操作验证。${engine==='local-java'?'':'这是契约测试包，start.sh 会拒绝把它当作真实 Java 服务启动。'}\n\n## 环境\n\n使用 Linux/WSL、sh、GNU tar、sha256sum、Java 17+。业务脚本使用 /usr/bin/python3。实际依赖以本包 POM、Runtime BOM 和 JAR 为准；本 Demo 基线为 Core 0.1.17/Runtime 0.1.4。${kind==='source'?'源码构建还需要 Maven，以及已在声明的 Maven 仓库安装的 Core/Runtime 依赖；包内不复制开发机 Maven 缓存。':''}\n\n模型 Key 通过外部 MODEL_API_KEY 注入，不写入文件或命令参数。MODEL_NAME 与 MODEL_BASE_URL 的默认值固定在本次导出 start.sh/runtime.env.example 中，来自原运行记录；历史未记录时使用 deepseek-flash/https://api.deepseek.com 启动默认值而不冒充历史模型证据；保留 DEEPSEEK_API_KEY/DEEPSEEK_MODEL/DEEPSEEK_BASE_URL 兼容。仅支持 OpenAI 兼容接口，替换模型的工具调用行为须另验；旧 JAR 不因新环境变量自动升级。服务连接见 manifest.json 和 ${kind==='application'?'assets/':''}application.json；本机 Mock 地址需要在目标环境实际可达。本包不包含 Mock、工作台代理、OpenCode、数据库或运行事件。Jaeger OTLP HTTP 默认 http://127.0.0.1:14318，Trace 查看依赖独立 Jaeger。\n\n## 校验与启动\n\n解压后进入 ${kind}/，执行 sh verify.sh。${kind==='source'?'然后执行 sh build.sh（可用 MAVEN_BIN 指定 Maven），生成 target 下唯一可执行 JAR；重建后的 JAR 摘要需要重新记录，不能冒用原二进制验收。':''}在目标环境注入 Key 后，执行 sh start.sh。APP_PORT 默认 8780，监听 127.0.0.1；JAVA_BIN 可指定 Java。脚本显式设置资产目录，WORKBENCH_STATE_DIR 可指定独立目录。停止工作台/OpenCode后本包不需要它们存活，但仍需要模型、业务 HTTP/A2A 服务及本机 Python。\n\n健康/定义：GET http://127.0.0.1:8780/workbench/application。业务：POST /workbench/messages，JSON 为 {"query":"业务请求"}。原任务回复 POST /workbench/conversations/:id/reply，使用响应里的 taskId/token/answer；切换/复核/原键查单接口为 decide/resume/receipt。业务确认不能跳过。\n\n首期同进程最多 A→B，只恢复 A。重启不会自动恢复未完成会话；事件文件不等于 Core 检查点。start.sh 首先校验 SHA256SUMS；它检测已列文件的缺失或变化，不是数字签名。归档 SHA-256 从工作台导出记录另行取得，用于核对整个下载包。\n`;}
 async remove(id:string,role:Role){const record=this.get(id,role);this.owner(record,role);if(this.execution)fail('EXPORT_BUSY','请等待当前打包完成');const root=this.owned(record);this.store.db.transaction(()=>{this.store.db.prepare('DELETE FROM exports WHERE id=?').run(id);rmSync(root,{recursive:true,force:true});})();}
 async close(){this.closed=true;await this.execution?.catch(()=>{});}
}
