// Explicit live export/independence validation. No OpenCode or private-code review is invoked.
import assert from 'node:assert/strict';
import {spawn,type ChildProcess,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream,mkdirSync,readFileSync,writeFileSync,cpSync,mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkbench,readTree} from '../workbench-server/app.js';
import {settings} from '../workbench-server/settings.js';
import {verifyStandaloneBusiness} from './fixtures/standalone-business.js';
const config=settings();assert.ok(config.apiKey,'local model key is required');
const parent=resolve('.workbench/verification');mkdirSync(parent,{recursive:true});
assert.ok(readdirSync(parent).filter(name=>name.startsWith('export-delivery-')).length<2,'At most two live export workspaces; inspect existing ownership/evidence before another case.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),root=join(parent,'export-delivery-'+stamp),output=resolve('test-results/dev-workbench-v2/p5/live-export-'+stamp);mkdirSync(root);mkdirSync(output,{recursive:true});
const scratch=mkdtempSync(join(tmpdir(),'workbench-export-')),token=randomUUID();writeFileSync(join(scratch,'owner.json'),JSON.stringify({kind:'workbench-export-verification',token}));
const safe=(value:string)=>value.split(config.apiKey).join('[REDACTED]').replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]');
const evidence:Record<string,any>={scope:'real fixed-project build, technical export, stop workbench, direct application JAR and rebuilt-source business; hand-written i豆 reference assets, not OpenCode generation',privateCodeReviewCalls:0};
const children:ChildProcess[]=[];let workbench:ReturnType<typeof createWorkbench>|undefined,server:ReturnType<ReturnType<typeof createWorkbench>['app']['listen']>|undefined,closed=false,lastExternal:any,mockBase='';
async function hashFile(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function launch(program:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,name:string){const child=spawn(program,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});children.push(child);let text='';const collect=(chunk:Buffer)=>{text=(text+chunk.toString()).slice(-8_000_000);};child.stdout!.on('data',collect);child.stderr!.on('data',collect);child.once('close',()=>writeFileSync(join(output,name+'.log'),safe(text)));return {child,log:()=>text};}
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const end=once(child,'exit');try{process.kill(-child.pid!,'SIGTERM');}catch{}const timer=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},5000);try{await end;}finally{clearTimeout(timer);}}
async function closeWorkbench(){if(closed||!workbench||!server)return;await workbench.close();await new Promise<void>(r=>server!.close(()=>r()));workbench.store.close();closed=true;}
try{
 const healthy=await fetch('http://127.0.0.1:16686/api/v3/services',{signal:AbortSignal.timeout(3000)});assert.equal(healthy.status,200,'existing Jaeger is required');
 const startMock=async(port=0)=>{const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {createBusinessMock} from './mock-business/server.ts';const server=createBusinessMock().listen(Number(process.env.MOCK_PORT),'127.0.0.1',()=>process.send({port:server.address().port}));process.once('SIGTERM',()=>server.close(()=>process.exit(0)));process.once('disconnect',()=>server.close(()=>process.exit(0)));`],{env:{PATH:process.env.PATH,MOCK_PORT:String(port)},detached:true,stdio:['ignore','pipe','pipe','ipc']});children.push(child);const address=await Promise.race([once(child,'message').then(([v])=>v as {port:number}),once(child,'exit').then(()=>{throw Error('Mock exited');}),delay(10000).then(()=>{throw Error('Mock startup timeout');})]);return {child,port:address.port};};
 let mock=await startMock();mockBase=`http://127.0.0.1:${mock.port}`;
 const observe=(phase:string)=>(value:unknown)=>{evidence.businessObservations??=[];evidence.businessObservations.push({phase,value});if(evidence.businessObservations.length>6)evidence.businessObservations.shift();};
 workbench=createWorkbench({root:join(root,'data'),codingEngine:{kind:'disabled-for-export-verification',async run(){throw Error('OpenCode is not part of export validation');}}});server=workbench.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const call=async(path:string,role='application',method='GET',body?:unknown,expected=200)=>{const response=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json','x-workbench-role':role},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const value=await response.json() as any;assert.equal(response.status,expected,JSON.stringify(value));return value;};
 const template=(await call('/projects/moa-platform','platform')).project;
 await call('/projects/moa-platform/files','platform','PUT',{baseHead:template.head,changes:{'delivery-notes.md':'固定本机 MOA 范式；本批验证独立交付，不冒充真实编码生成。\n'}});
 assert.equal((await call('/projects/moa-platform/checks','platform','POST',{},201)).report.passed,true);
 const release=(await call('/templates/moa-platform/releases','platform','POST',{version:'1.0.0'},201)).release;
 const application=(await call('/projects','application','POST',{releaseId:release.id,name:'独立交付验证应用'},201)).project;
 assert.deepEqual((await call('/projects/'+application.id)).definition.skills,[]);
 const changes=readTree('examples/idou'),definition=JSON.parse(changes['application.json']);definition.connections={idou:mockBase,procurement:mockBase+'/a2a/procurement',fallback:mockBase+'/a2a/fallback'};changes['application.json']=JSON.stringify(definition,null,2)+'\n';
 const saved=(await call('/projects/'+application.id+'/files','application','PUT',{baseHead:application.head,changes})).project;
 let run=(await call('/projects/'+application.id+'/runs','application','POST',{baseHead:saved.head},202)).run;console.log('Original build started:',run.id);
 for(let n=0;n<240;n++){run=(await call('/runs/'+run.id)).run;if(!['building','starting'].includes(run.status))break;await delay(1000);}evidence.run=run;assert.equal(run.status,'running',run.error?.message);assert.equal(run.engine,'local-java');
 const record=(await call('/projects/'+application.id+'/exports','application','POST',{runId:run.id},201)).export;evidence.export=record;evidence.release=release;console.log('Real JAR exported:',record.artifacts.application.sha256);
 for(const kind of ['application','source'] as const){const response=await fetch(base+'/api/exports/'+record.id+'/files/'+kind);assert.equal(response.status,200);assert.ok(response.body);const archive=join(scratch,kind+'.tar.gz');await pipeline(Readable.fromWeb(response.body as any),createWriteStream(archive));assert.equal(await hashFile(archive),record.artifacts[kind].sha256);execFileSync('tar',['-xzf',archive,'-C',scratch]);execFileSync('sh',[join(scratch,kind,'verify.sh')]);}
 const assetsFile=join(scratch,'application/assets/application.json');assert.deepEqual(JSON.parse(readFileSync(assetsFile,'utf8')),definition);assert.equal(await hashFile(join(scratch,'application/application.jar')),run.artifact.sha256);
 await closeWorkbench();await assert.rejects(fetch(base+'/api/context',{signal:AbortSignal.timeout(2000)}));evidence.workbenchStopped=true;evidence.originalJavaStopped=true;console.log('Workbench API and its original Java stopped; standalone calls will bypass it.');
 const minimal:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:process.env.HOME,LANG:'C.UTF-8'};
 const javaEnv={...minimal,DEEPSEEK_API_KEY:config.apiKey,DEEPSEEK_BASE_URL:config.baseUrl,APP_PORT:'0',OTEL_EXPORTER_OTLP_ENDPOINT:'http://127.0.0.1:14318'};
 const binary=launch('/bin/sh',['./start.sh'],join(scratch,'application'),javaEnv,'application-java');let port='';for(let n=0;n<180;n++){port=binary.log().match(/Tomcat started on port (\d+)/)?.[1]??'';if(port)break;assert.equal(binary.child.exitCode,null,'Exported Java exited; inspect application-java.log');await delay(500);}assert.ok(port,'Exported application startup timeout');const binaryBase='http://127.0.0.1:'+port;
 assert.equal((await (await fetch(binaryBase+'/workbench/application')).json() as any).runId,'standalone');
 console.log('Standalone application ready. Verifying direct real-model business.');evidence.application=await verifyStandaloneBusiness(binaryBase,mockBase,observe('application'));lastExternal=evidence.application.external;
 const journal=join(scratch,'application/.runtime-state',evidence.application.stages.completed.conversationId,'events.jsonl'),beforeJournal=await hashFile(journal);for(let n=0;n<3;n++)await fetch(binaryBase+'/workbench/conversations/'+evidence.application.stages.completed.conversationId);assert.equal(await hashFile(journal),beforeJournal);evidence.application.readOnlyJournalUnchanged=true;
 await stop(binary.child);console.log('Application archive business passed; rebuilding source in a new directory.');
 cpSync(resolve('.tools/apache-maven-3.9.11'),join(scratch,'maven-toolchain'),{recursive:true});
 const build=launch('/bin/sh',['./build.sh','-o'],join(scratch,'source'),{...minimal,MAVEN_BIN:join(scratch,'maven-toolchain/bin/mvn')},'source-build');const buildTimeout=setTimeout(()=>void stop(build.child),180000);try{const [code]=await once(build.child,'close');assert.equal(code,0,'Source build failed; inspect source-build.log');}finally{clearTimeout(buildTimeout);}
 assert.match(build.log(),/BUILD SUCCESS/);const jars=readdirSync(join(scratch,'source/target')).filter(name=>name.endsWith('.jar'));assert.equal(jars.length,1);evidence.rebuiltJarSha256=await hashFile(join(scratch,'source/target',jars[0]));evidence.sourceBuildTests=build.log().match(/Tests run: \d+, Failures: 0, Errors: 0, Skipped: 0/g)?.at(-1);
 // The second deployment uses an independent Mock state, not the first deployment's ledger.
 await stop(mock.child);mock=await startMock(mock.port);
 const sourceJava=launch('/bin/sh',['./start.sh'],join(scratch,'source'),javaEnv,'source-java');port='';for(let n=0;n<180;n++){port=sourceJava.log().match(/Tomcat started on port (\d+)/)?.[1]??'';if(port)break;assert.equal(sourceJava.child.exitCode,null,'Rebuilt Java exited; inspect source-java.log');await delay(500);}assert.ok(port,'Rebuilt application startup timeout');console.log('Rebuilt source ready. Verifying direct real-model business.');
 evidence.source=await verifyStandaloneBusiness('http://127.0.0.1:'+port,mockBase,observe('source'));lastExternal=evidence.source.external;
 const traceIds=[...new Set([...evidence.application.traceIds,...evidence.source.traceIds])];evidence.tracesRetrieved=[];
 for(const id of traceIds){assert.match(id,/^[a-f0-9]{32}$/i);let text='';for(let n=0;n<6;n++){const response=await fetch('http://127.0.0.1:16686/api/v3/traces/'+id);if(response.ok){text=await response.text();if(text.includes('moa-business-application'))break;}await delay(250);}assert.ok(text.includes('moa-business-application'),'Trace unavailable '+id);writeFileSync(join(output,'trace-'+id+'.json'),safe(text));evidence.tracesRetrieved.push(id);}
 const scan=execFileSync('/usr/bin/python3',['-c',`import os,pathlib,zipfile,json
root=pathlib.Path(os.environ['VERIFY_PACKAGE_ROOT']); needle=os.environ['DEEPSEEK_API_KEY'].encode(); count=0
for path in root.rglob('*'):
 if path.is_file() and path.suffix not in ('.jar','.gz'):
  assert needle not in path.read_bytes(), 'secret found in package file'
for path in [root/'application/application.jar',*list((root/'source/target').glob('*.jar'))]:
 with zipfile.ZipFile(path) as archive:
  assert sum(i.file_size for i in archive.infolist()) < 1000000000
  for item in archive.infolist():
   if item.is_dir(): continue
   count+=1; tail=b''
   with archive.open(item) as stream:
    while True:
     part=stream.read(65536)
     if not part: break
     data=tail+part; assert needle not in data, 'secret found in jar entry'; tail=data[-len(needle):]
print(json.dumps({'secretFound':False,'jarEntriesChecked':count}))`],{env:{...minimal,VERIFY_PACKAGE_ROOT:scratch,DEEPSEEK_API_KEY:config.apiKey},encoding:'utf8',maxBuffer:10000});evidence.secretScan=JSON.parse(scan);
 evidence.passed=true;evidence.qualifiedScope='Both application and rebuilt-source archives ran real Flash/MOA/HTTP/A2A directly after workbench stop. Hand-written business assets; no actual OpenCode/PC full-journey acceptance or customer CI.';
 writeFileSync(join(output,'result.json'),safe(JSON.stringify(evidence,null,2))+'\n');console.log(JSON.stringify({passed:true,sourceHead:saved.head,exportId:record.id,originalJar:run.artifact.sha256,rebuiltJar:evidence.rebuiltJarSha256,report:join(output,'result.json')},null,2));
}catch(error){try{if(mockBase)evidence.externalAtFailure=await(await fetch(mockBase+'/__mock/state',{signal:AbortSignal.timeout(2000)})).json();}catch{}evidence.passed=false;evidence.error=error instanceof Error?error.message:String(error);evidence.lastExternal=lastExternal;writeFileSync(join(output,'failure.json'),safe(JSON.stringify(evidence,null,2))+'\n');throw error;
}finally{await closeWorkbench();for(const child of children.reverse())await stop(child);const owner=JSON.parse(readFileSync(join(scratch,'owner.json'),'utf8'));if(owner.kind==='workbench-export-verification'&&owner.token===token)rmSync(scratch,{recursive:true,force:true});}
