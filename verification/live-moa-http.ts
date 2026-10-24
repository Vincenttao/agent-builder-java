// Opt-in model + independent Mock integration, deliberately excluded from *.test.ts.
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {settings} from '../workbench-server/settings.js';
const config=settings();if(!config.apiKey)throw new Error('DEEPSEEK_API_KEY missing');
const output=resolve('test-results/dev-workbench-v2/p3/moa-http-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(output,{recursive:true});
const safe=(text:string)=>text.split(config.apiKey).join('[REDACTED]');
const childCode=`import {createBusinessMock} from './mock-business/server.ts';const server=createBusinessMock().listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));process.once('SIGTERM',()=>server.close(()=>process.exit(0)));process.once('disconnect',()=>server.close(()=>process.exit(0)));`;
const mock=spawn(process.execPath,['--import','tsx','--input-type=module','-e',childCode],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe','ipc']});
let java:ChildProcess|undefined;
async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);try{await done;}finally{clearTimeout(timer);}}
async function command(name:string,args:string[],env:NodeJS.ProcessEnv,log:string,timeout:number){
 const child=spawn(name,args,{env,stdio:['ignore','pipe','pipe']});java=child;let text='';
 const collect=(chunk:Buffer)=>{text+=chunk.toString();if(text.length>12_000_000)child.kill('SIGKILL');};child.stdout.on('data',collect);child.stderr.on('data',collect);
 const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
 try{const [code,signal]=await once(child,'exit');writeFileSync(join(output,log),safe(text));assert.equal(code,0,`Command failed (${signal??code}); inspect ${join(output,log)}`);}finally{clearTimeout(timer);}
}
try{
 const address=await Promise.race([once(mock,'message').then(([v])=>v as {port:number}),once(mock,'exit').then(()=>{throw new Error('Mock exited before readiness');}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Mock startup timeout')),10000).unref())]);
 const base=`http://127.0.0.1:${address.port}`;
 await command(resolve('.tools/apache-maven-3.9.11/bin/mvn'),['-o','-B','-ntp','-f','runtime-template-java/pom.xml','-DskipTests','test-compile','dependency:build-classpath','-Dmdep.outputFile=target/classpath.txt'],process.env,'build.log',90000);
 const module=resolve('runtime-template-java');const classpath=[join(module,'target/test-classes'),join(module,'target/classes'),readFileSync(join(module,'target/classpath.txt'),'utf8').trim()].join(':');
 await command('java',['-Xmx768m','-cp',classpath,'com.openjiuwen.workbench.LiveMoaProbe',output,'http',base],{...process.env,DEEPSEEK_API_KEY:config.apiKey},'java.log',150000);
 const probe=JSON.parse(readFileSync(join(output,'live-moa-probe.json'),'utf8'));
 const state=await (await fetch(base+'/__mock/state')).json() as any;
 assert.equal(probe.passed,true);assert.equal(probe.fixtureModel,false);assert.equal(probe.businessHttp,true);assert.ok(probe.modelCalls>0);assert.equal(probe.verifiedToolCalls,1);
 assert.equal(state.calls.filter((c:any)=>c.operation==='balance').length,1);assert.equal(state.writes,0);
 const traceResponse=await fetch('http://127.0.0.1:16686/api/v3/traces/'+probe.traceId);assert.equal(traceResponse.status,200);
 const trace=await traceResponse.text();assert.ok(trace.includes('workbench-moa-probe'));writeFileSync(join(output,'trace.json'),safe(trace));
 const report={passed:true,scope:probe.scope,model:'deepseek-flash',modelCalls:probe.modelCalls,externalState:state,traceId:probe.traceId,traceRetrieved:true,remaining:'confirmation/redemption, task execution host, PC UI and independent export not covered'};
 writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,report:join(output,'result.json')},null,2));
}catch(error){writeFileSync(join(output,'failure.json'),JSON.stringify({passed:false,error:safe(error instanceof Error?error.message:String(error))},null,2)+'\n');throw error;
}finally{if(java)await stop(java);await stop(mock);}
