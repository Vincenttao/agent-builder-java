// Opt-in platform-role OpenCode repair from the recorded pre-fix source. No business LLM calls.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ProjectStore} from '../workbench-server/projects.js';
import {CodingJobs} from '../workbench-server/coding.js';
import {OpenCodeEngine} from '../workbench-server/opencode.js';
import {moaTemplateFiles} from '../workbench-server/template.js';
import {settings} from '../workbench-server/settings.js';
const parent=resolve('.workbench/verification');mkdirSync(parent,{recursive:true});assert.ok(readdirSync(parent).filter(p=>p.startsWith('opencode-platform-')).length<2,'Inspect existing platform cases before creating another');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),root=join(parent,'opencode-platform-'+stamp),output=resolve('test-results/dev-workbench-v2/p2/platform-'+stamp);mkdirSync(output,{recursive:true});
const config=settings();assert.ok(config.apiKey);const safe=(v:unknown)=>JSON.stringify(v,null,2).split(config.apiKey).join('[REDACTED]').replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]')+'\n';
const paths=['src/main/java/com/moaagent/agent/skill/NativeSkillAgent.java','src/main/java/com/openjiuwen/workbench/runtime/BusinessHost.java','src/main/resources/prompts/native-skill.md'];
const files=moaTemplateFiles();for(const p of paths)files[p]=execFileSync('git',['show','90a5e82^:runtime-template-java/'+p],{encoding:'utf8',maxBuffer:2_000_000});
const store=new ProjectStore(root),jobs=new CodingJobs(store,new OpenCodeEngine(process.cwd()));let jobId='';const evidence:Record<string,unknown>={scope:'actual platform OpenCode repairs recorded completion guidance/public projection/finish guard; explicit pre-fix source fixture, current tests unchanged, no business model',preFixSource:'90a5e82^',businessModelCalls:0};
try{
 const template=store.seedTemplate(files);evidence.baseHead=template.head;evidence.projectId=template.id;
 const job=await jobs.start(template.id,'platform','先通过 skill 工具读取 moa-platform-development。请修复本 MOA 平台模板中已知的收束规则冲突，修改且只修改以下三文件：src/main/resources/prompts/native-skill.md、src/main/java/com/moaagent/agent/skill/NativeSkillAgent.java、src/main/java/com/openjiuwen/workbench/runtime/BusinessHost.java。基础提示当前“无需调用额外的完成工具”与福利业务Skill的只读查询后finish冲突；公开操作目录缺少terminal；finish可能把空执行包装成功。请读取三文件、SkillSession/SkillActionRail、src/test/java/com/openjiuwen/workbench/BusinessHostTest.java末尾的保护测试，以及本机运行契约。统一修订：公开每个操作真实terminal值；提示按入口Skill和授权terminal路径收束，不发明工具且不自然语言提前结束；在BusinessHost调用finish脚本前，检查当前SkillSession确有已验证结果，或真实confirm_action回执response.approved=false，否则抛VERIFIED_RESULT_REQUIRED。拒绝确认后允许零写入收束；仍保留固定确认、幂等、任务归属、两层及未知回执约束。不要修改测试、POM、开发Skill、业务资产或其他文件，不修改来源记录来伪造上游。特别注意：此前方案在settle中增加requireVerifiedResult并从frame.turn.interrupt().context().confirmation.approved读拒绝，实际37项测试中verifiedConfirmationRejectionMayFinishWithoutAnyBusinessWrite失败（期望COMPLETED，实际FAILED）。不要采用该终态后检查：应在dispatch里SkillScriptRunner guarded=(session,source,input)->的最前面，仅识别finish对应resultScript，脚本执行前读取SkillSession.load(session)；用getResults判断验证结果，用getReceipts中的tool=confirm_action且response.approved=false判断真实拒绝。不要检查模型可控文本或frame.turn的旧中断，也不要改settle来补救。无需提问。使用真实编辑工具，Bash禁止，未运行测试如实注明。请给出冲突来源、影响和修改理由。');jobId=job.id;console.log(JSON.stringify({status:'started',jobId,root,output}));
 let ready=false;for(let n=0;n<450;n++){const current=jobs.get(jobId,'platform');if(current.status==='awaiting_review'){ready=true;break;}if(['failed','cancelled','awaiting_input'].includes(current.status))throw Error('Original job stopped at '+current.status);await delay(1000);}assert.ok(ready,'Original platform task did not reach review');
 const review=jobs.review(jobId,'platform');assert.equal(review.stale,false);assert.equal(store.get(template.id,'platform').head,template.head);assert.deepEqual(Object.keys(review.job.changes).sort(),[...paths].sort());
 assert.match(review.job.changes[paths[0]]!,/terminal/);assert.match(review.job.changes[paths[1]]!,/VERIFIED_RESULT_REQUIRED/);assert.match(review.job.changes[paths[2]]!,/terminal/);
 evidence.jobId=jobId;evidence.review=review;evidence.status='awaiting_source_and_java_review';writeFileSync(join(output,'result.json'),safe(evidence));console.log(JSON.stringify({status:evidence.status,jobId,report:join(output,'result.json')}));
}catch(error){evidence.error=error instanceof Error?error.message:String(error);if(jobId)evidence.job=jobs.get(jobId,'platform');writeFileSync(join(output,'failure.json'),safe(evidence));throw error;}
finally{await jobs.close();store.close();}
