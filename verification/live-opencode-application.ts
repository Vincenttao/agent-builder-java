// Opt-in actual empty-MOA application development. Does not run the business model.
import assert from 'node:assert/strict';
import {mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ProjectStore} from '../workbench-server/projects.js';
import {CodingJobs} from '../workbench-server/coding.js';
import {OpenCodeEngine} from '../workbench-server/opencode.js';
import {moaTemplateFiles} from '../workbench-server/template.js';
import {settings} from '../workbench-server/settings.js';
const parent=resolve('.workbench/verification');mkdirSync(parent,{recursive:true});assert.ok(readdirSync(parent).filter(p=>p.startsWith('opencode-application-')).length<2,'Inspect existing application cases before another allocation');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),root=join(parent,'opencode-application-'+stamp),output=resolve('test-results/dev-workbench-v2/p2/application-'+stamp);mkdirSync(output,{recursive:true});
const config=settings();assert.ok(config.apiKey);const safe=(v:unknown)=>JSON.stringify(v,null,2).split(config.apiKey).join('[REDACTED]').replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]')+'\n';
const store=new ProjectStore(root),jobs=new CodingJobs(store,new OpenCodeEngine(process.cwd()));let jobId='';
const evidence:Record<string,unknown>={scope:'actual OpenCode develops i豆 assets in initially empty MOA application, using shipped hand-written test contracts as reference; no business execution',businessModelCalls:0};
try{
 const template=store.seedTemplate(moaTemplateFiles());const changed=store.save(template.id,'platform',template.head,{'RUNTIME.md':store.files(template.id,'platform')['RUNTIME.md']+'\n本次平台发行支持员工福利业务在应用层开发，不预置业务。\n'});const release=store.publish(template.id,'platform','1.0.0'),app=store.createApplication(release.id,'i豆服务助手','application');const before=store.files(app.id,'application');
 assert.deepEqual(store.definition(app.id,'application').skills,[]);assert.deepEqual(store.definition(app.id,'application').scope.own,[]);assert.equal(release.commit,changed.head);
 evidence.projectId=app.id;evidence.baseHead=app.head;evidence.release=release;evidence.initialBusinessEmpty=true;
 const prompt='请先使用 skill 工具读取 moa-application-development，然后读取其 references/workbench-runtime-contract.md。你正在一个从 MOA 发行版本新建的空应用内，请实际开发 i豆服务助手：自己处理余额、礼品目录和确认兑换，采购申请委派 procurement，明确人事政策等范围外交给 fallback。连接固定为 idou=http://127.0.0.1:8770、procurement=http://127.0.0.1:8770/a2a/procurement、fallback=http://127.0.0.1:8770/a2a/fallback。最多两层A/B、原任务未完成先问用户、B结束提示复核A，写入仍须新确认。业务目标与地址已明确无需澄清。请通过实际文件工具编辑 application.json、instructions.md，创建 skills/benefits/SKILL.md、adapters/operations.json 以及所需 Python 脚本。模板 runtime-tests/fixtures/idou/ 是可读取的手写集成测试契约参考，可以参考其中已验证的操作/脚本格式来装配本应用，但不要修改或把它当作已装配业务、不要复制整个测试目录。操作集合应包括 balance/gifts/redeem/receipt/finish，余额映射 employee.wallet.availablePoints。余额/目录查询后finish；兑换先confirm_action再原参数call_mcp；拒绝后零写入并正确收束；未知结果原键查单；固定员工demo、确认、幂等不可放宽。不修改固定Java/POM/开发Skill及测试夹具。Bash被禁止，未运行检查如实注明，最后给出修改理由和文件清单。';
 const job=await jobs.start(app.id,'application',prompt);jobId=job.id;console.log(JSON.stringify({status:'started',jobId,root,output}));
 let ready=false;for(let n=0;n<450;n++){const current=jobs.get(jobId,'application');if(current.status==='awaiting_review'){ready=true;break;}if(['failed','cancelled','awaiting_input'].includes(current.status))throw Error('Original job stopped at '+current.status);await delay(1000);}assert.ok(ready,'Original job did not reach review');
 const review=jobs.review(jobId,'application');evidence.review=review;assert.equal(review.stale,false);assert.equal(store.get(app.id,'application').head,app.head);assert.deepEqual(store.definition(app.id,'application').skills,[]);
 const files={...before,...review.job.changes};const spec=JSON.parse(files['application.json']!);assert.equal(spec.handoff.maxTasks,2);assert.equal(spec.mapping.balancePath,'employee.wallet.availablePoints');assert.equal(spec.handoff.unfinished,'ask');assert.equal(spec.handoff.resume,'prompt');assert.equal(spec.handoff.target,'fallback');
 assert.ok(spec.skills.length);assert.ok(spec.scope.own.length);assert.ok(spec.scope.delegated.length);assert.ok(spec.scope.outside.length);
 assert.ok(files['adapters/operations.json'],'OpenCode proposal is incomplete: adapters/operations.json missing; do not apply');const ops=JSON.parse(files['adapters/operations.json']!);for(const op of ['balance','gifts','redeem','receipt','finish']){assert.ok(ops[op]);assert.ok(files['skills/'+ops[op].resultScript]);}assert.equal(ops.redeem.confirmationRequired,true);assert.equal(ops.redeem.fixedArguments.employeeId,'demo');
 assert.deepEqual(spec.connections,{idou:'http://127.0.0.1:8770',procurement:'http://127.0.0.1:8770/a2a/procurement',fallback:'http://127.0.0.1:8770/a2a/fallback'});
 evidence.jobId=jobId;evidence.status='awaiting_source_review';writeFileSync(join(output,'result.json'),safe(evidence));console.log(JSON.stringify({status:'awaiting_source_review',jobId,projectId:app.id,files:Object.keys(review.job.changes),report:join(output,'result.json')}));
}catch(error){evidence.error=error instanceof Error?error.message:String(error);if(jobId)evidence.job=jobs.get(jobId,'application');writeFileSync(join(output,'failure.json'),safe(evidence));throw error;}
finally{await jobs.close();store.close();}
