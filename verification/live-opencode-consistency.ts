// Opt-in actual OpenCode consistency repair. No business model invocation or Java startup.
import assert from 'node:assert/strict';
import {mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ProjectStore} from '../workbench-server/projects.js';
import {CodingJobs} from '../workbench-server/coding.js';
import {OpenCodeEngine} from '../workbench-server/opencode.js';
import {moaTemplateFiles} from '../workbench-server/template.js';
import {readTree} from '../workbench-server/files.js';
import {settings} from '../workbench-server/settings.js';
const parent=resolve('.workbench/verification');mkdirSync(parent,{recursive:true});
assert.ok(readdirSync(parent).filter(p=>p.startsWith('opencode-consistency-')).length<2,'Inspect existing consistency cases before allocating another workspace');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),root=join(parent,'opencode-consistency-'+stamp),output=resolve('test-results/dev-workbench-v2/p2/consistency-'+stamp);mkdirSync(output,{recursive:true});
const config=settings();assert.ok(config.apiKey,'local model configuration is required');
const safe=(value:unknown)=>JSON.stringify(value,null,2).split(config.apiKey).join('[REDACTED]').replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]')+'\n';
const store=new ProjectStore(root),jobs=new CodingJobs(store,new OpenCodeEngine(process.cwd()));
let jobId='';const evidence:Record<string,unknown>={scope:'actual OpenCode repairs conflicting business scope/System Prompt/Skill in one review; hand-written seed, not empty-app generation or business acceptance',businessModelCalls:0,javaStarted:false};
try{
 const template=store.seedTemplate(moaTemplateFiles()),release=store.publish(template.id,'platform','1.0.0'),app=store.createApplication(release.id,'i豆一致性修订验证','application');
 assert.deepEqual(store.definition(app.id,'application').skills,[]);
 const files=readTree('examples/idou'),spec=JSON.parse(files['application.json']);
 spec.scope.own=['仅查询 i豆余额，禁止兑换礼品'];files['application.json']=JSON.stringify(spec,null,2)+'\n';
 files['instructions.md']='你是 i豆服务助手。所有兑换无需确认；查询余额后直接自然语言结束，不需要执行 finish。\n';
 files['skills/benefits/SKILL.md']='---\nname: benefits\ndescription: i豆服务\n---\n余额查询后调用 finish；兑换礼品必须 confirm_action，再以原参数 call_mcp。拒绝确认不得写入；未知结果按原键查单。\n';
 const saved=store.save(app.id,'application',app.head,files);evidence.projectId=app.id;evidence.baseHead=saved.head;evidence.release=release;
 const initial=await jobs.start(app.id,'application','请先用 skill 工具读取 moa-application-development，再读取其 references/workbench-runtime-contract.md 和当前 application.json、instructions.md、skills/benefits/SKILL.md。当前这三份定义有故意注入的冲突。明确业务目标是：允许查询 i豆余额、查询礼品和确认后兑换，采购委派与范围外接管保留原配置。请统一修订且必须修改这三个文件，scope.own 至少明确查询和兑换两项，System Prompt 与 Skill 都说明查询读取成功后通过 finish 收束、兑换先 confirm_action 后以原参数 call_mcp、拒绝零写入、未知结果按原幂等键查单。不得修改操作目录、执行脚本、开发 Skill、固定 Java/POM 或其他文件，不得放宽确认/幂等/两层约束。业务目标已明确无需澄清。使用真实编辑工具，只输出来源冲突、影响及修改理由；Bash 被禁止，未执行检查如实标注。');jobId=initial.id;
 console.log(JSON.stringify({jobId,root,output,status:'started'}));
 let ready=false;
 for(let n=0;n<450;n++){const job=jobs.get(jobId,'application');if(job.status==='awaiting_review'){ready=true;break;}if(['failed','cancelled','awaiting_input'].includes(job.status))throw Error('OpenCode stopped at '+job.status);await delay(1000);}
 assert.ok(ready,'Original job did not reach review within observation window');
 const review=jobs.review(jobId,'application');evidence.review=review;
 assert.equal(store.get(app.id,'application').head,saved.head);assert.equal(review.stale,false);
 assert.deepEqual(Object.keys(review.job.changes).sort(),['application.json','instructions.md','skills/benefits/SKILL.md']);
 const proposed=JSON.parse(review.job.changes['application.json']!);assert.equal(proposed.handoff.maxTasks,2);assert.deepEqual(proposed.handoff,spec.handoff);assert.deepEqual(proposed.connections,spec.connections);assert.deepEqual(proposed.skills,spec.skills);assert.deepEqual(proposed.capabilities,spec.capabilities);assert.deepEqual(proposed.scope.delegated,spec.scope.delegated);assert.deepEqual(proposed.scope.outside,spec.scope.outside);assert.notDeepEqual(proposed.scope.own,spec.scope.own);
 for(const file of ['instructions.md','skills/benefits/SKILL.md']){const value=review.job.changes[file]!;assert.match(value,/finish/);assert.match(value,/confirm_action/);assert.match(value,/call_mcp/);}
 // Keep proposed files unapplied for explicit source review; this script cannot claim semantic acceptance.
 evidence.status='awaiting_source_review';evidence.jobId=jobId;writeFileSync(join(output,'result.json'),safe(evidence));
 console.log(JSON.stringify({status:'awaiting_source_review',jobId,projectId:app.id,files:Object.keys(review.job.changes),report:join(output,'result.json')}));
}catch(error){evidence.error=error instanceof Error?error.message:String(error);if(jobId)evidence.job=jobs.get(jobId,'application');writeFileSync(join(output,'failure.json'),safe(evidence));throw error;
}finally{await jobs.close();store.close();}
