export type EngineeringRole='developer'|'tester';
import type {AcceptanceBaseline} from './baselines.js';
export interface GenerationRequest {
  profileVersion:string; scope:('agent'|'skill'|'rail'|'tool')[]; dependencies:string[]; connectionProfile:string;
}
export interface EngineeringEvent {sequence:number;occurredAt:string;subjectId:string;role:EngineeringRole|null;type:string;data:Record<string,unknown>}
export interface CommandResult {id:string;commandId:string;executable:string;args:string[];exitCode:number|null;status:'passed'|'failed'|'cancelled'|'timed_out';startedAt:string;finishedAt:string;output:string;truncated:boolean}
export interface GeneratedBundle {
  digest:string;artifactDigest:string;sourceDigest:string;profileDigest:string;sdkArtifactDigest:string;
  snapshotId:string;baselineId:string;baselineDigest:string;planDigest:string;
  files:{path:string;digest:string;size:number}[];unitRedId:string;unitGreenId:string;contractCheckId:string;buildId:string;
  repair?:RepairReference;
}
export interface RepairReference {
 executionId:string;reportDigest:string;candidateId:string;candidateBundleDigest:string;artifactDigest:string;
 parentJobId:string;rootJobId:string;attempt:number;maxAttempts:3;
}
export interface EngineeringRepair {
 reference:RepairReference;bundle:GeneratedBundle;
 files:{path:string;digest:string;content:string}[];
 failures:{caseId:string;input:string;ruleId:string;expected:unknown;actual:unknown;evidenceId:string;evidenceDigest:string}[];
}
export interface EngineeringContext {baseline:AcceptanceBaseline;goal:string;snapshotId:string;repair?:EngineeringRepair}
export interface EngineeringTaskInput {context:EngineeringContext;generation:GenerationRequest;maxSeconds:number}
export interface EngineeringTaskRecord {
  id:string;inputDigest:string;profileDigest:string;status:'queued'|'running'|'cancelling'|'cancelled'|'failed'|'reconciling'|'built';
  createdAt:string;updatedAt:string;roles:{role:EngineeringRole;status:string;sessionId?:string}[];bundle?:GeneratedBundle;diagnostic?:string;
}
export interface DevelopmentInput {clientRequestId:string;baselineId:string;generation:GenerationRequest;maxSeconds:number;repairExecutionId?:string}
export interface DevelopmentJob {
 id:string;agentId:string;snapshotId:string;baselineId:string;baselineDigest:string;inputDigest:string;
 status:EngineeringTaskRecord['status'];createdAt:string;updatedAt:string;roles:EngineeringTaskRecord['roles'];
 bundle?:GeneratedBundle;diagnostic?:string;repair?:RepairReference;
}
const uuid={type:'string',format:'uuid'} as const;
const digest={type:'string',pattern:'^[a-f0-9]{64}$'} as const;
export const generationRequestSchema={type:'object',additionalProperties:false,required:['profileVersion','scope','dependencies','connectionProfile'],properties:{
 profileVersion:{type:'string',minLength:1,maxLength:80},scope:{type:'array',minItems:1,maxItems:4,uniqueItems:true,items:{enum:['agent','skill','rail','tool']}},
 dependencies:{type:'array',maxItems:20,uniqueItems:true,items:{type:'string',maxLength:100}},connectionProfile:{type:'string',minLength:1,maxLength:80}
}} as const;
export const developmentInputSchema={type:'object',additionalProperties:false,required:['clientRequestId','baselineId','generation','maxSeconds'],properties:{
 clientRequestId:uuid,baselineId:uuid,generation:generationRequestSchema,maxSeconds:{type:'integer',minimum:5,maximum:900},repairExecutionId:uuid
}} as const;
const requirementSchema={type:'object',additionalProperties:false,required:['id','text','source'],properties:{
 id:{type:'string',maxLength:80},text:{type:'string',maxLength:8000},source:{enum:['user','template','suggestion']}
}} as const;
const caseSchema={type:'object',additionalProperties:false,required:['id','scenario','title','requirementIds','required','input','fault','assertions'],properties:{
 id:{type:'string',maxLength:100},scenario:{type:'string',maxLength:100},title:{type:'string',maxLength:500},
 requirementIds:{type:'array',maxItems:100,items:{type:'string',maxLength:80}},required:{const:true},input:{type:'string',maxLength:8000},fault:{enum:['normal','read-timeout','write-after-timeout']},
 assertions:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['ruleId','expected'],properties:{ruleId:{type:'string',maxLength:100},expected:{}}}}
}} as const;
const baselineContentSchema={type:'object',additionalProperties:false,required:['schemaVersion','templateId','draftId','draftRevision','audience','requirements','cases','seed','rulesVersion'],properties:{
 schemaVersion:{const:1},templateId:{enum:['equipment-read@1','equipment-workorder@1']},draftId:uuid,draftRevision:{type:'integer',minimum:1},audience:{type:'string',maxLength:8000},seed:{const:'enterprise-default@1'},rulesVersion:{const:'equipment-assertions@1'},
 requirements:{type:'array',minItems:1,maxItems:100,items:requirementSchema},cases:{type:'array',minItems:1,maxItems:100,items:caseSchema}
}} as const;
const baselineSchema={type:'object',additionalProperties:false,required:['id','draftId','draftRevision','digest','confirmedAt','confirmedBy','content'],properties:{
 id:uuid,draftId:uuid,draftRevision:{type:'integer',minimum:1},digest,confirmedAt:{type:'string',format:'date-time'},confirmedBy:{type:'string',minLength:1,maxLength:100},content:baselineContentSchema
}} as const;
const repairReferenceSchema={type:'object',additionalProperties:false,required:['executionId','reportDigest','candidateId','candidateBundleDigest','artifactDigest','parentJobId','rootJobId','attempt','maxAttempts'],properties:{executionId:uuid,reportDigest:digest,candidateId:uuid,candidateBundleDigest:digest,artifactDigest:digest,parentJobId:uuid,rootJobId:uuid,attempt:{type:'integer',minimum:1,maximum:3},maxAttempts:{const:3}}} as const;
const bundleProperties={digest,artifactDigest:digest,sourceDigest:digest,profileDigest:digest,sdkArtifactDigest:digest,snapshotId:uuid,baselineId:uuid,baselineDigest:digest,planDigest:digest,unitRedId:uuid,unitGreenId:uuid,contractCheckId:uuid,buildId:uuid,files:{type:'array',minItems:4,maxItems:8,items:{type:'object',additionalProperties:false,required:['path','digest','size'],properties:{path:{type:'string',maxLength:160},digest,size:{type:'integer',minimum:0,maximum:10485760}}}}} as const;
const repairSchema={type:'object',additionalProperties:false,required:['reference','bundle','files','failures'],properties:{reference:repairReferenceSchema,bundle:{type:'object',additionalProperties:false,required:Object.keys(bundleProperties),properties:{...bundleProperties,repair:repairReferenceSchema}},files:{type:'array',minItems:4,maxItems:7,items:{type:'object',additionalProperties:false,required:['path','digest','content'],properties:{path:{type:'string',maxLength:160},digest,content:{type:'string',maxLength:32768}}}},failures:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['caseId','input','ruleId','expected','actual','evidenceId','evidenceDigest'],properties:{caseId:{type:'string',maxLength:100},input:{type:'string',maxLength:8000},ruleId:{type:'string',maxLength:100},expected:{},actual:{},evidenceId:uuid,evidenceDigest:digest}}}}} as const;
export const engineeringTaskInputSchema={type:'object',additionalProperties:false,required:['context','generation','maxSeconds'],properties:{
 generation:generationRequestSchema,maxSeconds:{type:'integer',minimum:5,maximum:900},context:{type:'object',additionalProperties:false,required:['snapshotId','goal','baseline'],properties:{
 snapshotId:uuid,goal:{type:'string',minLength:1,maxLength:8000},baseline:baselineSchema,repair:repairSchema
 }}
}} as const;
