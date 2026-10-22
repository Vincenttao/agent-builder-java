import type {EngineeringTaskInput,EngineeringTaskRecord,CommandResult} from '../../../../packages/contracts/src/development.js';
import type {TaskExecutor} from './task-executor.js';
import type {EngineeringEvent} from '../../../../packages/contracts/src/development.js';
import {mkdir,readFile,writeFile,rename,readdir,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {canonicalJson} from '../../../../packages/contracts/src/canonical.js';
import {generationProfile,validateGenerationRequest,PolicyError} from './profile.js';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const terminal=new Set(['built','failed','cancelled']);
type Entry={record:EngineeringTaskRecord;input:EngineeringTaskInput;writing:Promise<void>;sequence:number};
export class EngineeringTaskManager {
 private entries=new Map<string,Entry>();private retired=new Set<string>();private queue:Promise<unknown>=Promise.resolve();private closed=false;
 private active:{id:string;executor:TaskExecutor;promise:Promise<void>}|undefined;
 constructor(private readonly root:string,private readonly factory:(root:string)=>TaskExecutor){}
 private serial<T>(body:()=>Promise<T>):Promise<T>{const value=this.queue.then(body);this.queue=value.catch(()=>{});return value;}
 private directory(id:string){if(!uuid.test(id))throw new PolicyError('INVALID_ENGINEERING_ID');return resolve(this.root,'tasks',id);}
 private async persist(entry:Entry){entry.record.updatedAt=new Date().toISOString();const data=JSON.stringify(entry.record,null,2);entry.writing=entry.writing.then(async()=>{const target=join(this.directory(entry.record.id),'state.json');const temp=`${target}.${randomUUID()}.tmp`;await writeFile(temp,data);await rename(temp,target);});await entry.writing;}
 async initialize():Promise<void>{
  await mkdir(join(this.root,'tasks'),{recursive:true});await mkdir(join(this.root,'retired'),{recursive:true});
  for(const file of await readdir(join(this.root,'retired')))if(file.endsWith('.json')&&uuid.test(file.slice(0,-5)))this.retired.add(file.slice(0,-5));
  for(const id of await readdir(join(this.root,'tasks'))){if(!uuid.test(id))continue;
   let record:EngineeringTaskRecord;try{record=JSON.parse(await readFile(join(this.directory(id),'state.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
   const input=JSON.parse(await readFile(join(this.directory(id),'input.json'),'utf8')) as EngineeringTaskInput;
   if(record.id!==id||record.inputDigest!==hash(input))throw new PolicyError('ENGINEERING_STATE_MISMATCH');
   const events=await this.events(id);const entry:Entry={record,input,writing:Promise.resolve(),sequence:events.at(-1)?.sequence??0};this.entries.set(id,entry);
   if(['running','cancelling'].includes(record.status)){record.status='reconciling';record.diagnostic='ENGINE_TASK_REQUIRES_RECONCILIATION';await this.persist(entry);}
   if(record.status==='queued'&&record.profileDigest!==hash(generationProfile)){record.status='failed';record.diagnostic='ENGINEERING_PROFILE_CHANGED';await this.persist(entry);}
  }
 }
 async submit(id:string,input:EngineeringTaskInput):Promise<EngineeringTaskRecord>{return this.serial(async()=>{
  this.directory(id);if(this.closed)throw new PolicyError('ENGINEERING_CLOSED');if(this.retired.has(id))throw new PolicyError('ENGINEERING_TASK_RETIRED');
  const old=this.entries.get(id);if(old){if(old.record.inputDigest!==hash(input))throw new PolicyError('ENGINEERING_INPUT_CONFLICT');return structuredClone(old.record);}
  validateGenerationRequest(input.generation);if(!Number.isInteger(input.maxSeconds)||input.maxSeconds<5||input.maxSeconds>generationProfile.maxTaskSeconds)throw new PolicyError('ENGINEERING_BUDGET_INVALID');
  if([...this.entries.values()].filter(entry=>!terminal.has(entry.record.status)).length>=4)throw new PolicyError('ENGINEERING_QUEUE_LIMIT');
  const now=new Date().toISOString();const record:EngineeringTaskRecord={id,inputDigest:hash(input),profileDigest:hash(generationProfile),status:'queued',createdAt:now,updatedAt:now,roles:[{role:'tester',status:'queued'},{role:'developer',status:'queued'}]};
  const directory=this.directory(id);await mkdir(directory,{recursive:true});
  try{await writeFile(join(directory,'input.json'),JSON.stringify(input),{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||hash(JSON.parse(await readFile(join(directory,'input.json'),'utf8')))!==record.inputDigest)throw new PolicyError('ENGINEERING_INPUT_CONFLICT');}
  const entry:Entry={record,input:structuredClone(input),writing:Promise.resolve(),sequence:0};await this.persist(entry);this.entries.set(id,entry);return structuredClone(record);
 });}
 async get(id:string):Promise<EngineeringTaskRecord>{this.directory(id);const entry=this.entries.get(id);if(!entry)throw new PolicyError('ENGINEERING_NOT_FOUND');return structuredClone(entry.record);}
 async builtBundle(id:string,expectedDigest:string){
  const record=await this.get(id);if(record.status!=='built'||!record.bundle)throw new PolicyError('GENERATED_BUNDLE_MISSING');
  const bundle=record.bundle;const{digest,...body}=bundle;const input=this.entries.get(id)!.input;
  if(digest!==expectedDigest||hash(body)!==digest||hash(input)!==record.inputDigest||bundle.snapshotId!==input.context.snapshotId||bundle.baselineId!==input.context.baseline.id||bundle.baselineDigest!==input.context.baseline.digest)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
  if(hash(bundle.repair??null)!==hash(input.context.repair?.reference??null)||input.context.repair&&bundle.planDigest!==input.context.repair.bundle.planDigest)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
  const directory=join(this.directory(id),'workspace','bundles',digest);
  if(hash(JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')))!==hash(bundle))throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
  return{bundle,directory};
 }
 async file(id:string,path:string):Promise<{path:string;digest:string;content:string}>{
  const record=await this.get(id);const allowed=[...generationProfile.developerFiles,...generationProfile.repair.regressionFiles,'test-plan.json'] as readonly string[];
  if(!allowed.includes(path))throw new PolicyError('FILE_OPERATION_NOT_ALLOWED');
  if(record.status!=='built'||!record.bundle)throw new PolicyError('GENERATED_BUNDLE_MISSING');
  const manifest=record.bundle;const{digest,...body}=manifest;if(hash(body)!==digest)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
  const file=manifest.files.find(file=>file.path===path);if(!file)throw new PolicyError('FILE_OPERATION_NOT_ALLOWED');
  const content=await readFile(join(this.directory(id),'workspace','bundles',manifest.digest,path),'utf8');
  if(createHash('sha256').update(content).digest('hex')!==file.digest||Buffer.byteLength(content)!==file.size)throw new PolicyError('GENERATED_BUNDLE_MISMATCH');
  return{path,digest:file.digest,content};
 }
 async command(id:string,commandId:string):Promise<CommandResult>{
  await this.get(id);if(!uuid.test(commandId))throw new PolicyError('INVALID_ENGINEERING_ID');
  try{const record=JSON.parse(await readFile(join(this.directory(id),'workspace','control','commands',`${commandId}.json`),'utf8')) as CommandResult;
   if(record.id!==commandId)throw new PolicyError('COMMAND_EVIDENCE_MISMATCH');return record;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new PolicyError('ENGINEERING_EVIDENCE_NOT_FOUND');throw error;}
 }
 async events(id:string,after=0):Promise<EngineeringEvent[]>{
  let text:string;try{text=await readFile(join(this.directory(id),'events.jsonl'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error;}
  return text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as EngineeringEvent).filter(event=>event.sequence>after).slice(0,500);
 }
 async tick():Promise<void>{await this.serial(async()=>{
  if(this.active||this.closed||[...this.entries.values()].some(entry=>entry.record.status==='reconciling'))return;
  const entry=[...this.entries.values()].find(entry=>entry.record.status==='queued');if(!entry)return;
  entry.record.status='running';await this.persist(entry);const id=entry.record.id;const executor=this.factory(join(this.directory(id),'workspace'));
  const timer=setTimeout(()=>{void this.cancel(id,true).catch(()=>{});},entry.input.maxSeconds*1000);timer.unref();
  const promise=executor.run(entry.input,async event=>{
    const value={...event,subjectId:id,sequence:++entry.sequence};await appendFile(join(this.directory(id),'events.jsonl'),JSON.stringify(value)+'\n');
   },async(role,status,sessionId)=>{const item=entry.record.roles.find(item=>item.role===role)!;item.status=status;if(sessionId)item.sessionId=sessionId;await this.persist(entry);})
   .then(async bundle=>{if(entry.record.status==='running'){entry.record.bundle=bundle;entry.record.status='built';await this.persist(entry);}})
   .catch(async error=>{if(entry.record.status==='running'){entry.record.status=error instanceof PolicyError&&error.code==='ENGINEERING_STOP_UNCONFIRMED'?'reconciling':'failed';entry.record.diagnostic=error instanceof PolicyError?error.code:'ENGINEERING_EXECUTION_FAILED';await this.persist(entry);}})
   .finally(()=>{clearTimeout(timer);if(this.active?.id===id)this.active=undefined;});
  this.active={id,executor,promise};
 });}
 async cancel(id:string,budgetExceeded=false):Promise<{id:string;status:string}>{
  const active=await this.serial(async()=>{
   this.directory(id);this.retired.add(id);await writeFile(join(this.root,'retired',`${id}.json`),JSON.stringify({id,retired:true}));
   const entry=this.entries.get(id);if(!entry||terminal.has(entry.record.status)||entry.record.status==='reconciling')return undefined;
   if(entry.record.status==='queued'){entry.record.status='cancelled';await this.persist(entry);return undefined;}
   entry.record.status='cancelling';if(budgetExceeded)entry.record.diagnostic='ENGINEERING_BUDGET_EXCEEDED';await this.persist(entry);return this.active?.id===id?this.active:undefined;
  });
  if(active){
   const entry=this.entries.get(id)!;
   try{await active.executor.cancel();await active.promise;await this.serial(async()=>{if(entry.record.status==='cancelling'){entry.record.status=entry.record.diagnostic==='ENGINEERING_BUDGET_EXCEEDED'?'failed':'cancelled';for(const role of entry.record.roles){if(role.status==='running')role.status='cancelled';else if(role.status==='queued')role.status='skipped';}await this.persist(entry);}});}
   catch{await this.serial(async()=>{if(!terminal.has(entry.record.status)){entry.record.status='reconciling';entry.record.diagnostic='ENGINEERING_STOP_UNCONFIRMED';await this.persist(entry);}});}
  }
  return{id,status:this.entries.get(id)?.record.status??'cancelled'};
 }
 async close():Promise<void>{this.closed=true;if(this.active)await this.cancel(this.active.id);await Promise.all([...this.entries.values()].map(entry=>entry.writing));}
}
