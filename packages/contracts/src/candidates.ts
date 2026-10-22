import type { ValidationBinding } from './validations.js';
import type { RunEnvironment } from './runs.js';
import type {RuntimeArtifact} from './artifacts.js';
export interface Candidate {
  id: string; agentId: string; snapshotId: string; snapshotDigest: string; specDigest: string;
  artifactDigest: string; bundleDigest: string; provenance: 'assembled-template'|'generated-component'; createdAt: string;
  generated?:{developmentJobId:string;developmentBundleDigest:string;baselineId:string;baselineDigest:string;sourceDigest:string;runtimeArtifact:RuntimeArtifact};
}
export interface TestDeploymentInput {
  clientRequestId: string; candidateId: string; requirementBaselineId: string; suiteDigest: string;
  purpose: 'test' | 'preview'; ttlSeconds: number;
}
export interface TestDeployment {
  validation?: {executionId:string;caseId:string;runId:string;input:string;actorId:'U1001'|'U1002'};
  id: string; clientRequestId: string; inputDigest: string; agentId: string; candidateId: string;
  snapshotId: string; deploymentId: string; environmentId: string; environmentConfig: RunEnvironment;
  requirementBaselineId: string; purpose: 'test' | 'preview'; binding: ValidationBinding;
  status: 'preparing' | 'ready' | 'stopping' | 'stopped' | 'failed';
  failure: boolean; diagnostic?: string; createdAt: string; updatedAt: string; expiresAt: string;
}
const uuid={type:'string',format:'uuid'} as const;
export const candidateInputSchema={type:'object',additionalProperties:false,required:['snapshotId'],properties:{snapshotId:uuid,developmentJobId:uuid}} as const;
export const testDeploymentInputSchema={type:'object',additionalProperties:false,
  required:['clientRequestId','candidateId','requirementBaselineId','suiteDigest','purpose','ttlSeconds'],properties:{
    clientRequestId:uuid,candidateId:uuid,requirementBaselineId:uuid,suiteDigest:{type:'string',pattern:'^[a-f0-9]{64}$'},
    purpose:{enum:['test','preview']},ttlSeconds:{type:'integer',minimum:1,maximum:3600}
  }} as const;
