import {createHash} from 'node:crypto';
import {validateFiles,type ProjectStore,type Files,type Role,type Release} from './projects.js';
import type {ReviewManager} from './reviews.js';
import type {CodingJobs} from './coding.js';
import type {RunManager} from './runs.js';
import type {ExportManager} from './exports.js';

/** All provenance comes from the release commit, never a later template worktree. */
export function templateMetadata(files:Files,commit:string){
 let manifest:Record<string,any>={};try{manifest=JSON.parse(files['template.json']??'{}');}catch{}
 const family=manifest.family==='deepagent'?'deepagent':'moa';
 const developmentSkills=Object.entries(files).filter(([path])=>/^\.opencode\/skills\/[^/]+\/SKILL\.md$/.test(path)).map(([path,text])=>({name:path.split('/')[2],path,digest:createHash('sha256').update(text).digest('hex')}));
 const dependencies=[...new Set([...(files['pom.xml']??'').matchAll(/<artifactId>(agent-core-java|agent-runtime-java|agent-service-app)<\/artifactId>\s*<version>([^<]+)<\/version>/g)].map(x=>x[1]+' '+x[2]))];
 return {family,title:typeof manifest.title==='string'?manifest.title:family==='deepagent'?'DeepAgent 独立业务模板':'MOA 开发模板',commit,
  purpose:family==='deepagent'?'处理独立业务目标，装配业务 Skill 和文件工具，交付材料或文件。':'处理业务请求，装配业务 Skill 与 Agent，支持两层任务转交和续办。',
  openCapabilities:manifest.openCapabilities??{skills:true,agent:true,handoff:true,execution:['SCRIPT','A2A'],note:'公共接线由平台维护；HTTP/MCP新增接入先作为待接线草稿。'},
  editable:Array.isArray(manifest.applicationEditablePrefixes)?manifest.applicationEditablePrefixes.filter((p:unknown)=>typeof p==='string'):['runtime-settings.json','application.json','instructions.md','README.md','skills/','adapters/','tests/','src/main/java/com/openjiuwen/workbench/app/'],
  prerequisites:family==='deepagent'?['Node.js 22+','Java 17+','Maven','Core Maven依赖','外部模型配置']:['Node.js 22+','Java 17+','Maven','Python 3','Core/Runtime Maven依赖','外部模型配置','按业务准备服务连接'],
  dependencies,developmentSkills,digest:createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))).digest('hex')};
}
export function releaseInfo(store:ProjectStore,r:Release){const files=store.snapshot(r.projectId,r.commit),metadata=templateMetadata(files,r.commit);let developmentMode='assembly';if(metadata.family==='deepagent'&&metadata.openCapabilities.skills!==true)developmentMode='legacy-trial';return {...r,templateName:metadata.title,family:metadata.family,developmentMode,metadata};}

export function projectJourney(store:ProjectStore,reviews:ReviewManager,jobs:CodingJobs,runs:RunManager,exports:ExportManager,id:string,role:Role){
 const project=store.get(id,role),definition=validateFiles(store.snapshot(id,project.head)),reports=reviews.list(id,role),check=reports.find(r=>r.head===project.head)??null;
 const run=runs.list(id,role).find(r=>r.head===project.head),delivery=exports.list(id,role).find(r=>r.head===project.head),candidate=reviews.candidates(id,role).find(r=>r.head===project.head);
 const coding=jobs.list(id,role).find(j=>j.baseHead===project.head&&['running','awaiting_input','awaiting_review'].includes(j.status));
 const release=store.listReleases().find(r=>r.projectId===id&&r.commit===project.head);
 const defined=definition.scope.own.length+definition.scope.delegated.length>0;
 let stage='NEEDS_CHECK',title='当前保存版本待检查',reason='保存版本尚无检查报告；旧检查不验证新修改。',next='checks',action='检查保存版本';
 if(project.kind==='template'&&release){stage='TEMPLATE_PUBLISHED';title='当前版本已发行';reason=`已发行 ${release.version}，应用仍按各自来源版本开发。`;next='release';action='查看发行版本';}
 else if(coding){stage='CODING';title=coding.status==='awaiting_review'?'修改建议待审阅':coding.status==='awaiting_input'?'Coding 助手等待澄清':'Coding 助手正在开发';reason='建议尚未应用到工程，请先核对原任务。';next='coding';action='查看原编码任务';}
 else if(project.kind==='application'&&!defined){stage='NEW';title='从业务目标开始开发';reason='当前应用尚未定义业务范围；模板不会预置 i豆或材料整理业务。';next='coding';action='请 Coding 助手制定方案';}
 else if(check&&!check.passed){stage='CHECK_FAILED';title='当前版本结构检查未通过';reason='先处理检查报告中的缺项或引用错误，再进行运行和交付。';}
 else if(delivery){stage='EXPORTED';title='当前版本已有技术导出';reason='可下载固定包；独立运行、业务验收与企业发布仍需分别核验。';next='delivery';action='查看交付记录';}
 else if(run&&['building','starting','running','stopping','unresponsive'].includes(run.status)){stage='RUNNING';title='当前版本已有本机运行';reason='请查看原运行及其业务结果，避免重复启动。';next='runs';action='查看原运行';}
 else if(run?.artifact&&run.origin&&run.engine==='local-java'){stage='DELIVERY_AVAILABLE';title='当前版本可准备技术交付';reason='已有固定版本构建产物；可导出并单独验证业务。';next=project.kind==='template'?'runs':'delivery';action=project.kind==='template'?'查看调试结果':'准备交付';}
 else if(check?.passed){stage=project.kind==='template'?'TEMPLATE_CHECKED':'READY_TO_RUN';title=project.kind==='template'?'模板结构检查通过':'当前版本结构检查通过';reason='结构检查不调用业务模型，不代表业务测试通过。';next=project.kind==='template'?'release':'runs';action=project.kind==='template'?'准备发行模板':'调试真实业务';}
 return {head:project.head,stage,title,reason,next,action,readOnly:role==='platform'&&project.kind==='application',business:'not-verified',
  check:check?{id:check.id,passed:check.passed,head:check.head}:null,previousChecks:reports.filter(r=>r.head!==project.head).length,
  candidate:candidate?{id:candidate.id,head:candidate.head}:null,run:run?{id:run.id,status:run.status,engine:run.engine,head:run.head}:null,
  export:delivery?{id:delivery.id,head:delivery.head}:null};
}

/** Compare each saved asset with its fixed source; a later template is never consulted. */
export function assetOrigins(store:ProjectStore,id:string,role:Role){
 const p=store.get(id,role),current=store.snapshot(id,p.head);const r=p.sourceReleaseId?store.release(p.sourceReleaseId):null,baseline=r?store.snapshot(r.projectId,r.commit):current;
 const parse=(files:Files,path:string,fallback:any)=>{try{return JSON.parse(files[path]??'');}catch{return fallback;}};
 const d=parse(current,'application.json',{}),b=parse(baseline,'application.json',{}),origins:Record<string,string>={};
 const label=(exists:boolean,same:boolean)=>p.kind==='template'?'模板默认能力':!exists?'应用新增':same?'模板提供 · 未覆盖':'应用覆盖 · 来源模板 '+r?.version;
 for(const s of d.skills??[]){const old=b.skills?.find((x:any)=>x.id===s.id);origins['skill:'+s.id]=label(Boolean(old),JSON.stringify(old)===JSON.stringify(s)&&baseline[s.file]===current[s.file]);}
 for(const cap of d.capabilities??[]){const old=b.capabilities?.find((x:any)=>x.id===cap.id);origins[cap.type+':'+cap.id]=label(Boolean(old),JSON.stringify(old)===JSON.stringify(cap));}
 const ops=parse(current,'adapters/operations.json',{}),original=parse(baseline,'adapters/operations.json',{});if(ops&&typeof ops==='object')for(const [name,op]of Object.entries(ops))origins['operation:'+name]=label(Boolean(original?.[name]),JSON.stringify(original?.[name])===JSON.stringify(op));
 return origins;
}
