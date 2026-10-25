// Rebuild the actual generated application's existing source export. No model or business invocation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,readdirSync,createReadStream} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWorkbench} from '../workbench-server/app.js';
import {LocalJavaEngine,type RunningJava} from '../workbench-server/local-java.js';
const run=promisify(execFile),input=JSON.parse(readFileSync(resolve(process.argv[2]??''),'utf8'));assert.equal(input.passed,true);assert.equal(input.modelRequests,0);assert.equal(input.run.engine,'local-java');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),output=resolve('test-results/dev-workbench-v2/p5/generated-source-'+stamp);mkdirSync(output,{recursive:true});
const parent=resolve('.workbench/verification');const candidates=readdirSync(parent).filter(p=>p.startsWith('opencode-application-'));let root='';
for(const candidate of candidates){const directory=join(parent,candidate);const project=join(directory,'projects',input.run.projectId);try{if(readdirSync(project).includes('application.json')){root=directory;break;}}catch{}}
assert.ok(root,'Original generated project workspace is missing');
const scratch=mkdtempSync(join(tmpdir(),'workbench-generated-source-')),token=randomUUID();writeFileSync(join(scratch,'owner.json'),JSON.stringify({kind:'generated-source-verifier',token}));
const wb=createWorkbench({root,codingEngine:{async run(){throw Error('disabled');}}});let closed=false,java:RunningJava|undefined,modelRequests=0,javaLog='';
const disabled=createServer((req,res)=>{if(!req.url?.startsWith('/v1/traces'))modelRequests++;res.writeHead(503);res.end('disabled');});disabled.listen(0,'127.0.0.1');await once(disabled,'listening');const address=disabled.address();assert.ok(address&&typeof address!=='string');const loopback='http://127.0.0.1:'+address.port;
process.env.DEEPSEEK_API_KEY='local-only-disabled';process.env.DEEPSEEK_BASE_URL=loopback;process.env.JAVA_BIN='/usr/bin/java';process.env.OTEL_EXPORTER_OTLP_ENDPOINT=loopback;
const result:Record<string,any>={scope:'rebuild existing source export of actual OpenCode generated revision, independent Java17 asset bootstrap only',sourceHead:input.run.head,originalJar:input.run.artifact.sha256,exportId:input.export.id,businessModelExecuted:false};
async function close(){if(closed)return;await wb.close();wb.store.close();closed=true;}
async function digest(file:string){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
try{
 const original=wb.runs.get(input.run.id,'application');assert.equal(original.status,'stopped');assert.equal(original.head,input.run.head);assert.equal(wb.store.get(original.projectId,'application').head,input.run.head);
 const archive=await wb.exports.file(input.export.id,'application','source');assert.equal(archive.artifact.sha256,input.export.artifacts.source.sha256);const manifest=await wb.exports.manifest(input.export.id,'application');assert.equal(manifest.sourceHead,input.run.head);result.sourceArchiveSha256=archive.artifact.sha256;
 await run('tar',['-xzf',archive.path,'-C',scratch]);const source=join(scratch,'source');await run('sh',['verify.sh'],{cwd:source});await close();
 const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:process.env.HOME,LANG:'C.UTF-8',MAVEN_BIN:resolve('.tools/apache-maven-3.9.11/bin/mvn')};
 const build=await run('sh',['build.sh','-o'],{cwd:source,env,timeout:180000,maxBuffer:8_000_000});writeFileSync(join(output,'source-build.log'),build.stdout+build.stderr);assert.match(build.stdout,/BUILD SUCCESS/);result.tests=build.stdout.match(/Tests run: \d+, Failures: 0, Errors: 0, Skipped: 0/g)?.at(-1);
 const jars=readdirSync(join(source,'target')).filter(p=>p.endsWith('.jar'));assert.equal(jars.length,1);const jar=join(source,'target',jars[0]);result.rebuiltJar=await digest(jar);
 java=await new LocalJavaEngine(process.cwd()).start({directory:source,jar,stateDirectory:join(scratch,'state'),runId:'generated-source-'+original.id,signal:new AbortController().signal,onLog:text=>{javaLog=(javaLog+text).slice(-8_000_000);},onProcess:()=>{}});
 const healthy=await(await fetch(java.origin+'/workbench/application')).json() as any;assert.deepEqual(healthy.definition,input.independentDefinition.definition);const response=await fetch(java.origin+'/workbench/conversations',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,200);const empty=await response.json() as any;assert.equal(empty.stack.current,null);assert.deepEqual(empty.tasks,[]);assert.equal(modelRequests,0);
 result.passed=true;result.definition=healthy;result.emptyConversation=empty;result.modelRequests=modelRequests;result.workbenchClosedBeforeBuild=true;result.notVerified=['real business model/confirmation/A2A','business execution after rebuild','customer CI'];writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,tests:result.tests,sourceHead:result.sourceHead,rebuiltJar:result.rebuiltJar,modelRequests,report:join(output,'result.json')},null,2));
}catch(error){const failure=error as Error&{stdout?:string;stderr?:string};if(failure.stdout)writeFileSync(join(output,'source-build-failure.log'),failure.stdout+String(failure.stderr??''));result.error=failure.message;result.modelRequests=modelRequests;writeFileSync(join(output,'failure.json'),JSON.stringify(result,null,2)+'\n');throw Error('Generated source check failed; inspect '+output);}
finally{if(java)await java.stop();writeFileSync(join(output,'source-java.log'),javaLog);await close();await new Promise<void>(r=>disabled.close(()=>r()));const owner=JSON.parse(readFileSync(join(scratch,'owner.json'),'utf8'));if(owner.kind==='generated-source-verifier'&&owner.token===token)rmSync(scratch,{recursive:true,force:true});}
