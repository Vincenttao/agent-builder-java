import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore,WorkbenchError} from '../workbench-server/projects.js';
import {readTree} from '../workbench-server/app.js';
import {CodingJobs,type CodingEngine} from '../workbench-server/coding.js';
function fixture(t:test.TestContext,engine:CodingEngine,omitCacheIgnore=false){
 const root=mkdtempSync(join(tmpdir(),'workbench-coding-'));const store=new ProjectStore(root);const files=readTree('templates/moa');if(omitCacheIgnore)delete files['.opencode/.gitignore'];const template=store.seedTemplate(files);const release=store.publish(template.id,'platform','1.0.0');const a=store.createApplication(release.id,'应用','application');const jobs=new CodingJobs(store,engine);
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});return {store,jobs,a};
}
const engine=(change:(dir:string)=>void):CodingEngine=>({async run(input){change(input.directory);return {sessionId:'real-adapter-fixture',model:'deepseek-flash',summary:'修改业务指令',evidence:[{tool:'skill',status:'completed',input:{name:'moa-application-development'}}]};}});
async function settled(jobs:CodingJobs,id:string){for(let n=0;n<100;n++){const job=jobs.get(id,'application');if(!['running','awaiting_input'].includes(job.status))return job;await new Promise(r=>setTimeout(r,10));}throw new Error('Test job did not settle');}

test('coding changes stay in worktree until review; rejecting or accepting preserves source history',async t=>{
 const {store,jobs,a}=fixture(t,engine(dir=>writeFileSync(join(dir,'instructions.md'),'业务新指令')));
 const original=store.files(a.id,'application')['instructions.md'];
 const job=await jobs.start(a.id,'application','改为福利助手');const completed=await settled(jobs,job.id);
 assert.equal(completed.status,'awaiting_review');assert.equal(completed.changes['instructions.md'],'业务新指令');
 assert.equal(jobs.review(job.id,'application').before['instructions.md'],original);
 await assert.rejects(jobs.apply(job.id,'platform'),(e:unknown)=>e instanceof WorkbenchError&&e.code==='FORBIDDEN');
 assert.equal(store.files(a.id,'application')['instructions.md'],original);
 await jobs.reject(job.id,'application');assert.equal(jobs.get(job.id,'application').status,'rejected');assert.equal(store.get(a.id,'application').head,a.head);
 const next=await jobs.start(a.id,'application','修改业务指令');await settled(jobs,next.id);const applied=await jobs.apply(next.id,'application');
 assert.equal(applied.status,'applied');assert.notEqual(store.get(a.id,'application').head,a.head);assert.equal(store.files(a.id,'application')['instructions.md'],'业务新指令');
});

test('stale suggestions cannot overwrite manual revisions and repeated apply cannot create another revision',async t=>{
 const {store,jobs,a}=fixture(t,engine(dir=>writeFileSync(join(dir,'instructions.md'),'助手建议')));
 const job=await jobs.start(a.id,'application','修改');await settled(jobs,job.id);
 const manual=store.save(a.id,'application',a.head,{'instructions.md':'人工修改'});
 const review=jobs.review(job.id,'application');assert.equal(review.stale,true);assert.equal(review.head,manual.head);assert.notEqual(review.before['instructions.md'],'人工修改');
 await assert.rejects(jobs.apply(job.id,'application'),(e:unknown)=>e instanceof WorkbenchError&&e.code==='REVISION_CONFLICT');
 assert.equal(store.get(a.id,'application').head,manual.head);assert.equal(store.files(a.id,'application')['instructions.md'],'人工修改');
});

test('unapproved paths and missing actual skill evidence fail without changing the project',async t=>{
 const {store,jobs,a}=fixture(t,engine(dir=>writeFileSync(join(dir,'pom.xml'),'override fixed build')));
 const job=await jobs.start(a.id,'application','修改');const result=await settled(jobs,job.id);
 assert.equal(result.status,'failed');assert.equal(result.error?.code,'FORBIDDEN_PATH');assert.equal(store.get(a.id,'application').head,a.head);
 const noSkill=new CodingJobs(store,{async run(input){writeFileSync(join(input.directory,'instructions.md'),'无指导修改');return {sessionId:'fixture',model:'deepseek-flash',summary:'修改',evidence:[]};}});
 const missing=await noSkill.start(a.id,'application','修改');const failed=await settled(noSkill,missing.id);assert.equal(failed.status,'failed');assert.equal(failed.error?.code,'SKILL_NOT_LOADED');
});

test('a failed assistant and concurrent task leave a reviewable failure without another generation',async t=>{
 let release:()=>void=()=>{};let count=0;
 const {store,jobs,a}=fixture(t,{async run(){count++;await new Promise<void>(r=>release=r);throw new Error('model unavailable');}});
 const job=await jobs.start(a.id,'application','修改');
 await assert.rejects(jobs.start(a.id,'application','重复'),(e:unknown)=>e instanceof WorkbenchError&&e.code==='ENGINE_BUSY');
 release();const result=await settled(jobs,job.id);assert.equal(result.status,'failed');assert.equal(count,1);assert.equal(store.get(a.id,'application').head,a.head);
});

test('assistant clarification is routed to its original question and cancellation stops its task',async t=>{
 let resume:(v:unknown)=>void=()=>{};let activeDirectory='';
 const fake:CodingEngine={
  async run(input){activeDirectory=input.directory;input.onEvent({type:'question',id:'que-one',questions:[{question:'是否保留原业务范围？'}]});await new Promise((resolve,reject)=>{resume=resolve;input.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});writeFileSync(join(input.directory,'instructions.md'),'澄清后的指令');return {sessionId:'fixture',model:'deepseek-flash',summary:'修订',evidence:[{tool:'skill',status:'completed',input:{name:input.skill}}]};},
  async answer(directory,id,answers){assert.equal(directory,activeDirectory);assert.equal(id,'que-one');assert.deepEqual(answers,[['保留']]);resume(undefined);}
 };
 const {jobs,a}=fixture(t,fake);const job=await jobs.start(a.id,'application','修订业务范围');assert.equal(jobs.get(job.id,'application').status,'awaiting_input');
 await assert.rejects(jobs.answer(job.id,'application','que-old',[['保留']]),(e:unknown)=>e instanceof WorkbenchError&&e.code==='STALE_QUESTION');
 await jobs.answer(job.id,'application','que-one',[['保留']]);await settled(jobs,job.id);assert.equal(jobs.get(job.id,'application').status,'awaiting_review');await jobs.reject(job.id,'application');
 const next=await jobs.start(a.id,'application','取消任务');await jobs.cancel(next.id,'application');
 for(let n=0;n<100&&jobs.get(next.id,'application').status!=='cancelled';n++)await new Promise(r=>setTimeout(r,10));
 assert.equal(jobs.get(next.id,'application').status,'cancelled');
});

test('OpenCode local dependency cache is excluded without ignoring fixed instructions or forbidden paths',async t=>{
 const {store,jobs,a}=fixture(t,engine(dir=>{
  mkdirSync(join(dir,'.opencode/node_modules/provider'),{recursive:true});writeFileSync(join(dir,'.opencode/node_modules/provider/package.json'),'{}');
  for(const name of ['package.json','package-lock.json','bun.lock'])writeFileSync(join(dir,'.opencode',name),'runtime dependency metadata');
  writeFileSync(join(dir,'instructions.md'),'实际业务修订');
 }));
 const first=await jobs.start(a.id,'application','修订');const result=await settled(jobs,first.id);assert.equal(result.status,'awaiting_review');assert.deepEqual(Object.keys(result.changes),['instructions.md']);await jobs.apply(first.id,'application');
 assert.equal(store.files(a.id,'application')['instructions.md'],'实际业务修订');assert.equal(Object.keys(store.files(a.id,'application')).some(p=>p.includes('node_modules')||p==='.opencode/package.json'),false);
 const protectedJobs=new CodingJobs(store,engine(dir=>{mkdirSync(join(dir,'.opencode/node_modules'),{recursive:true});writeFileSync(join(dir,'.opencode/.gitignore'),'ignore all');writeFileSync(join(dir,'instructions.md'),'cannot escape');}));
 const second=await protectedJobs.start(a.id,'application','不能修改固定忽略规则');const blocked=await settled(protectedJobs,second.id);assert.equal(blocked.status,'failed');assert.equal(blocked.error?.code,'FORBIDDEN_PATH');assert.equal(store.files(a.id,'application')['instructions.md'],'实际业务修订');
});

test('canonical OpenCode cache ignore is excluded only when newly generated',async t=>{
 const canonical='node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore';const {store,jobs,a}=fixture(t,engine(dir=>{mkdirSync(join(dir,'.opencode'),{recursive:true});writeFileSync(join(dir,'.opencode/.gitignore'),canonical);writeFileSync(join(dir,'instructions.md'),'真实业务修改');}),true);
 const job=await jobs.start(a.id,'application','修改业务指导');const result=await settled(jobs,job.id);assert.equal(result.status,'awaiting_review');assert.deepEqual(result.changes,{'instructions.md':'真实业务修改'});await jobs.apply(job.id,'application');assert.equal(Object.hasOwn(store.files(a.id,'application'),'.opencode/.gitignore'),false);
});

test('noncanonical cache ignore cannot bypass application path guards',async t=>{
 const {jobs,a}=fixture(t,engine(dir=>{mkdirSync(join(dir,'.opencode'),{recursive:true});writeFileSync(join(dir,'.opencode/.gitignore'),'*\n');writeFileSync(join(dir,'instructions.md'),'业务修改');}),true);const job=await jobs.start(a.id,'application','修改');const result=await settled(jobs,job.id);assert.equal(result.status,'failed');assert.equal(result.error?.code,'FORBIDDEN_PATH');
});

test('an existing template ignore remains protected even when overwritten with canonical cache text',async t=>{
 const canonical='node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore';const {store,jobs,a}=fixture(t,engine(dir=>{writeFileSync(join(dir,'.opencode/.gitignore'),canonical);writeFileSync(join(dir,'instructions.md'),'业务修改');}));const template=store.get('moa-platform','platform');store.save(template.id,'platform',template.head,{'.opencode/.gitignore':'platform-owned-rule\n'});const release=store.publish(template.id,'platform','2.0.0'),p=store.createApplication(release.id,'保留模板规则','application');const job=await jobs.start(p.id,'application','修改');const result=await settled(jobs,job.id);assert.equal(result.status,'failed');assert.equal(result.error?.code,'FORBIDDEN_PATH');assert.equal(store.files(p.id,'application')['.opencode/.gitignore'],'platform-owned-rule\n');
});
