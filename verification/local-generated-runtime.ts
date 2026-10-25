// Local-only validation of an already reviewed, actually generated application. No model requests.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,mkdtempSync,rmSync,createWriteStream,createReadStream} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkbench} from '../workbench-server/app.js';
import {LocalJavaEngine,type RunningJava} from '../workbench-server/local-java.js';
const recordFile=resolve(process.argv[2]??'');const reviewed=JSON.parse(readFileSync(recordFile,'utf8'));assert.equal(reviewed.status,'applied-after-source-and-local-adapter-review');
const root=resolve('.workbench/verification/opencode-application-'+dirname(recordFile).split('application-').at(-1));
assert.ok(root.startsWith(resolve('.workbench/verification')+'/opencode-application-'));
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),output=resolve('test-results/dev-workbench-v2/p5/generated-local-'+stamp);mkdirSync(output,{recursive:true});
const scratch=mkdtempSync(join(tmpdir(),'workbench-generated-runtime-')),token=randomUUID();writeFileSync(join(scratch,'owner.json'),JSON.stringify({kind:'generated-runtime-verifier',token}));
let modelRequests=0;const disabled=createServer((req,res)=>{if(req.url?.includes('/v1/'))modelRequests++;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"model disabled in local verification"}');});disabled.listen(0,'127.0.0.1');await once(disabled,'listening');const address=disabled.address();assert.ok(address&&typeof address!=='string');
const loopback='http://127.0.0.1:'+address.port;process.env.DEEPSEEK_API_KEY='local-only-disabled';process.env.DEEPSEEK_BASE_URL=loopback;process.env.WORKBENCH_OFFLINE='1';process.env.OTEL_EXPORTER_OTLP_ENDPOINT=loopback;
const wb=createWorkbench({root,codingEngine:{kind:'disabled-generated-runtime-check',async run(){throw Error('No new generation');}}});const server=wb.app.listen(0,'127.0.0.1');await once(server,'listening');const http=server.address();assert.ok(http&&typeof http!=='string');const base='http://127.0.0.1:'+http.port;let closed=false,standalone:RunningJava|undefined;
const evidence:Record<string,any>={scope:'actual OpenCode generated revision, offline saved-project Java build, technical export and independent Java asset bootstrap; no business model',reviewedSource:reviewed,modelRequests:0};
const safe=(text:string)=>text.replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]');
async function digest(file:string){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
async function close(){if(closed)return;await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();closed=true;}
async function call(path:string,method='GET',body?:unknown,expected=200){const response=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const result=await response.json() as any;assert.equal(response.status,expected,JSON.stringify(result));return result;}
try{
 const project=(await call('/projects/'+reviewed.projectId));assert.equal(project.project.head,reviewed.appliedHead);assert.ok(project.definition.skills.length);assert.equal(wb.jobs.get(reviewed.jobId,'application').status,'applied');
 const existing=(await call('/projects/'+reviewed.projectId+'/runs')).runs;assert.equal(existing.length,0,'Inspect prior original run instead of starting another build');
 let run=(await call('/projects/'+reviewed.projectId+'/runs','POST',{baseHead:reviewed.appliedHead},202)).run;evidence.runId=run.id;console.log(JSON.stringify({status:'building-original-generated-revision',runId:run.id,output}));
 for(let n=0;n<240;n++){run=(await call('/runs/'+run.id)).run;if(!['building','starting'].includes(run.status))break;await delay(1000);}evidence.run=run;assert.equal(run.status,'running',run.error?.message);assert.equal(run.head,reviewed.appliedHead);assert.equal(run.engine,'local-java');assert.equal(modelRequests,0);
 const record=(await call('/projects/'+reviewed.projectId+'/exports','POST',{runId:run.id},201)).export;evidence.export=record;
 const archive=join(scratch,'application.tar.gz');const response=await fetch(base+'/api/exports/'+record.id+'/files/application');assert.equal(response.status,200);assert.ok(response.body);await pipeline(Readable.fromWeb(response.body as any),createWriteStream(archive));assert.equal(await digest(archive),record.artifacts.application.sha256);execFileSync('tar',['-xzf',archive,'-C',scratch]);execFileSync('sh',[join(scratch,'application/verify.sh')]);
 const appdir=join(scratch,'application');assert.equal(await digest(join(appdir,'application.jar')),run.artifact.sha256);assert.deepEqual(JSON.parse(readFileSync(join(appdir,'assets/application.json'),'utf8')),project.definition);
 await close();await assert.rejects(fetch(base+'/api/context',{signal:AbortSignal.timeout(2000)}));evidence.workbenchStopped=true;
 let log='';const engine=new LocalJavaEngine(process.cwd());standalone=await engine.start({directory:join(appdir,'assets'),jar:join(appdir,'application.jar'),stateDirectory:join(scratch,'standalone-state'),runId:'generated-'+run.id,signal:new AbortController().signal,onLog:text=>{log=(log+text).slice(-8_000_000);},onProcess:()=>{}});
 try{
  const healthy=await(await fetch(standalone.origin+'/workbench/application')).json() as any;assert.deepEqual(healthy.definition,project.definition);assert.equal(healthy.mode,'live-java');
  const reserved=await fetch(standalone.origin+'/workbench/conversations',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(reserved.status,200);const empty=await reserved.json() as any;assert.equal(empty.stack.current,null);assert.deepEqual(empty.tasks,[]);assert.equal(modelRequests,0);
  evidence.passed=true;evidence.modelRequests=modelRequests;evidence.independentDefinition=healthy;evidence.emptyConversation=empty;evidence.notVerified=['business LLM routing/confirmation/A2A','full dual-role PC flow','rebuilt-source business'];writeFileSync(join(output,'result.json'),safe(JSON.stringify(evidence,null,2))+'\n');console.log(JSON.stringify({passed:true,sourceHead:run.head,jarSha256:run.artifact.sha256,modelRequests,report:join(output,'result.json')},null,2));
 }finally{await standalone.stop();standalone=undefined;writeFileSync(join(output,'standalone-java.log'),safe(log));}
}catch(error){evidence.error=error instanceof Error?error.message:String(error);evidence.modelRequests=modelRequests;writeFileSync(join(output,'failure.json'),safe(JSON.stringify(evidence,null,2))+'\n');throw error;}
finally{if(standalone)await standalone.stop();await close();await new Promise<void>(r=>disabled.close(()=>r()));const owner=JSON.parse(readFileSync(join(scratch,'owner.json'),'utf8'));if(owner.kind==='generated-runtime-verifier'&&owner.token===token)rmSync(scratch,{recursive:true,force:true});}
