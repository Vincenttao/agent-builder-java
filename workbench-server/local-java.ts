import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {readFileSync,existsSync,readdirSync,realpathSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {settings} from './settings.js';
import {WorkbenchError} from './projects.js';
export type OwnedProcess={pid:number;started:string;marker:string;kind:'build'|'java'};
export type ProcessExit={code:number|null;signal:string|null};
export type RunningJava={origin:string;process?:OwnedProcess;exited:Promise<ProcessExit>;stop:()=>Promise<void>};
export type EngineInput={directory:string;runId:string;signal:AbortSignal;onLog:(text:string)=>void;onProcess:(process:OwnedProcess)=>void};
export interface RunEngine{
 readonly kind:string;
 build(input:EngineInput):Promise<{jar:string}>;
 start(input:EngineInput&{jar:string;stateDirectory:string}):Promise<RunningJava>;
}
export function sanitize(text:string){return text.replace(/sk-[a-zA-Z0-9_-]{20,}/g,'[REDACTED]');}
function processStart(pid:number){try{const value=readFileSync(`/proc/${pid}/stat`,'utf8');return value.slice(value.lastIndexOf(')')+2).trim().split(/\s+/)[19];}catch{return undefined;}}
export function ownsProcess(info:OwnedProcess){try{return processStart(info.pid)===info.started&&readFileSync(`/proc/${info.pid}/cmdline`,'utf8').split('\0').includes(info.marker);}catch{return false;}}
export async function stopOwnedProcess(info:OwnedProcess){
 if(!ownsProcess(info))throw new WorkbenchError('PROCESS_IDENTITY_CHANGED','原进程已退出或身份变化；不会停止其他进程',409);
 process.kill(-info.pid,'SIGTERM');
 for(let n=0;n<30;n++){if(!ownsProcess(info))return;await new Promise(r=>setTimeout(r,100));}
 if(ownsProcess(info))process.kill(-info.pid,'SIGKILL');
 for(let n=0;n<20;n++){if(!ownsProcess(info))return;await new Promise(r=>setTimeout(r,100));}
 throw new WorkbenchError('PROCESS_STILL_RUNNING','原 Java 进程尚未停止，请核对后再操作',409);
}
function environment(){const env:NodeJS.ProcessEnv={};for(const field of ['PATH','HOME','JAVA_HOME','LANG','TMPDIR'])if(process.env[field])env[field]=process.env[field];return env;}
function child(input:EngineInput,program:string,args:string[],env:NodeJS.ProcessEnv,kind:OwnedProcess['kind']){
 const marker=`-Dworkbench.runId=${input.runId}`;
 const processHandle=spawn(program,args,{cwd:input.directory,env,detached:true,stdio:['ignore','pipe','pipe']});
 let closed=false,stopping=false,tail='';let killTimer:ReturnType<typeof setTimeout>|undefined;
 const signal=()=>{if(closed||stopping)return;stopping=true;if(processHandle.pid){try{process.kill(-processHandle.pid,'SIGTERM');}catch{}killTimer=setTimeout(()=>{if(!closed)try{process.kill(-processHandle.pid!,'SIGKILL');}catch{}},3000);}};
 const publish=(line:string)=>{const text=sanitize(line);tail=(tail+text).slice(-200000);input.onLog(text);};
 const streams=[processHandle.stdout,processHandle.stderr].map(stream=>{
  const decoder=new StringDecoder('utf8');let buffered='',omitted=false;
  const receive=(text:string)=>{
   buffered+=text;let newline:number;
   while((newline=buffered.search(/[\r\n]/))>=0){const line=buffered.slice(0,newline);buffered=buffered.slice(newline+1);publish(omitted?'[console line omitted: exceeded 64KB]\n':line+'\n');omitted=false;}
   if(buffered.length>65536){buffered='';omitted=true;}
  };
  stream.on('data',(data:Buffer)=>receive(decoder.write(data)));
  return ()=>{receive(decoder.end());if(buffered||omitted)publish(omitted?'[console line omitted: exceeded 64KB]\n':buffered);};
 });
 const exited=new Promise<ProcessExit>((done)=>{
  processHandle.once('error',()=>input.onLog('无法启动本机 '+kind+' 进程；请检查工具路径。'));
  processHandle.once('close',(code,signalCode)=>{for(const flush of streams)flush();closed=true;input.signal.removeEventListener('abort',signal);if(killTimer)clearTimeout(killTimer);done({code,signal:signalCode});});
 });
 input.signal.addEventListener('abort',signal,{once:true});if(input.signal.aborted)signal();
 if(processHandle.pid){const started=processStart(processHandle.pid);if(started)input.onProcess({pid:processHandle.pid,started,marker,kind});}
 return {exited,stop:async()=>{signal();await exited;},tail:()=>tail,identity:()=>{const pid=processHandle.pid;const started=pid&&processStart(pid);return pid&&started?{pid,started,marker,kind}:undefined;},closed:()=>closed};
}
export class LocalJavaEngine implements RunEngine{
 readonly kind='local-java';
 constructor(private repository:string){}
 async build(input:EngineInput){
  const installed=join(this.repository,'.tools/apache-maven-3.9.11/bin/mvn');const binary=process.env.MAVEN_BIN??(existsSync(installed)?installed:'mvn');
  const args=['-B','-ntp',...(process.env.WORKBENCH_OFFLINE==='1'?['-o']:[]),'-Dworkbench.runId='+input.runId,'package'];
  const execution=child(input,binary,args,environment(),'build');const timer=setTimeout(()=>void execution.stop(),180000);
  try{const result=await execution.exited;if(input.signal.aborted)throw new WorkbenchError('RUN_CANCELLED','构建已取消');if(result.code!==0)throw new WorkbenchError('BUILD_FAILED','Java 构建未通过，请查看本次日志');}
  finally{clearTimeout(timer);}
  const target=join(input.directory,'target');const jars=readdirSync(target).filter(name=>name.endsWith('.jar'));
  if(jars.length!==1)throw new WorkbenchError('ARTIFACT_INVALID','构建必须产生一个可执行 JAR');
  const jar=realpathSync(join(target,jars[0]));if(relative(realpathSync(input.directory),jar).startsWith('..'))throw new WorkbenchError('ARTIFACT_INVALID','构建产物越出本次工程');return {jar};
 }
 async start(input:EngineInput&{jar:string;stateDirectory:string}){
  const config=settings(this.repository);if(!config.apiKey)throw new WorkbenchError('MODEL_KEY_MISSING','请在本机私有配置中设置 DEEPSEEK_API_KEY');
  const env={...environment(),DEEPSEEK_API_KEY:config.apiKey,DEEPSEEK_BASE_URL:config.baseUrl,WORKBENCH_APP_DIR:input.directory,WORKBENCH_STATE_DIR:input.stateDirectory,OTEL_EXPORTER_OTLP_ENDPOINT:process.env.OTEL_EXPORTER_OTLP_ENDPOINT??'http://127.0.0.1:14318'};
  const execution=child(input,process.env.JAVA_BIN??'java',['-Xmx768m','-Dworkbench.runId='+input.runId,'-jar',resolve(input.jar),'--server.port=0','--server.address=127.0.0.1'],env,'java');
  try{
   for(let n=0;n<180;n++){
    if(input.signal.aborted)throw new WorkbenchError('RUN_CANCELLED','启动已取消');if(execution.closed())throw new WorkbenchError('JAVA_START_FAILED','Java 服务启动失败，请查看本次日志');
    const port=execution.tail().match(/Tomcat started on port (\d+)/)?.[1];
    if(port){const origin='http://127.0.0.1:'+port;try{const response=await fetch(origin+'/workbench/application',{signal:AbortSignal.timeout(2000)});const data=await response.json() as any;if(response.ok&&data.runId===input.runId&&data.mode==='live-java')return {origin,process:execution.identity(),exited:execution.exited,stop:execution.stop};}catch{}}
    await new Promise(r=>setTimeout(r,500));
   }
   throw new WorkbenchError('JAVA_START_TIMEOUT','原 Java 启动未就绪；请查看该运行记录，不会重复启动');
  }catch(error){await execution.stop();throw error;}
 }
}
