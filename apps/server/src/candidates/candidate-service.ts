import type { Pool } from 'pg';
import type { SnapshotService } from '../snapshots/application/snapshot-service.js';
import type { RunRuntime } from '../runs/run-service.js';
import type { Candidate } from '../../../../packages/contracts/src/candidates.js';
import {randomUUID} from 'node:crypto';
import {contentDigest} from '../snapshots/domain/assembly.js';
import {AppError} from '../shared/errors.js';
import type {BaselineService} from '../acceptance/application/baseline-service.js';
import type {DevelopmentJob,EngineeringTaskInput} from '../../../../packages/contracts/src/development.js';
import {equipmentGenerationRequest,wealthBalanceGenerationRequest,wealthAssistantGenerationRequest,wealthToolGenerationRequest,wealthSkillGenerationRequest,generatedRuntimeTools} from '../../../../packages/contracts/src/generation-profile.js';
import type {ValidationCandidate} from '../../../../packages/contracts/src/validations.js';
import {effectiveRuntimeSpec,validateGeneratedRailDefinition} from '../../../../packages/contracts/src/rail-generation.js';
export class CandidateService {
  constructor(private readonly pool:Pool,private readonly snapshots:SnapshotService,private readonly runtime:Pick<RunRuntime,'capabilities'|'artifact'|'packageGenerated'>,private readonly baselines?:Pick<BaselineService,'assertTarget'>){}
  private async builtJob(id:string,snapshotId:string){
    const row=(await this.pool.query<{record:DevelopmentJob;task_input:EngineeringTaskInput;input_digest:string}>('SELECT record,task_input,input_digest FROM development_jobs WHERE id=$1',[id])).rows[0];
    if(!row||row.record.status!=='built'||!row.record.bundle||!this.baselines)throw new AppError('CANDIDATE_BUILD_UNAVAILABLE','生成任务尚未形成可登记的构建制品',409);
    const job=row.record;const bundle=job.bundle!;const{digest,...body}=bundle;const snapshot=await this.snapshots.get(snapshotId);const baseline=await this.baselines.assertTarget(job.baselineId,snapshot);
    if(job.id!==id||job.snapshotId!==snapshotId||job.agentId!==snapshot.draftId||row.task_input.context.snapshotId!==snapshotId
      ||row.input_digest!==job.inputDigest||contentDigest(row.task_input)!==job.inputDigest||contentDigest(row.task_input.context.baseline)!==contentDigest(baseline)
      ||baseline.digest!==job.baselineDigest||bundle.snapshotId!==snapshotId||bundle.baselineId!==baseline.id||bundle.baselineDigest!==baseline.digest||contentDigest(body)!==digest
      ||contentDigest(bundle.repair??null)!==contentDigest(row.task_input.context.repair?.reference??null)||row.task_input.context.repair&&bundle.planDigest!==row.task_input.context.repair.bundle.planDigest)
      throw new AppError('CANDIDATE_BUILD_MISMATCH','生成任务与需求、基线或构建包不匹配',409);
    if(bundle.profileVersion&&bundle.profileVersion!==row.task_input.generation.profileVersion)throw new AppError('CANDIDATE_BUILD_MISMATCH','构建包生成 Profile 与任务不匹配',409);
    if(([equipmentGenerationRequest.profileVersion,wealthBalanceGenerationRequest.profileVersion,wealthAssistantGenerationRequest.profileVersion,wealthToolGenerationRequest.profileVersion,wealthSkillGenerationRequest.profileVersion] as string[]).includes(row.task_input.generation.profileVersion)){
      let definition;try{definition=validateGeneratedRailDefinition(row.task_input.context.goal,bundle.railDefinition);}catch{throw new AppError('CANDIDATE_RAIL_INVALID','构建包缺少与确认需求相符的受限 Rail 定义',409);}
      const base=structuredClone(row.task_input.context.runtimeSpec??snapshot.content.runtimeSpec);
      const generatedTools=generatedRuntimeTools(row.task_input.generation.profileVersion);
      if(generatedTools){
        if(base.tools.length===0)base.tools=generatedTools;
        else if(contentDigest(base.tools)!==contentDigest(generatedTools))throw new AppError('CANDIDATE_RUNTIME_SPEC_MISMATCH','快照中的 Tool 与生成 Profile 不一致',409);
      }
      const expected=effectiveRuntimeSpec(base,definition);
      if(!bundle.runtimeSpec||contentDigest(bundle.runtimeSpec)!==contentDigest(expected))throw new AppError('CANDIDATE_RUNTIME_SPEC_MISMATCH','构建包运行配置与需求不匹配',409);
    }
    return {job,bundle,goal:row.task_input.context.goal,generation:row.task_input.generation};
  }
  async create(snapshotId:string,developmentJobId?:string):Promise<Candidate>{
    const [snapshot,runtime]=await Promise.all([this.snapshots.get(snapshotId),this.runtime.capabilities()]);
    if(runtime.executionMode!=='trusted-local'||!/^[a-f0-9]{64}$/.test(runtime.artifactDigest))throw new AppError('CANDIDATE_ARTIFACT_UNAVAILABLE','Runner 制品不可核验',409);
    const runtimeSpec=structuredClone(snapshot.content.runtimeSpec);
    const content:Omit<Candidate,'id'|'bundleDigest'|'createdAt'>={agentId:snapshot.draftId,snapshotId,snapshotDigest:snapshot.digest,runtimeSpec,specDigest:contentDigest(runtimeSpec),artifactDigest:runtime.artifactDigest,provenance:'assembled-template'};
    if(developmentJobId){
      const{job,bundle,goal,generation}=await this.builtJob(developmentJobId,snapshotId);
      if(bundle.railDefinition){
        let railDefinition;try{railDefinition=validateGeneratedRailDefinition(goal,bundle.railDefinition);}catch{throw new AppError('CANDIDATE_RAIL_INVALID','候选 Rail 定义与确认需求不匹配',409);}
        const base=structuredClone(snapshot.content.runtimeSpec);const generatedTools=generatedRuntimeTools(generation.profileVersion);
        if(generatedTools){if(base.tools.length===0)base.tools=generatedTools;else if(contentDigest(base.tools)!==contentDigest(generatedTools))throw new AppError('CANDIDATE_RUNTIME_SPEC_MISMATCH','快照中的 Tool 与生成 Profile 不一致',409);}
        const expected=effectiveRuntimeSpec(base,railDefinition);
        if(!bundle.runtimeSpec||contentDigest(bundle.runtimeSpec)!==contentDigest(expected))throw new AppError('CANDIDATE_RUNTIME_SPEC_MISMATCH','候选运行配置与 Rail 定义不匹配',409);
        Object.assign(content,{runtimeSpec:expected,specDigest:contentDigest(expected)});
      }
      if(bundle.sdkArtifactDigest!==runtime.artifactDigest)throw new AppError('CANDIDATE_SDK_CHANGED','生成组件所用 SDK 已变化，请基于当前运行时重新生成',409);
      if(!this.runtime.packageGenerated)throw new AppError('CANDIDATE_BUILD_UNAVAILABLE','Runner 未提供生成制品登记能力',409);
      const artifact=await this.runtime.packageGenerated(developmentJobId,{bundleDigest:bundle.digest,specDigest:content.specDigest});
      const expectedGeneratedScope=generation.profileVersion===wealthToolGenerationRequest.profileVersion?['tool']:generation.profileVersion===wealthSkillGenerationRequest.profileVersion?['skill']:undefined;
      if(artifact.kind!=='generated-component'||!/^[a-f0-9]{64}$/.test(artifact.artifactDigest)||artifact.sdkArtifactDigest!==runtime.artifactDigest||artifact.sdkArtifactDigest!==bundle.sdkArtifactDigest
        ||artifact.generated.developmentBundleDigest!==bundle.digest||artifact.generated.snapshotId!==snapshotId||artifact.generated.specDigest!==content.specDigest
        ||artifact.generated.sdkArtifactDigest!==bundle.sdkArtifactDigest||artifact.generated.componentDigest!==bundle.artifactDigest
        ||artifact.generated.operationId!==undefined&&artifact.generated.operationId!==generatedRuntimeTools(generation.profileVersion)?.[0]?.operationId
        ||artifact.generated.toolBindings!==undefined&&contentDigest(artifact.generated.toolBindings.map(binding=>[binding.toolName,binding.operationId]))!==contentDigest((generatedRuntimeTools(generation.profileVersion)??[]).map(tool=>[tool.name,tool.operationId]))
        ||artifact.generated.skillDigest!==bundle.files.find(file=>file.path===(artifact.generated.skillPath??'skills/equipment-query/SKILL.md'))?.digest
        ||expectedGeneratedScope&&contentDigest(artifact.generated.generatedScope??null)!==contentDigest(expectedGeneratedScope)
        ||!expectedGeneratedScope&&artifact.generated.generatedScope!==undefined)
        throw new AppError('CANDIDATE_ARTIFACT_MISMATCH','Runner 实际制品与生成任务不匹配',409);
      content.artifactDigest=artifact.artifactDigest;content.provenance='generated-component';
      content.generated={developmentJobId,developmentBundleDigest:bundle.digest,baselineId:job.baselineId,baselineDigest:job.baselineDigest,sourceDigest:bundle.sourceDigest,runtimeArtifact:artifact};
    }
    const bundleDigest=contentDigest(content);
    const record:Candidate={...content,id:randomUUID(),bundleDigest,createdAt:new Date().toISOString()};
    await this.pool.query('INSERT INTO candidates(id,snapshot_id,bundle_digest,record) VALUES($1,$2,$3,$4) ON CONFLICT(bundle_digest) DO NOTHING',[record.id,snapshotId,bundleDigest,record]);
    const persisted=(await this.pool.query<{record:Candidate}>('SELECT record FROM candidates WHERE bundle_digest=$1',[bundleDigest])).rows[0]!.record;
    return this.get(persisted.id);
  }
  async get(id:string):Promise<Candidate>{
    const record=(await this.pool.query<{record:Candidate}>('SELECT record FROM candidates WHERE id=$1',[id])).rows[0]?.record;
    if(!record)throw new AppError('CANDIDATE_NOT_FOUND','候选不存在',404);
    const {id:_id,createdAt:_createdAt,bundleDigest,...content}=record;
    const snapshot=await this.snapshots.get(record.snapshotId);
    const runtimeSpec=record.runtimeSpec??snapshot.content.runtimeSpec;
    if(contentDigest(content)!==bundleDigest||snapshot.digest!==record.snapshotDigest||contentDigest(runtimeSpec)!==record.specDigest
      ||record.provenance==='assembled-template'&&contentDigest(snapshot.content.runtimeSpec)!==record.specDigest)
      throw new AppError('CANDIDATE_INTEGRITY_ERROR','候选摘要不匹配',409);
    if(record.provenance==='generated-component'){
      const generated=record.generated;if(!generated||generated.runtimeArtifact.kind!=='generated-component')throw new AppError('CANDIDATE_INTEGRITY_ERROR','候选缺少生成来源',409);
      const{bundle}=await this.builtJob(generated.developmentJobId,record.snapshotId);
      if(generated.developmentBundleDigest!==bundle.digest||generated.sourceDigest!==bundle.sourceDigest||generated.baselineId!==bundle.baselineId||generated.baselineDigest!==bundle.baselineDigest
        ||generated.runtimeArtifact.artifactDigest!==record.artifactDigest||generated.runtimeArtifact.generated.specDigest!==record.specDigest)throw new AppError('CANDIDATE_INTEGRITY_ERROR','候选生成来源不匹配',409);
    }else if(record.generated)throw new AppError('CANDIDATE_INTEGRITY_ERROR','候选来源类型不匹配',409);
    return record.runtimeSpec?record:{...record,runtimeSpec:structuredClone(runtimeSpec)};
  }
  async list(agentId:string):Promise<Candidate[]>{
    return (await this.pool.query<{record:Candidate}>("SELECT record FROM candidates WHERE record->>'agentId'=$1 ORDER BY record->>'createdAt' DESC LIMIT 100",[agentId])).rows.map(row=>row.record);
  }
  async validationReference(id:string):Promise<ValidationCandidate>{
    const candidate=await this.get(id);const generated=candidate.generated;
    return{id:candidate.id,bundleDigest:candidate.bundleDigest,specDigest:candidate.specDigest,provenance:candidate.provenance,
      ...(generated?{developmentJobId:generated.developmentJobId,testPlanDigest:(await this.builtJob(generated.developmentJobId,candidate.snapshotId)).bundle.planDigest}:{})};
  }
}
