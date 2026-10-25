// Opt-in: one rebuild of an existing source export, then real business with the workbench closed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,readdirSync,createReadStream,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkbench} from '../workbench-server/app.js';
import {LocalJavaEngine,type RunningJava} from '../workbench-server/local-java.js';
import {settings} from '../workbench-server/settings.js';
import {createBusinessMock} from '../mock-business/server.js';
import {verifyStandaloneBusiness} from './fixtures/standalone-business.js';
const input=JSON.parse(readFileSync(resolve(process.argv[2]??''),'utf8'));assert.equal(input.passed,true);assert.equal(input.workbenchStopped,true);assert.equal(input.run.engine,'local-java');
const root=resolve(input.workspaceRoot);assert.ok(root.startsWith(resolve('.workbench/verification')+'/opencode-'));const config=settings();assert.ok(config.apiKey);assert.equal(new URL(config.baseUrl).hostname,'api.deepseek.com');assert.equal(config.model,'deepseek-flash');
const output=resolve('test-results/dev-workbench-v2/p5/source-business-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(output,{recursive:true});
const scratch=mkdtempSync(join(tmpdir(),'workbench-source-business-')),token=randomUUID();writeFileSync(join(scratch,'owner.json'),JSON.stringify({kind:'source-business',token}));
const safe=(value:unknown)=>JSON.stringify(value,null,2).split(config.apiKey).join('[REDACTED]').replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]')+'\n';
const wb=createWorkbench({root,codingEngine:{async run(){throw Error('No generation during source delivery verification');}}});let closed=false,java:RunningJava|undefined,mock:import('node:http').Server|undefined,javaLog='';
const result:Record<string,any>={scope:'existing fixed source export rebuilt once, independent Java17 real Flash/HTTP/A2A; not PC acceptance',workspaceRoot:root,sourceHead:input.sourceHead,projectId:input.projectId,runId:input.runId,exportId:input.export.id,originalJar:input.run.artifact.sha256,traces:[]};
async function close(){if(closed)return;await wb.close();wb.store.close();closed=true;}
async function digest(path:string){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');}
try{
 const original=wb.runs.get(input.runId,'application');assert.equal(original.status,'stopped');assert.equal(original.head,input.sourceHead);assert.equal(wb.store.get(input.projectId,'application').head,input.sourceHead);
 const archive=await wb.exports.file(input.export.id,'application','source');assert.equal(archive.artifact.sha256,input.export.artifacts.source.sha256);const manifest=await wb.exports.manifest(input.export.id,'application');assert.equal(manifest.sourceHead,input.sourceHead);result.sourceArchiveSha256=archive.artifact.sha256;
 await promisify(execFile)('tar',['-xzf',archive.path,'-C',scratch]);const source=join(scratch,'source');await promisify(execFile)('sh',['verify.sh'],{cwd:source});await close();result.workbenchStoppedBeforeBuild=true;
 console.log(JSON.stringify({status:'rebuilding-source',sourceHead:input.sourceHead,output}));
 const build=await promisify(execFile)('sh',['build.sh','-o'],{cwd:source,env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,LANG:'C.UTF-8',MAVEN_BIN:resolve('.tools/apache-maven-3.9.11/bin/mvn')},timeout:180000,maxBuffer:8_000_000});writeFileSync(join(output,'source-build.log'),build.stdout+build.stderr);assert.match(build.stdout,/BUILD SUCCESS/);result.tests=build.stdout.match(/Tests run: \d+, Failures: 0, Errors: 0, Skipped: 0/g)?.at(-1);assert.ok(result.tests);
 const jars=readdirSync(join(source,'target')).filter(n=>n.endsWith('.jar'));assert.equal(jars.length,1);const jar=join(source,'target',jars[0]);result.rebuiltJar=await digest(jar);copyFileSync(jar,join(output,'rebuilt-application.jar'));result.retainedArtifact='rebuilt-application.jar';
 assert.equal((await fetch('http://127.0.0.1:16686/api/v3/services',{signal:AbortSignal.timeout(3000)})).status,200);mock=createBusinessMock().listen(8770,'127.0.0.1');await once(mock,'listening');
 const previousJava=process.env.JAVA_BIN;process.env.JAVA_BIN='/usr/bin/java';try{java=await new LocalJavaEngine(process.cwd()).start({directory:source,jar,stateDirectory:join(scratch,'state'),runId:'source-business-'+input.runId,signal:new AbortController().signal,onLog:text=>{javaLog=(javaLog+text).slice(-8_000_000);},onProcess:()=>{}});}finally{if(previousJava===undefined)delete process.env.JAVA_BIN;else process.env.JAVA_BIN=previousJava;}
 result.definition=await(await fetch(java.origin+'/workbench/application')).json();assert.deepEqual(result.definition.definition,input.independentDefinition.definition);
 result.business=await verifyStandaloneBusiness(java.origin,'http://127.0.0.1:8770',v=>{result.observations??=[];result.observations.push(v);if(result.observations.length>8)result.observations.shift();writeFileSync(join(output,'progress.json'),safe({sourceHead:result.sourceHead,rebuiltJar:result.rebuiltJar,observations:result.observations}));});
 for(const id of result.business.traceIds){assert.match(id,/^[a-f0-9]{32}$/i);let text='';for(let n=0;n<8;n++){const response=await fetch('http://127.0.0.1:16686/api/v3/traces/'+id);if(response.ok){text=await response.text();if(text.includes('moa-business-application'))break;}await delay(250);}assert.ok(text.includes('moa-business-application'),'Trace missing '+id);writeFileSync(join(output,'trace-'+id+'.json'),text.split(config.apiKey).join('[REDACTED]'));result.traces.push(id);}
 result.passed=true;writeFileSync(join(output,'result.json'),safe(result));console.log(JSON.stringify({passed:true,tests:result.tests,rebuiltJar:result.rebuiltJar,checks:result.business.checks,writes:result.business.external.writes,a2aCalls:result.business.external.a2aCalls.length,traces:result.traces.length,report:join(output,'result.json')},null,2));
}catch(error){const failure=error as Error&{stdout?:string;stderr?:string};if(failure.stdout)writeFileSync(join(output,'source-build-failure.log'),String(failure.stdout)+String(failure.stderr??''));result.error=failure.message;try{if(mock?.listening)result.external=await(await fetch('http://127.0.0.1:8770/__mock/state')).json();}catch{}writeFileSync(join(output,'failure.json'),safe(result));throw Error('Source business verification failed; inspect '+output);}
finally{if(java)await java.stop();writeFileSync(join(output,'java.log'),javaLog.split(config.apiKey).join('[REDACTED]'));await close();if(mock?.listening)await new Promise<void>(r=>mock!.close(()=>r()));const owner=JSON.parse(readFileSync(join(scratch,'owner.json'),'utf8'));if(owner.kind==='source-business'&&owner.token===token)rmSync(scratch,{recursive:true,force:true});}
