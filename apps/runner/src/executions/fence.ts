import{mkdir,readdir,readFile,writeFile,rename}from'node:fs/promises';
import{join}from'node:path';import{randomUUID}from'node:crypto';import{RunnerError}from'../runtime/deployment-manager.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validToken=(token:string)=>/^[1-9]\d{0,18}$/.test(token)&&BigInt(token)<=9223372036854775807n;
interface State{token:string;retired:boolean}
export class ExecutionFence {
  private states=new Map<string,State>();private pending=new Map<string,Promise<unknown>>();
  constructor(private readonly root:string){}
  async initialize(){
    await mkdir(this.root,{recursive:true});
    for(const name of await readdir(this.root)){
      if(!name.endsWith('.json'))continue;const id=name.slice(0,-5);if(!uuid.test(id))throw new RunnerError('EXECUTION_FENCE_CORRUPT',503);
      const value=JSON.parse(await readFile(join(this.root,name),'utf8')) as State;
      if(typeof value.token!=='string'||!validToken(value.token)||typeof value.retired!=='boolean')throw new RunnerError('EXECUTION_FENCE_CORRUPT',503);
      this.states.set(id,value);
    }
  }
  private serial<T>(id:string,body:()=>Promise<T>):Promise<T>{
    if(!uuid.test(id))return Promise.reject(new RunnerError('INVALID_EXECUTION_ID',422));
    const work=(this.pending.get(id)??Promise.resolve()).catch(()=>{}).then(body);this.pending.set(id,work);
    void work.finally(()=>{if(this.pending.get(id)===work)this.pending.delete(id);}).catch(()=>{});return work;
  }
  private async save(id:string,value:State){
    const path=join(this.root,`${id}.json`);const tmp=`${path}.${randomUUID()}.tmp`;await writeFile(tmp,JSON.stringify(value));await rename(tmp,path);this.states.set(id,value);
  }
  async claim(id:string,token:string):Promise<State>{
    if(!validToken(token))throw new RunnerError('INVALID_EXECUTION_TOKEN',422);
    return this.serial(id,async()=>{const current=this.states.get(id);if(current&&BigInt(token)<BigInt(current.token))throw new RunnerError('EXECUTION_CLAIM_LOST');
      const value={token,retired:current?.retired??false};if(current?.token!==token)await this.save(id,value);return{...value};});
  }
  async command<T>(id:string,token:string|undefined,kind:'start'|'resume'|'cancel',body:()=>Promise<T>):Promise<T>{
    return this.serial(id,async()=>{
      const current=this.states.get(id);
      // Direct legacy probes may have no worker. HTTP platform commands require a token.
      if(current||token!==undefined){
        if(!current||current.token!==token)throw new RunnerError('EXECUTION_CLAIM_LOST');
        if(current.retired&&kind!=='cancel')throw new RunnerError('EXECUTION_RETIRED');
        if(kind==='cancel'&&!current.retired)await this.save(id,{...current,retired:true});
      }
      return body();
    });
  }
}
