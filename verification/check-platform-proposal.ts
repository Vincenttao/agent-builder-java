// Local compilation of an unapplied actual platform OpenCode proposal. No model requests.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProjectStore,validateFiles} from '../workbench-server/projects.js';
const recordFile=resolve(process.argv[2]??''),report=JSON.parse(readFileSync(recordFile,'utf8'));assert.equal(report.status,'awaiting_source_and_java_review');
const root=resolve('.workbench/verification/opencode-platform-'+dirname(recordFile).split('platform-').at(-1));assert.ok(root.startsWith(resolve('.workbench/verification')+'/opencode-platform-'));
const store=new ProjectStore(root);let files:Record<string,string>;
try{const job=report.review.job;assert.equal(job.role,'platform');assert.equal(job.engineKind,'opencode');assert.equal(store.get(job.projectId,'platform').head,job.baseHead);const base=store.snapshot(job.projectId,job.baseHead);files={...base,...job.changes};validateFiles(files);}finally{store.close();}
const build=join(root,'review-build');assert.equal(existsSync(build),false,'Original review build exists; inspect it instead of rebuilding');mkdirSync(build);
for(const [path,text]of Object.entries(files)){if(path.startsWith('.opencode/'))continue;const to=join(build,path);mkdirSync(dirname(to),{recursive:true});writeFileSync(to,text);}
const command=resolve('.tools/apache-maven-3.9.11/bin/mvn');const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',...(process.env.JAVA_HOME?{JAVA_HOME:process.env.JAVA_HOME}:{})};
try{
 const {stdout,stderr}=await promisify(execFile)(command,['-o','-B','-ntp','test'],{cwd:build,env,timeout:180000,maxBuffer:8_000_000});writeFileSync(join(dirname(recordFile),'java-review.log'),stdout+stderr);assert.match(stdout,/BUILD SUCCESS/);
 const result={scope:'compile actual platform OpenCode changes with unchanged deterministic Java tests, local endpoints only; no business model',sourceJob:report.jobId,sourceSession:report.review.job.sessionId,passed:true,tests:stdout.match(/Tests run: \d+, Failures: 0, Errors: 0, Skipped: 0/g)?.at(-1),modelCalls:0};writeFileSync(join(dirname(recordFile),'java-review.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(error){const failure=error as Error&{stdout?:string;stderr?:string};writeFileSync(join(dirname(recordFile),'java-review-failure.log'),failure.stdout??'');writeFileSync(join(dirname(recordFile),'java-review-failure.json'),JSON.stringify({passed:false,error:failure.message,sourceJob:report.jobId},null,2)+'\n');throw new Error('Platform proposal Java checks failed; inspect saved failure log');}
