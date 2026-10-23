import type {Pool} from 'pg';
import type {SnapshotService} from '../snapshots/application/snapshot-service.js';
import type {BaselineService} from '../acceptance/application/baseline-service.js';
import type {DevelopmentInput,DevelopmentJob,EngineeringTaskInput,EngineeringTaskRecord,EngineeringEvent,CommandResult} from '../../../../packages/contracts/src/development.js';
import {randomUUID} from 'node:crypto';
import {contentDigest} from '../snapshots/domain/assembly.js';
import {AppError} from '../shared/errors.js';
import {wealthBalanceGenerationRequest,wealthAssistantGenerationRequest,generationImplementationError} from '../../../../packages/contracts/src/generation-profile.js';
import {DependencyError} from '../runs/http-ports.js';
import {prepareRepair,type RepairSources} from './repair-input.js';
import type {PortableDevelopmentJob} from '../../../../packages/contracts/src/project-package.js';
export interface EngineeringPort {
 submit(id:string,input:EngineeringTaskInput):Promise<EngineeringTaskRecord>;
 get(id:string):Promise<EngineeringTaskRecord>;
 cancel(id:string):Promise<{id:string;status:string}>;
 events(id:string,after:number):Promise<EngineeringEvent[]>;
 file?(id:string,path:string):Promise<{path:string;digest:string;content:string}>;
 command?(id:string,commandId:string):Promise<CommandResult>;
}
export class DevelopmentService {
 private working=false;
 constructor(private pool:Pool,private snapshots:SnapshotService,private baselines:BaselineService,private runner:EngineeringPort,private repairSources?:RepairSources){}
 async start(snapshotId:string,input:DevelopmentInput):Promise<DevelopmentJob>{
  if(!Number.isInteger(input.maxSeconds)||input.maxSeconds<5||input.maxSeconds>900)throw new AppError('ENGINEERING_BUDGET_INVALID','开发时限应为 5～900 秒',422);
  const findExisting=async(db:Pick<Pool,'query'>)=>{
   const row=(await db.query<{record:DevelopmentJob;task_input:EngineeringTaskInput}>('SELECT record,task_input FROM development_jobs WHERE snapshot_id=$1 AND client_request_id=$2',[snapshotId,input.clientRequestId])).rows[0];
   if(!row)return;
   const saved={baselineId:row.task_input.context.baseline.id,generation:row.task_input.generation,maxSeconds:row.task_input.maxSeconds,...(row.task_input.context.repair?{repairExecutionId:row.task_input.context.repair.reference.executionId}:{})};
   const{clientRequestId:_request,...requested}=input;
   if(contentDigest(saved)!==contentDigest(requested))throw new AppError('DEVELOPMENT_INPUT_CONFLICT','同一开发请求已绑定其他内容',409);return row.record;
  };
  const existing=await findExisting(this.pool);if(existing)return existing;
  const snapshot=await this.snapshots.get(snapshotId);const baseline=await this.baselines.assertTarget(input.baselineId,snapshot);
  const requiredBaseline=([wealthBalanceGenerationRequest.profileVersion,wealthAssistantGenerationRequest.profileVersion] as string[]).includes(input.generation.profileVersion)?'wealth-balance-read@1':'equipment-read@1';
  if(baseline.content.templateId!==requiredBaseline)throw new AppError('GENERATION_BASELINE_UNSUPPORTED',`当前生成规格需要 ${requiredBaseline} 验收基线`,422);
  const task:EngineeringTaskInput={context:{snapshotId,baseline,goal:snapshot.content.draft.brief.goal.value,runtimeSpec:snapshot.content.runtimeSpec},generation:input.generation,maxSeconds:input.maxSeconds};
  const policy=generationImplementationError(input.generation);
  if(input.repairExecutionId)task.context.repair=await prepareRepair(this.pool,this.runner,this.repairSources,input.repairExecutionId,snapshot,baseline);
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');const repair=task.context.repair;
   if(repair){
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`repair:${repair.reference.rootJobId}`]);
    const old=await findExisting(client);if(old){await client.query('COMMIT');return old;}
    const attempts=(await client.query<{record:DevelopmentJob}>("SELECT record FROM development_jobs WHERE task_input #>> '{context,repair,reference,rootJobId}'=$1",[repair.reference.rootJobId])).rows;
    if(attempts.some(a=>!['built','failed','cancelled'].includes(a.record.status)))throw new AppError('REPAIR_ALREADY_ACTIVE','此开发任务已有修复尝试正在执行',409);
    if(attempts.length>=3)throw new AppError('REPAIR_BUDGET_EXCEEDED','已达到三次修复上限，全部尝试记录已保留',409);
    repair.reference.attempt=attempts.length+1;
   }
   const inputDigest=contentDigest(task),now=new Date().toISOString();
   const record:DevelopmentJob={id:randomUUID(),agentId:snapshot.draftId,snapshotId,baselineId:baseline.id,baselineDigest:baseline.digest,inputDigest,status:policy?'failed':'queued',createdAt:now,updatedAt:now,roles:[{role:'tester',status:policy?'skipped':repair?'reused':'queued'},{role:'developer',status:policy?'skipped':'queued'}],...(policy?{diagnostic:policy}:{}),...(repair?{repair:repair.reference}:{})};
   const inserted=await client.query('INSERT INTO development_jobs(id,draft_id,snapshot_id,baseline_id,client_request_id,input_digest,task_input,record) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(snapshot_id,client_request_id) DO NOTHING',[record.id,record.agentId,snapshotId,baseline.id,input.clientRequestId,inputDigest,task,record]);
   if(policy&&inserted.rowCount){
    const event:EngineeringEvent={sequence:1,occurredAt:now,subjectId:record.id,role:null,type:'policy.rejected',data:{code:policy,stage:'generation-admission'}};
    await client.query('INSERT INTO development_events(job_id,seq,record) VALUES($1,$2,$3)',[record.id,event.sequence,event]);
   }
   const saved=await findExisting(client);await client.query('COMMIT');return saved!;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async get(id:string):Promise<DevelopmentJob>{
  const row=(await this.pool.query<{record:DevelopmentJob}>('SELECT record FROM development_jobs WHERE id=$1',[id])).rows[0];
  if(!row)throw new AppError('DEVELOPMENT_NOT_FOUND','开发任务不存在',404);return row.record;
 }
 async list(agentId:string):Promise<DevelopmentJob[]>{return(await this.pool.query<{record:DevelopmentJob}>("SELECT record FROM development_jobs WHERE draft_id=$1 ORDER BY record->>'createdAt' DESC LIMIT 100",[agentId])).rows.map(row=>row.record);}
 async exportProject(agentId:string):Promise<PortableDevelopmentJob[]>{
  const rows=(await this.pool.query<{record:DevelopmentJob;task_input:EngineeringTaskInput}>("SELECT record,task_input FROM development_jobs WHERE draft_id=$1 AND record->>'status'='built' ORDER BY record->>'createdAt' DESC LIMIT 100",[agentId])).rows;
  const result:PortableDevelopmentJob[]=[];
  for(const row of rows){const job=row.record;if(!job.bundle)throw new AppError('PROJECT_EXPORT_INCOMPLETE','已构建开发任务缺少固定 Bundle',409);
   const snapshot=await this.snapshots.get(job.snapshotId);if(snapshot.draftId!==agentId||snapshot.id!==job.snapshotId||job.bundle.snapshotId!==job.snapshotId)throw new AppError('PROJECT_EXPORT_INTEGRITY_ERROR','生成任务快照与项目不匹配',409);
   const files=[];for(const descriptor of job.bundle.files.filter(file=>file.path!=='component.jar')){const file=await this.file(job.id,descriptor.path);if(file.digest!==descriptor.digest)throw new AppError('PROJECT_EXPORT_INTEGRITY_ERROR','生成源码摘要不匹配',409);files.push(file);}
   result.push({id:job.id,snapshotId:job.snapshotId,snapshotDigest:snapshot.digest,baselineId:job.baselineId,baselineDigest:job.baselineDigest,inputDigest:job.inputDigest,status:'built',generation:structuredClone(row.task_input.generation),bundle:structuredClone(job.bundle),files});
  }
  return result;
 }
 async events(id:string,after=0):Promise<EngineeringEvent[]>{await this.get(id);return(await this.pool.query<{record:EngineeringEvent}>('SELECT record FROM development_events WHERE job_id=$1 AND seq>$2 ORDER BY seq LIMIT 500',[id,after])).rows.map(row=>row.record);}
 async file(id:string,path:string){const job=await this.get(id);if(job.status!=='built'||!job.bundle?.files.some(file=>file.path===path&&path!=='component.jar'))throw new AppError('GENERATED_FILE_UNAVAILABLE','此任务没有可审阅的固定文件',409);
  if(!this.runner.file)throw new AppError('ENGINEERING_UNAVAILABLE','生成文件读取不可用',503);return this.runner.file(id,path);}
 async command(id:string,commandId:string){await this.get(id);if(!this.runner.command)throw new AppError('ENGINEERING_UNAVAILABLE','执行证据读取不可用',503);return this.runner.command(id,commandId);}
 async cancel(id:string):Promise<DevelopmentJob>{
  await this.pool.query("UPDATE development_jobs SET record=jsonb_set(jsonb_set(record,'{status}','\"cancelling\"'),'{updatedAt}',to_jsonb($2::text)),revision=revision+1 WHERE id=$1 AND record->>'status' NOT IN ('built','failed','cancelled','cancelling')",[id,new Date().toISOString()]);return this.get(id);
 }
 async tick():Promise<void>{
  if(this.working)return;this.working=true;
  try{
   const rows=(await this.pool.query<{id:string;record:DevelopmentJob;task_input:EngineeringTaskInput;revision:string}>("SELECT id,record,task_input,revision FROM development_jobs WHERE record->>'status' NOT IN ('built','failed','cancelled') ORDER BY record->>'createdAt' LIMIT 10")).rows;
   for(const row of rows){
    const next=structuredClone(row.record);
    try{
     if(row.record.status==='cancelling'){
      const result=await this.runner.cancel(row.id);if(result.id!==row.id)throw new Error('MISMATCH');
      if(result.status==='cancelled'){
       try{
        const actual=await this.runner.get(row.id);this.merge(next,actual,row.task_input);
        if(actual.status!=='cancelled'){next.status='cancelling';next.diagnostic='ENGINEERING_CANCEL_STATUS_MISMATCH';}
       }catch(error){
        if(error instanceof DependencyError&&error.code==='ENGINEERING_NOT_FOUND'||error instanceof Error&&'code' in error&&error.code==='ENGINEERING_NOT_FOUND'){
         next.status='cancelled';next.roles=next.roles.map(role=>role.status==='queued'?{...role,status:'skipped'}:role);delete next.diagnostic;
        }else throw error;
       }
      }
      else if(result.status==='built'||result.status==='failed'){const actual=await this.runner.get(row.id);this.merge(next,actual,row.task_input);}
      else next.diagnostic='ENGINEERING_STOP_UNCONFIRMED';
     }else{
      const result=row.record.status==='queued'?await this.runner.submit(row.id,row.task_input):await this.runner.get(row.id);
      this.merge(next,result,row.task_input);
     }
     const cursor=(await this.pool.query<{seq:number}>('SELECT COALESCE(MAX(seq),0)::integer AS seq FROM development_events WHERE job_id=$1',[row.id])).rows[0]!.seq;
     for(const event of await this.runner.events(row.id,cursor)){
      if(event.subjectId!==row.id||!Number.isInteger(event.sequence)||event.sequence<=cursor)throw new Error('MISMATCH');
      const inserted=await this.pool.query('INSERT INTO development_events(job_id,seq,record) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,event.sequence,event]);
      if(!inserted.rowCount){const old=(await this.pool.query<{record:EngineeringEvent}>('SELECT record FROM development_events WHERE job_id=$1 AND seq=$2',[row.id,event.sequence])).rows[0]!.record;if(contentDigest(old)!==contentDigest(event))throw new Error('MISMATCH');}
     }
     next.updatedAt=new Date().toISOString();await this.pool.query('UPDATE development_jobs SET record=$2,revision=revision+1 WHERE id=$1 AND revision=$3',[row.id,next,row.revision]);
    }catch(error){
     if(error instanceof AppError&&error.code==='ENGINEERING_BINDING_MISMATCH'){
      next.status=row.record.status==='cancelling'?'cancelling':'reconciling';next.diagnostic=error.code;delete next.bundle;
      await this.pool.query('UPDATE development_jobs SET record=$2,revision=revision+1 WHERE id=$1 AND revision=$3',[row.id,next,row.revision]);
     }else if(error instanceof DependencyError&&row.record.status==='queued'){
      if(['ENGINE_MODEL_NOT_CONFIGURED','GENERATION_PROFILE_UNSUPPORTED','GENERATION_SCOPE_UNSUPPORTED','DEPENDENCY_NOT_ALLOWED','BUSINESS_CONNECTION_NOT_ALLOWED','ENGINEERING_BUDGET_INVALID'].includes(error.code))next.status='failed';
      else if(error.code==='ENGINEERING_TASK_RETIRED')next.status='cancelled';
      else if(error.code==='ENGINEERING_INPUT_CONFLICT')next.status='reconciling';
      next.diagnostic=error.code;next.updatedAt=new Date().toISOString();
      await this.pool.query('UPDATE development_jobs SET record=$2,revision=revision+1 WHERE id=$1 AND revision=$3',[row.id,next,row.revision]);
     }
     // Unknown delivery/connection results are retried with the same immutable job ID.
    }
   }
  }finally{this.working=false;}
 }
 private merge(target:DevelopmentJob,remote:EngineeringTaskRecord,input:EngineeringTaskInput){
  const invalid=()=>{throw new AppError('ENGINEERING_BINDING_MISMATCH','执行器记录与固定开发输入不一致',409);};
  if(remote.id!==target.id||remote.inputDigest!==target.inputDigest||!['queued','running','cancelling','cancelled','failed','reconciling','built'].includes(remote.status))invalid();
  if(remote.status==='built'){
   if(!remote.bundle)invalid();const bundle=remote.bundle!;const{digest,...body}=bundle;
   if(contentDigest(body)!==digest||bundle.snapshotId!==target.snapshotId||bundle.baselineId!==target.baselineId||bundle.baselineDigest!==target.baselineDigest||bundle.profileDigest!==remote.profileDigest||contentDigest(input)!==remote.inputDigest)invalid();
   if(contentDigest(bundle.repair??null)!==contentDigest(input.context.repair?.reference??null)||input.context.repair&&bundle.planDigest!==input.context.repair.bundle.planDigest)invalid();
   target.bundle=bundle;
  }
  target.status=remote.status;target.roles=remote.roles;if(remote.diagnostic)target.diagnostic=remote.diagnostic;else delete target.diagnostic;
 }
}
