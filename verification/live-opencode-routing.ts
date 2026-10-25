// Actual platform Coding repair driven by the recorded real-model routing failure. No business calls.
import assert from 'node:assert/strict';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ProjectStore} from '../workbench-server/projects.js';
import {CodingJobs} from '../workbench-server/coding.js';
import {OpenCodeEngine} from '../workbench-server/opencode.js';
import {moaTemplateFiles} from '../workbench-server/template.js';
import {settings} from '../workbench-server/settings.js';
const config=settings();assert.ok(config.apiKey);assert.equal(new URL(config.baseUrl).hostname,'api.deepseek.com');
const parent=resolve('.workbench/verification');mkdirSync(parent,{recursive:true});assert.ok(readdirSync(parent).filter(n=>n.startsWith('opencode-routing-')).length<2,'Inspect prior routing repair cases before another allocation');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),root=join(parent,'opencode-routing-'+stamp),output=resolve('test-results/dev-workbench-v2/p2/routing-'+stamp);mkdirSync(output,{recursive:true});
const original=new ProjectStore(resolve('.workbench/verification/opencode-application-2026-10-25T02-14-32-049Z'));let source:Record<string,string>;
try{assert.equal(original.get('5185fb26-2148-47fc-adb4-e7278d25f4d7','application').head,'bce1f59ce64f02ef31e557bf7b528190045a23e0');source=original.files('5185fb26-2148-47fc-adb4-e7278d25f4d7','application');}finally{original.close();}
const files=moaTemplateFiles();for(const name of ['application.json','instructions.md','skills/benefits/SKILL.md'])files['runtime-tests/failures/idou/'+name]=source[name];
const failure=JSON.parse(readFileSync('test-results/dev-workbench-v2/p5/generated-business-2026-10-25T02-45-42-846Z/failure.json','utf8'));
files['runtime-tests/failures/idou/observed-failure.json']=JSON.stringify({sourceHead:failure.sourceHead,scope:'recorded real Flash failure, not a new business template',observation:failure.recentObservations.at(-1)},null,2)+'\n';
const store=new ProjectStore(root),jobs=new CodingJobs(store,new OpenCodeEngine(process.cwd()));let jobId='';const record:Record<string,unknown>={scope:'actual OpenCode repairs router vs task-switch phase contract from real failed run; no business LLM validation yet',failureSource:'p5/generated-business-2026-10-25T02-45-42-846Z'};
try{
 const template=store.seedTemplate(files);record.baseHead=template.head;
 const job=await jobs.start(template.id,'platform','先用skill工具读取moa-platform-development。请修复 runtime-tests/failures/idou/observed-failure.json 中真实模型误判，读取同目录 application.json、instructions.md、skills/benefits/SKILL.md，以及固定源码 LlmRouter.java、BusinessHost.java、TaskShelf.java 相关流程和现有路由测试。合法场景：A正在等待兑换确认；用户明确提出新的采购需求。路由模型错误认为缺少保留/放弃决定构成规则冲突，返回CONFLICT，导致宿主根本没机会询问。这里的业务定义本身并不矛盾。请修改且仅修改 src/main/java/com/openjiuwen/workbench/runtime/LlmRouter.java 的模型提示/必要路由上下文，以及 .opencode/skills/moa-application-development/references/workbench-runtime-contract.md 的阶段说明。明确路由只判断业务归属和候选目标，正常返回DELEGATE等不等于立即调用；未完成任务的保留/询问/放弃决定由BusinessHost/TaskShelf后续强制执行，不要求用户在提出新业务的同一句话已提供切换选择，不把这一缺失当CLARIFY或CONFLICT。原任务补参与确认仍CONTINUE；真实业务范围/Prompt/Skill矛盾仍CONFLICT，信息不清仍CLARIFY；不能只因存在当前等待点就判冲突，也不得授权绕过确认或直接调用新Agent。不要硬编码采购或示例query关键词，不修改验证逻辑、测试、BusinessHost/TaskShelf、失败夹具、业务资产或POM。此前源审阅发现新增routingContext把scope.own/delegated/outside这些List传给Json.object，Json.object(List)会返回空对象，丢失真实业务范围；若新增这一投影，必须原样保留List，不能把数组转Map，也不要硬编码业务示例。基础模板仍空白MOA。Bash禁止，未运行检查如实说明。使用真实编辑工具给出统一修订及理由。');jobId=job.id;console.log(JSON.stringify({status:'started',jobId,root,output}));
 let ready=false;for(let n=0;n<450;n++){const current=jobs.get(jobId,'platform');if(current.status==='awaiting_review'){ready=true;break;}if(['failed','cancelled','awaiting_input'].includes(current.status))throw Error('Original task stopped at '+current.status);await delay(1000);}assert.ok(ready,'Original routing repair did not reach review');
 const review=jobs.review(jobId,'platform');assert.equal(review.stale,false);assert.equal(store.get(template.id,'platform').head,template.head);assert.deepEqual(Object.keys(review.job.changes).sort(),['src/main/java/com/openjiuwen/workbench/runtime/LlmRouter.java','.opencode/skills/moa-application-development/references/workbench-runtime-contract.md'].sort());
 record.jobId=jobId;record.review=review;record.status='awaiting_source_review';writeFileSync(join(output,'result.json'),JSON.stringify(record,null,2).split(config.apiKey).join('[REDACTED]')+'\n');console.log(JSON.stringify({status:record.status,jobId,report:join(output,'result.json')}));
}catch(error){record.error=error instanceof Error?error.message:String(error);if(jobId)record.job=jobs.get(jobId,'platform');writeFileSync(join(output,'failure.json'),JSON.stringify(record,null,2).split(config.apiKey).join('[REDACTED]')+'\n');throw error;}
finally{await jobs.close();store.close();}
