import {randomUUID} from 'node:crypto';
import {startManagedProcess} from '../processes/supervisor.js';
import type {CommandResult} from '../../../../packages/contracts/src/development.js';
export class EngineeringCommands {
  private active=new Set<ReturnType<typeof startManagedProcess>>();private cancelled=false;
  constructor(private readonly onResult:(result:CommandResult)=>Promise<void>,private readonly limits={timeoutMs:60000,maxOutputBytes:262144}){}
  async run(commandId:string,executable:string,args:string[],cwd:string):Promise<CommandResult>{
    if(this.cancelled)throw new Error('ENGINEERING_CANCELLED');
    const startedAt=new Date().toISOString();let output='';let truncated=false;let timedOut=false;
    const process=startManagedProcess({executable,args,cwd,env:{},secrets:[],onLine:line=>{
      if(Buffer.byteLength(output)+Buffer.byteLength(line)+1<=this.limits.maxOutputBytes)output+=line+'\n';else truncated=true;
    }});this.active.add(process);
    let stopFailure:unknown;const timer=setTimeout(()=>{timedOut=true;void process.stop().catch(error=>{stopFailure=error;});},this.limits.timeoutMs);
    try{const exit=await process.exited;
      const result:CommandResult={id:randomUUID(),commandId,executable,args:[...args],startedAt,finishedAt:new Date().toISOString(),exitCode:exit.code,
        status:this.cancelled?'cancelled':timedOut?'timed_out':exit.code===0?'passed':'failed',output:exit.error??output,truncated};
      if(stopFailure)throw new Error('PROCESS_STOP_UNCONFIRMED');await this.onResult(result);return result;
    }finally{clearTimeout(timer);this.active.delete(process);}
  }
  async cancel(){this.cancelled=true;await Promise.all([...this.active].map(process=>process.stop()));}
}
