// Opt-in actual model acceptance of independently unpacked application/source archives.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createBusinessMock} from '../mock-business/server.js';
import {executionSettings,publicExecution} from '../workbench-server/execution-settings.js';

assert.equal(process.env.GAP_PACKAGE_LIVE,'1','Explicit opt-in required');assert.ok(process.env.GAP_EXPORT_REPORT);
const previous=JSON.parse(readFileSync(resolve(process.env.GAP_EXPORT_REPORT),'utf8'));assert.equal(previous.status,'passed-live-flow');assert.ok(previous.verifiedCandidates?.length>=3);
const parent=resolve('test-results');assert.ok(readdirSync(parent).filter(p=>p.startsWith('gap-package-live-')).length<2,'Inspect existing package probes before allocating another');const out=join(parent,'gap-package-live-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(out,{recursive:true});
const execute=promisify(execFile),hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const secrets=new Set<string>(),safe=(value:unknown)=>{let text=JSON.stringify(value,null,2);for(const key of secrets)text=text.split(key).join('[REDACTED]');return text.replace(/sk-[A-Za-z0-9_-]{20,}/g,'[REDACTED]')+'\n';};
const result:any={scope:'independent start.sh startup + actual configured model; fresh standalone Mock for synthetic data; not enterprise acceptance',sourceReport:process.env.GAP_EXPORT_REPORT,sourceHead:previous.sourceHead,runnerSha256:hash(readFileSync(new URL(import.meta.url))),out,cases:[]};const save=()=>writeFileSync(join(out,'report.json'),safe(result));
writeFileSync(join(out,'owner.json'),JSON.stringify({kind:'exported-service-probe',purpose:result.scope,retention:'at most two probe directories; preserve unreviewed artifacts'}));
const mock=createBusinessMock().listen(Number(new URL(previous.mockBase).port),'127.0.0.1');await new Promise<void>((ok,no)=>{mock.once('listening',ok);mock.once('error',no);});

async function runPackage(directory:string,family:string,configuration:ReturnType<typeof executionSettings>){
 const logs:string[]=[],id=randomUUID(),env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:process.env.HOME,JAVA_HOME:process.env.JAVA_HOME,LANG:'C.UTF-8',APP_PORT:'0',MODEL_API_KEY:configuration.apiKey,MODEL_NAME:configuration.model,MODEL_BASE_URL:configuration.baseUrl,WORKBENCH_STATE_DIR:join(directory,'.probe-state'),JAVA_TOOL_OPTIONS:'-Dgap.packageId='+id,OTEL_EXPORTER_OTLP_ENDPOINT:'http://127.0.0.1:14318'};
 const child=spawn('sh',['start.sh'],{cwd:directory,env,detached:true,stdio:['ignore','pipe','pipe']});let closed=false;
 const exited=new Promise<void>((done,no)=>{child.once('error',no);child.once('close',()=>{closed=true;done();});});for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(logs.join('').length<2_000_000)logs.push(chunk.toString());});
 const call=async(origin:string,path:string,body?:unknown)=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const data=await r.json() as any;assert.equal(r.status,200,safe(data));return data;};
 let view:any,origin='';try{
  for(let n=0;n<180;n++){assert.equal(closed,false,'Original exported Java exited');const port=logs.join('').match(/Tomcat started on port (\d+)/)?.[1];if(port){origin='http://127.0.0.1:'+port;try{const health=await call(origin,'/workbench/application');if(health.mode==='live-java')break;}catch{}}await new Promise(r=>setTimeout(r,500));}
  assert.ok(origin,'Original startup did not report a port');const conversation=await call(origin,'/workbench/conversations',{});
  view=await call(origin,'/workbench/messages',{conversationId:conversation.conversationId,query:family==='deepagent'?'请整理会议材料：项目负责人王晨，预算3万元，截止日期6月30日，安全评审由李敏负责；生成brief.md，未知事项标为待确认。':'查询我的i豆余额，查询后结束。'});
  assert.equal(view.tasks.at(-1).state,'COMPLETED',safe(view));if(family==='deepagent'){const text=view.artifacts.find((a:any)=>a.path==='brief.md')?.content??'';for(const fact of ['王晨','3万元','6月30日','李敏'])assert.ok(text.includes(fact),fact);}else{assert.ok(JSON.stringify(view).includes('1280'));const state=await(await fetch(previous.mockBase+'/__mock/state')).json() as any;assert.equal(state.writes,0);assert.ok(state.calls.some((c:any)=>c.operation==='balance'));}
  return {view,origin,configuration:publicExecution(configuration),processId:id};
 }finally{
  if(!closed&&child.pid){process.kill(-child.pid,'SIGTERM');const timer=setTimeout(()=>{if(!closed)try{process.kill(-child.pid!,'SIGKILL');}catch{}},3000);await exited;clearTimeout(timer);}else await exited;
  writeFileSync(join(directory,'probe-java.log'),safe({logs:logs.join('')}));
 }
}
try{
 for(const candidate of previous.verifiedCandidates){
  const source=resolve(previous.root,'exports',candidate.exportId);assert.ok(source.startsWith(resolve(previous.root,'exports')+'/'));const record=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));assert.equal(record.sourceHead,candidate.head);assert.equal(record.runId,candidate.runId);assert.equal(hash(readFileSync(join(source,'manifest.json'))),candidate.manifestSha256);
  for(const kind of ['application','source']){
   console.log(JSON.stringify({stage:'independent-package',candidateId:candidate.id,kind}));const archive=join(source,candidate.artifacts[kind].filename);assert.equal(hash(readFileSync(archive)),candidate.artifacts[kind].sha256);const unpack=join(out,candidate.id+'-'+kind);mkdirSync(unpack);await execute('tar',['-xzf',archive,'-C',unpack],{timeout:30000});const directory=join(unpack,kind);await execute('sh',['verify.sh'],{cwd:directory,timeout:30000});const assets=kind==='application'?join(directory,'assets'):directory,family=JSON.parse(readFileSync(join(assets,'template.json'),'utf8')).family,configuration=executionSettings(process.cwd(),assets);secrets.add(configuration.apiKey);assert.equal(configuration.model,candidate.configuration.model);assert.equal(configuration.baseUrl,candidate.configuration.baseUrl);assert.ok(configuration.apiKey);
   if(kind==='source'){const build=await execute('sh',['build.sh','-o'],{cwd:directory,env:{...process.env,MAVEN_BIN:resolve('.tools/apache-maven-3.9.11/bin/mvn')},timeout:180000,maxBuffer:4_000_000});writeFileSync(join(directory,'probe-build.log'),safe(build));}
   const probe=await runPackage(directory,family,configuration),jar=kind==='application'?join(directory,'application.jar'):join(directory,'target',readdirSync(join(directory,'target')).find(n=>n.endsWith('.jar'))!);if(kind==='application')assert.equal(hash(readFileSync(jar)),candidate.jarSha256);
   result.cases.push({candidateId:candidate.id,sourceHead:candidate.head,exportId:candidate.exportId,kind,family,archiveSha256:candidate.artifacts[kind].sha256,originalJarSha256:candidate.jarSha256,executedJarSha256:hash(readFileSync(jar)),status:'passed',...probe});save();
  }
 }
 result.status='passed';save();console.log(JSON.stringify({status:result.status,packages:result.cases.length,report:join(out,'report.json')}));
}catch(error){result.status='failed';result.error=error instanceof Error?error.message:String(error);save();throw error;}finally{await new Promise<void>(r=>mock.close(()=>r()));save();}
