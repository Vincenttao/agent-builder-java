// Export the final PC-verified run through the browser; validate its independent binary without rebuilding.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
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
const input=JSON.parse(readFileSync(resolve(process.argv[2]??''),'utf8'));assert.equal(input.passed,true);const root=resolve(input.workspaceRoot);assert.ok(root.startsWith(resolve('.workbench/verification')+'/opencode-refusal-'));assert.equal(input.run.head,input.correctedHead);
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),output=resolve('test-results/dev-workbench-v2/p5/final-pc-delivery-'+stamp);mkdirSync(output,{recursive:true});const scratch=mkdtempSync(join(tmpdir(),'workbench-generated-business-')),token=randomUUID();writeFileSync(join(scratch,'owner.json'),JSON.stringify({kind:'generated-business-verifier',token}));
const safe=(value:unknown)=>JSON.stringify(value,null,2).split(config.apiKey).join('[REDACTED]').replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]')+'\n';
const wb=createWorkbench({root,codingEngine:{async run(){throw Error('No generation during business verification');}}});let closed=false,java:RunningJava|undefined,mock:import('node:http').Server|undefined,javaLog='';
const evidence:Record<string,any>={scope:'final PC revision, actual browser export/download verification, workbench closed, independent Flash/MOA/HTTP/A2A; no rebuild',workspaceRoot:root,sourceHead:input.correctedHead,projectId:input.projectId,runId:input.run.id,originalJarSha256:input.run.artifact.sha256,pcEvidence:resolve(process.argv[2]),model:config.model,destination:'api.deepseek.com',traces:[]};
async function close(){if(closed)return;await wb.close();wb.store.close();closed=true;}
async function digest(path:string){const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);return hash.digest('hex');}
try{
 assert.equal((await fetch('http://127.0.0.1:16686/api/v3/services',{signal:AbortSignal.timeout(3000)})).status,200,'Existing Jaeger required');
 mock=createBusinessMock().listen(8770,'127.0.0.1');await once(mock,'listening');const mockBase='http://127.0.0.1:8770';
 const original=wb.runs.get(input.run.id,'application');assert.equal(original.status,'stopped');assert.equal(original.head,input.correctedHead);assert.equal(wb.store.get(original.projectId,'application').head,original.head);evidence.run=original;
 const server=wb.app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+address.port);const project=wb.store.get(input.projectId,'application');await page.locator('section.panel').filter({has:page.getByRole('heading',{name:project.name,exact:true})}).getByRole('button',{name:'进入工程'}).click();await page.getByRole('button',{name:'版本与导出',exact:true}).click();await page.getByLabel('交付来源运行').selectOption(original.id);
 const pending=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/exports'),{timeout:120000});await page.getByRole('button',{name:'导出所选运行',exact:true}).click();const response=await pending;assert.equal(response.status(),201);const exported=(await response.json()).export;assert.equal(exported.runId,original.id);assert.equal(exported.head,input.correctedHead);evidence.export=exported;
 const card=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'交付版本 '+original.head.slice(0,12)+' · 包格式 v'+exported.formatVersion,exact:true})});await card.getByRole('link',{name:'下载应用包',exact:true}).waitFor();for(const [kind,label]of [['application','下载应用包'],['source','下载源码包']]){const pendingDownload=page.waitForEvent('download');await card.getByRole('link',{name:label,exact:true}).click();const file=await(await pendingDownload).path();assert.ok(file);assert.equal(await digest(file),exported.artifacts[kind].sha256);}evidence.browserDownloadsVerified=true;assert.deepEqual(errors,[]);await page.screenshot({path:join(output,'final-export.png'),fullPage:true});
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
 const archive=await wb.exports.file(evidence.export.id,'application','application');assert.equal(archive.artifact.sha256,evidence.export.artifacts.application.sha256);
 await promisify(execFile)('tar',['-xzf',archive.path,'-C',scratch]);const app=join(scratch,'application');await promisify(execFile)('sh',['verify.sh'],{cwd:app});assert.equal(await digest(join(app,'application.jar')),original.artifact!.sha256);const definition=JSON.parse(readFileSync(join(app,'assets/application.json'),'utf8'));assert.equal(definition.mapping.balancePath,'employee.wallet.availablePoints');await close();evidence.workbenchClosed=true;evidence.workbenchStopped=true;
 console.log(JSON.stringify({status:'starting-exported-generated-application',sourceHead:original.head,output}));
 java=await new LocalJavaEngine(process.cwd()).start({directory:join(app,'assets'),jar:join(app,'application.jar'),stateDirectory:join(scratch,'state'),runId:'live-generated-'+original.id,signal:new AbortController().signal,onLog:text=>{javaLog=(javaLog+text).slice(-8_000_000);},onProcess:()=>{}});
 evidence.independentDefinition=await(await fetch(java.origin+'/workbench/application')).json();assert.deepEqual(evidence.independentDefinition.definition,definition);
 evidence.business=await verifyStandaloneBusiness(java.origin,mockBase,value=>{evidence.recentObservations??=[];evidence.recentObservations.push(value);if(evidence.recentObservations.length>8)evidence.recentObservations.shift();writeFileSync(join(output,'progress.json'),safe({sourceHead:evidence.sourceHead,exportId:evidence.export.id,recentObservations:evidence.recentObservations}));});
 for(const id of evidence.business.traceIds){assert.match(id,/^[a-f0-9]{32}$/i);let found='';for(let n=0;n<8;n++){const response=await fetch('http://127.0.0.1:16686/api/v3/traces/'+id);if(response.ok){found=await response.text();if(found.includes('moa-business-application'))break;}await delay(250);}assert.ok(found.includes('moa-business-application'),'Trace missing '+id);writeFileSync(join(output,'trace-'+id+'.json'),found.split(config.apiKey).join('[REDACTED]'));evidence.traces.push(id);}
 evidence.passed=true;writeFileSync(join(output,'result.json'),safe(evidence));console.log(JSON.stringify({passed:true,checks:evidence.business.checks,writes:evidence.business.external.writes,a2aCalls:evidence.business.external.a2aCalls.length,traces:evidence.traces,report:join(output,'result.json')},null,2));
}catch(error){evidence.error=error instanceof Error?error.message:String(error);try{if(mock?.listening)evidence.external=await(await fetch('http://127.0.0.1:8770/__mock/state')).json();}catch{}writeFileSync(join(output,'failure.json'),safe(evidence));throw Error('Generated business verification failed; inspect '+output);}
finally{if(java)await java.stop();writeFileSync(join(output,'java.log'),javaLog.split(config.apiKey).join('[REDACTED]'));await close();if(mock?.listening)await new Promise<void>(r=>mock!.close(()=>r()));const owner=JSON.parse(readFileSync(join(scratch,'owner.json'),'utf8'));if(owner.kind==='generated-business-verifier'&&owner.token===token)rmSync(scratch,{recursive:true,force:true});}
