import {checkedRelease} from './fixtures/checked-release.js';
// Opt-in network verification. Never included in the default test glob.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ProjectStore} from '../workbench-server/projects.js';
import {CodingJobs} from '../workbench-server/coding.js';
import {OpenCodeEngine} from '../workbench-server/opencode.js';
import {readTree} from '../workbench-server/app.js';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const root=resolve('.workbench/verification/opencode-'+stamp),output=resolve('test-results/dev-workbench-v2/p2/'+stamp);mkdirSync(output,{recursive:true});
const store=new ProjectStore(root);const template=store.seedTemplate(readTree('templates/moa'));const release=checkedRelease(store,template.id,'platform','1.0.0');const app=store.createApplication(release.id,'真实助手验证应用','application');
const before=store.files(app.id,'application')['instructions.md'];const jobs=new CodingJobs(store,new OpenCodeEngine(process.cwd()));
let passed=false;
try{
 const initial=await jobs.start(app.id,'application','只修改 instructions.md：在原文末尾新增一行“当前服务范围由员工福利应用开发者维护。”。其他文件保持原样。先通过 skill 工具读取 moa-application-development，不要执行 Bash。任务明确，无需提问。');
 console.log('OpenCode live job started:',initial.id);
 for(let n=0;n<450;n++){
  const job=jobs.get(initial.id,'application');
  if(job.status==='awaiting_review'){
   if(store.files(app.id,'application')['instructions.md']!==before)throw new Error('Unreviewed change escaped task workspace');
   await jobs.apply(job.id,'application');const updated=store.files(app.id,'application')['instructions.md'];
   passed=updated.includes('当前服务范围由员工福利应用开发者维护。')&&store.get(app.id,'application').head!==app.head;
   const report={passed,job:jobs.get(job.id,'application'),beforeHead:app.head,afterHead:store.get(app.id,'application').head,scope:'actual OpenCode + DeepSeek Skill read/file edit/review/apply; no business E2E'};
   writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed,jobId:job.id,sessionId:job.sessionId,model:job.model,changes:Object.keys(job.changes),evidence:job.evidence.map(e=>({tool:e.tool,status:e.status,input:e.tool==='skill'?e.input:undefined})),report:join(output,'result.json')},null,2));break;
  }
  if(job.status==='failed'||job.status==='cancelled'){writeFileSync(join(output,'failure.json'),JSON.stringify(job,null,2)+'\n');throw new Error(job.error?.code??job.status);}
  if(job.status==='awaiting_input')throw new Error('Unexpected clarification required: '+job.pendingQuestion?.id);
  await delay(1000);
 }
 if(!passed)throw new Error('Live verification did not reach reviewed application');
}finally{store.close();}
