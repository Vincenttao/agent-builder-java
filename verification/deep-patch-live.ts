// Explicit actual-model probe of the saved business-test service; uses a hand-written sample, not Coding generation.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkbench,readTree} from '../workbench-server/app.js';
import {LocalJavaEngine} from '../workbench-server/local-java.js';
import {checkedRelease} from './fixtures/checked-release.js';
import {settings} from '../workbench-server/settings.js';

assert.equal(process.env.GAP_DEEP_PATCH_LIVE,'1','Explicit opt-in required');
const config=settings(),parent=resolve('.workbench/verification');assert.equal(new URL(config.baseUrl).hostname,'api.deepseek.com');assert.ok(config.apiKey);mkdirSync(parent,{recursive:true});assert.ok(readdirSync(parent).filter(n=>n.startsWith('gap-deep-patch-')).length<2,'Review existing owned patch evidence before allocating another workspace');
const root=mkdtempSync(join(parent,'gap-deep-patch-')),out=resolve('test-results',root.split('/').at(-1)!);mkdirSync(out,{recursive:true});writeFileSync(join(root,'owner.json'),JSON.stringify({kind:'deep-patch-live',purpose:'synthetic strict replacement via saved business tests',retention:'at most two workspaces; do not delete unreviewed evidence'}));
const native=new LocalJavaEngine(process.cwd()),javaSource:Record<string,string>={...Object.fromEntries(Object.entries(readTree('runtime-deepagent-java/src')).map(([p,text])=>['src/'+p,text])),'pom.xml':readFileSync('runtime-deepagent-java/pom.xml','utf8')},jar=resolve('runtime-deepagent-java/target/deepagent-business-application-2.0.0.jar'),hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex'),jarSha=hash(readFileSync(jar));
const wb=createWorkbench({root,runEngine:{kind:native.kind,configure:native.configure.bind(native),async build(input){const files=readTree(input.directory);for(const p of Object.keys(files).filter(p=>p==='pom.xml'||p.startsWith('src/')))assert.equal(files[p],javaSource[p],'Compiled Java source differs: '+p);assert.equal(hash(readFileSync(jar)),jarSha);const target=join(input.directory,'target');mkdirSync(target);const copied=join(target,'application.jar');copyFileSync(jar,copied);input.onLog('Reuse freshly tested DeepAgent JAR; every Java/POM input compared to current compiled sources.');return {jar:copied};},start:native.start.bind(native)}});
const result:any={scope:'real Java + configured model; hand-written sample; strict original-character preservation; not Coding generation or enterprise acceptance',root,out,jarSha256:jarSha,startedAt:new Date().toISOString(),model:config.model};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(result,null,2).split(config.apiKey).join('[REDACTED]')+'\n');
try{
 const release=checkedRelease(wb.store,'deepagent-platform','platform','1.0.0'),created=wb.store.createApplication(release.id,'严格局部修改验证','application');wb.store.save(created.id,'application',created.head,readTree('examples/deepagent-materials'));const p=wb.store.get(created.id,'application');result.projectId=p.id;result.head=p.head;save();
 const started=await wb.runs.start(p.id,'application',p.head);result.runId=started.id;save();console.log(JSON.stringify({root,out,stage:'starting-real-java',runId:started.id}));
 for(let n=0;n<240&&['building','starting'].includes(wb.runs.get(started.id,'application').status);n++)await new Promise(r=>setTimeout(r,500));assert.equal(wb.runs.get(started.id,'application').status,'running');
 const test=await wb.businessTests.start(p.id,'application',{baseHead:p.head,runId:started.id});result.testId=test.id;save();console.log(JSON.stringify({stage:'real-model-business-test',testId:test.id}));
 for(let n=0;n<900;n++){result.report=wb.businessTests.get(test.id,'application');save();if(!['running','cancelling'].includes(result.report.status))break;await new Promise(r=>setTimeout(r,1000));}
 assert.equal(result.report.status,'passed',JSON.stringify({error:result.report.error,cases:result.report.cases}));assert.equal(result.report.verification,'java-model-files');assert.ok(result.report.cases[0].assertions.some((a:any)=>a.operator==='sameExcept'&&a.passed));
 const run=wb.runs.get(started.id,'application'),view=await wb.runs.conversation(run.id,'application',run.conversations[0]);result.view=view;assert.ok(view.events.some((e:any)=>e.type==='artifact_patched'));result.status='passed';save();console.log(JSON.stringify({status:result.status,report:join(out,'report.json')}));
}catch(error){result.status='failed';result.error=error instanceof Error?error.message:String(error);save();throw error;}finally{await wb.close();if(result.runId)result.run=wb.runs.get(result.runId,'application');save();wb.store.close();}
