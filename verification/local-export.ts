// Local-only export validation: offline Maven, loopback-only disabled model endpoint, no business invocation.
import assert from 'node:assert/strict';
import {spawn,type ChildProcess,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream,mkdirSync,readFileSync,writeFileSync,cpSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {moaTemplateFiles} from '../workbench-server/template.js';
import {createWorkbench,readTree} from '../workbench-server/app.js';
const parent=resolve('.workbench/verification');mkdirSync(parent,{recursive:true});
const resumeArgument=process.argv.indexOf('--resume'),resumed=resumeArgument>=0;
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const root=resumed?resolve(process.argv[resumeArgument+1]??''):join(parent,'export-local-'+stamp);
assert.ok(root.startsWith(parent+'/export-local-')&&!root.slice(parent.length+1).includes('/'),'resume must use this verifier owned case directory');
if(!resumed){assert.ok(readdirSync(parent).filter(name=>name.startsWith('export-local-')).length<2,'Inspect existing local export workspaces before creating a third case.');mkdirSync(root);}
const output=resolve('test-results/dev-workbench-v2/p5/local-export-'+(resumed?'resume-':'')+stamp);mkdirSync(output,{recursive:true});
const scratch=mkdtempSync(join(tmpdir(),'workbench-local-export-')),token=randomUUID();writeFileSync(join(scratch,'owner.json'),JSON.stringify({kind:'local-export-verification',token}));
let modelRequests=0;const disabledModel=createServer((_req,res)=>{modelRequests++;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"model disabled in local-only validation"}');});disabledModel.listen(0,'127.0.0.1');await once(disabledModel,'listening');const disabledAddress=disabledModel.address();assert.ok(disabledAddress&&typeof disabledAddress!=='string');
const modelBase=`http://127.0.0.1:${disabledAddress.port}`;
process.env.DEEPSEEK_API_KEY='local-only-disabled';process.env.DEEPSEEK_BASE_URL=modelBase;process.env.WORKBENCH_OFFLINE='1';
const wb=createWorkbench({root:join(root,'data'),codingEngine:{kind:'disabled-for-local-export',async run(){throw Error('Coding is disabled in local-only export verification');}}});const server=wb.app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
let closed=false;const children:ChildProcess[]=[],evidence:Record<string,any>={scope:'offline Maven build, real Java export, shutdown workbench, independent binary and rebuilt-source health only',modelEndpoint:'loopback disabled endpoint',businessExecuted:false,privateCodeReviewExecuted:false};
const sanitized=(text:string)=>text.replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]');
async function digest(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'close');try{process.kill(-child.pid!,'SIGTERM');}catch{}const timer=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},5000);try{await done;}finally{clearTimeout(timer);}}
function start(program:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,name:string){const child=spawn(program,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});children.push(child);let log='';const collect=(chunk:Buffer)=>{log=(log+chunk.toString()).slice(-8_000_000);};child.stdout!.on('data',collect);child.stderr!.on('data',collect);child.once('close',()=>writeFileSync(join(output,name+'.log'),sanitized(log)));return {child,log:()=>log};}
async function shutdown(){if(closed)return;await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();closed=true;}
async function health(process:ReturnType<typeof start>){let port='';for(let n=0;n<180;n++){port=process.log().match(/Tomcat started on port (\d+)/)?.[1]??'';if(port)break;assert.equal(process.child.exitCode,null,'Java exited; inspect local logs');await delay(500);}assert.ok(port,'Standalone Java startup timeout');const origin='http://127.0.0.1:'+port,response=await fetch(origin+'/workbench/application');assert.equal(response.status,200);const value=await response.json() as any;assert.equal(value.runId,'standalone');assert.equal(value.mode,'live-java');const reserved=await fetch(origin+'/workbench/conversations',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(reserved.status,200);const empty=await reserved.json() as any;assert.equal(empty.stack.current,null);assert.deepEqual(empty.tasks,[]);return {application:value,emptyConversation:empty};}
try{
 const call=async(path:string,role='application',method='GET',body?:unknown,expected=200)=>{const response=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json','x-workbench-role':role},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const value=await response.json() as any;assert.equal(response.status,expected,JSON.stringify(value));return value;};
 const assets=readTree('examples/idou');let run:any,record:any;
 if(resumed){
  const records=wb.store.db.prepare('SELECT id FROM exports').all() as {id:string}[];assert.ok(records.length>0,'resume requires an original export');
  const versions=records.map(r=>wb.exports.get(r.id,'application')).sort((a,b)=>b.formatVersion-a.formatVersion);assert.equal(new Set(versions.map(r=>r.runId)).size,1);
  record=versions[0];const manifest=await wb.exports.manifest(record.id,'application');
  const currentFiles={...moaTemplateFiles(),...assets},hashes=Object.fromEntries(Object.entries(currentFiles).map(([name,value])=>[name,createHash('sha256').update(value).digest('hex')]));
  assert.deepEqual(hashes,manifest.buildInputFiles,'source/build/asset content changed; do not reuse the old build');
  run=(await call('/runs/'+record.runId)).run;assert.equal(run.status,'stopped','original process must already be stopped');
  const expectedStatus=record.formatVersion===2?200:201;const reused=(await call('/projects/'+record.projectId+'/exports','application','POST',{runId:run.id},expectedStatus)).export;assert.equal(reused.runId,record.runId);assert.equal(reused.head,record.head);
  evidence.previousExport=record;evidence.repackagedOriginalBuild=reused.id!==record.id;record=reused;
  evidence.reusedOriginalBuild=true;evidence.exactInputHashesMatched=true;console.log('Reusing hash-matched original build without Maven rebuild:',run.id);
 }else{
  assert.equal((await call('/projects/moa-platform/checks','platform','POST',{},201)).report.passed,true);
  const release=(await call('/templates/moa-platform/releases','platform','POST',{version:'1.0.0'},201)).release;
  const created=(await call('/projects','application','POST',{releaseId:release.id,name:'本机独立包验证'},201)).project;assert.deepEqual((await call('/projects/'+created.id)).definition.skills,[]);
  const saved=(await call('/projects/'+created.id+'/files','application','PUT',{baseHead:created.head,changes:assets})).project;
  run=(await call('/projects/'+created.id+'/runs','application','POST',{baseHead:saved.head},202)).run;console.log('Local-only original build:',run.id);
  for(let n=0;n<240;n++){run=(await call('/runs/'+run.id)).run;if(!['building','starting'].includes(run.status))break;await delay(1000);}assert.equal(run.status,'running',run.error?.message);assert.equal(modelRequests,0);
  record=(await call('/projects/'+created.id+'/exports','application','POST',{runId:run.id},201)).export;evidence.release=release;
 }
 evidence.run=run;evidence.export=record;
 for(const kind of ['application','source'] as const){const response=await fetch(base+'/api/exports/'+record.id+'/files/'+kind);assert.equal(response.status,200);assert.ok(response.body);const archive=join(scratch,kind+'.tar.gz');await pipeline(Readable.fromWeb(response.body as any),createWriteStream(archive));assert.equal(await digest(archive),record.artifacts[kind].sha256);execFileSync('tar',['-xzf',archive,'-C',scratch]);execFileSync('sh',[join(scratch,kind,'verify.sh')]);}
 assert.equal(await digest(join(scratch,'application/application.jar')),run.artifact.sha256);await shutdown();await assert.rejects(fetch(base+'/api/context',{signal:AbortSignal.timeout(2000)}));evidence.workbenchStopped=true;console.log('Workbench and original Java stopped; starting exported application in a new directory.');
 const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:process.env.HOME,LANG:'C.UTF-8',DEEPSEEK_API_KEY:'local-only-disabled',DEEPSEEK_BASE_URL:modelBase,APP_PORT:'0',OTEL_EXPORTER_OTLP_ENDPOINT:'http://127.0.0.1:14318'};
 const application=start('/bin/sh',['./start.sh'],join(scratch,'application'),env,'application-java');evidence.application=await health(application);assert.deepEqual(evidence.application.application.definition,JSON.parse(assets['application.json']));assert.equal(modelRequests,0);await stop(application.child);console.log('Independent application health passed; rebuilding exported source offline.');
 cpSync(resolve('.tools/apache-maven-3.9.11'),join(scratch,'maven-toolchain'),{recursive:true});
 const sourceBuild=start('/bin/sh',['./build.sh','-o'],join(scratch,'source'),{PATH:'/usr/bin:/bin',HOME:process.env.HOME,LANG:'C.UTF-8',MAVEN_BIN:join(scratch,'maven-toolchain/bin/mvn')},'source-build');const buildTimer=setTimeout(()=>void stop(sourceBuild.child),180000);try{const [code]=await once(sourceBuild.child,'close');assert.equal(code,0,'Source package failed offline build; inspect source-build.log');}finally{clearTimeout(buildTimer);}
 assert.match(sourceBuild.log(),/BUILD SUCCESS/);evidence.sourceBuildTests=sourceBuild.log().match(/Tests run: \d+, Failures: 0, Errors: 0, Skipped: 0/g)?.at(-1);const jars=readdirSync(join(scratch,'source/target')).filter(name=>name.endsWith('.jar'));assert.equal(jars.length,1);evidence.rebuiltJarSha256=await digest(join(scratch,'source/target',jars[0]));
 const source=start('/bin/sh',['./start.sh'],join(scratch,'source'),env,'source-java');evidence.source=await health(source);assert.deepEqual(evidence.source.application.definition,JSON.parse(assets['application.json']));assert.equal(modelRequests,0);
 evidence.passed=true;evidence.modelRequests=modelRequests;evidence.notVerified=['real model routing/Skill business','actual confirmation or A2A business','real OpenCode revision','customer CI/deployment'];
 writeFileSync(join(output,'result.json'),sanitized(JSON.stringify(evidence,null,2))+'\n');console.log(JSON.stringify({passed:true,scope:'local-only build/export/independent bootstrap',modelRequests,jar:run.artifact.sha256,rebuiltJar:evidence.rebuiltJarSha256,report:join(output,'result.json')},null,2));
}catch(error){evidence.passed=false;evidence.modelRequests=modelRequests;evidence.error=error instanceof Error?error.message:String(error);writeFileSync(join(output,'failure.json'),sanitized(JSON.stringify(evidence,null,2))+'\n');throw error;
}finally{await shutdown();for(const child of children.reverse())await stop(child);await new Promise<void>(r=>disabledModel.close(()=>r()));const owner=JSON.parse(readFileSync(join(scratch,'owner.json'),'utf8'));if(owner.kind==='local-export-verification'&&owner.token===token)rmSync(scratch,{recursive:true,force:true});}
