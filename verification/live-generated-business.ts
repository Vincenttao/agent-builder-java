// Explicit real-model business validation of the already exported, actually generated application. No rebuild.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkbench} from '../workbench-server/app.js';
import {LocalJavaEngine,type RunningJava} from '../workbench-server/local-java.js';
import {settings} from '../workbench-server/settings.js';
import {createBusinessMock} from '../mock-business/server.js';
import {verifyStandaloneBusiness} from './fixtures/standalone-business.js';
const config=settings();assert.ok(config.apiKey);assert.equal(new URL(config.baseUrl).hostname,'api.deepseek.com','This live case is authorized only for api.deepseek.com');assert.equal(config.model,'deepseek-flash','Original exported JAR is the fixed Flash baseline');
const input=JSON.parse(readFileSync(resolve(process.argv[2]??''),'utf8'));assert.equal(input.passed,true);const root=resolve('.workbench/verification/opencode-application-2026-10-25T02-14-32-049Z');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),output=resolve('test-results/dev-workbench-v2/p5/generated-business-'+stamp);mkdirSync(output,{recursive:true});const scratch=mkdtempSync(join(tmpdir(),'workbench-generated-business-')),token=randomUUID();writeFileSync(join(scratch,'owner.json'),JSON.stringify({kind:'generated-business-verifier',token}));
const safe=(value:unknown)=>JSON.stringify(value,null,2).split(config.apiKey).join('[REDACTED]').replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]')+'\n';
const wb=createWorkbench({root,codingEngine:{async run(){throw Error('No generation during business verification');}}});let closed=false,java:RunningJava|undefined,mock:import('node:http').Server|undefined,javaLog='';
const evidence:Record<string,any>={scope:'actual OpenCode generated fixed application, original exported JAR, workbench closed, real Flash routing/MOA/SDK A2A + independent HTTP Mock; no rebuild',sourceHead:input.run.head,originalJarSha256:input.run.artifact.sha256,sourceJob:input.reviewedSource.jobId,sourceSession:input.reviewedSource.sessionId,model:config.model,destination:'api.deepseek.com',traces:[]};
async function close(){if(closed)return;await wb.close();wb.store.close();closed=true;}
async function digest(path:string){const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);return hash.digest('hex');}
try{
 assert.equal((await fetch('http://127.0.0.1:16686/api/v3/services',{signal:AbortSignal.timeout(3000)})).status,200,'Existing Jaeger required');
 mock=createBusinessMock().listen(8770,'127.0.0.1');await once(mock,'listening');const mockBase='http://127.0.0.1:8770';
 const original=wb.runs.get(input.run.id,'application');assert.equal(original.status,'stopped');assert.equal(original.head,input.run.head);assert.equal(wb.store.get(original.projectId,'application').head,original.head);const archive=await wb.exports.file(input.export.id,'application','application');assert.equal(archive.artifact.sha256,input.export.artifacts.application.sha256);
 await promisify(execFile)('tar',['-xzf',archive.path,'-C',scratch]);const app=join(scratch,'application');await promisify(execFile)('sh',['verify.sh'],{cwd:app});assert.equal(await digest(join(app,'application.jar')),original.artifact!.sha256);const definition=JSON.parse(readFileSync(join(app,'assets/application.json'),'utf8'));assert.deepEqual(definition.connections,input.independentDefinition.definition.connections);await close();evidence.workbenchClosed=true;
 console.log(JSON.stringify({status:'starting-exported-generated-application',sourceHead:original.head,output}));
 java=await new LocalJavaEngine(process.cwd()).start({directory:join(app,'assets'),jar:join(app,'application.jar'),stateDirectory:join(scratch,'state'),runId:'live-generated-'+original.id,signal:new AbortController().signal,onLog:text=>{javaLog=(javaLog+text).slice(-8_000_000);},onProcess:()=>{}});
 evidence.definition=await(await fetch(java.origin+'/workbench/application')).json();assert.deepEqual(evidence.definition.definition,definition);
 evidence.business=await verifyStandaloneBusiness(java.origin,mockBase,value=>{evidence.recentObservations??=[];evidence.recentObservations.push(value);if(evidence.recentObservations.length>8)evidence.recentObservations.shift();});
 for(const id of evidence.business.traceIds){assert.match(id,/^[a-f0-9]{32}$/i);let found='';for(let n=0;n<8;n++){const response=await fetch('http://127.0.0.1:16686/api/v3/traces/'+id);if(response.ok){found=await response.text();if(found.includes('moa-business-application'))break;}await delay(250);}assert.ok(found.includes('moa-business-application'),'Trace missing '+id);writeFileSync(join(output,'trace-'+id+'.json'),found.split(config.apiKey).join('[REDACTED]'));evidence.traces.push(id);}
 evidence.passed=true;writeFileSync(join(output,'result.json'),safe(evidence));console.log(JSON.stringify({passed:true,checks:evidence.business.checks,writes:evidence.business.external.writes,a2aCalls:evidence.business.external.a2aCalls.length,traces:evidence.traces,report:join(output,'result.json')},null,2));
}catch(error){evidence.error=error instanceof Error?error.message:String(error);try{if(mock?.listening)evidence.external=await(await fetch('http://127.0.0.1:8770/__mock/state')).json();}catch{}writeFileSync(join(output,'failure.json'),safe(evidence));throw Error('Generated business verification failed; inspect '+output);}
finally{if(java)await java.stop();writeFileSync(join(output,'java.log'),javaLog.split(config.apiKey).join('[REDACTED]'));await close();if(mock?.listening)await new Promise<void>(r=>mock!.close(()=>r()));const owner=JSON.parse(readFileSync(join(scratch,'owner.json'),'utf8'));if(owner.kind==='generated-business-verifier'&&owner.token===token)rmSync(scratch,{recursive:true,force:true});}
