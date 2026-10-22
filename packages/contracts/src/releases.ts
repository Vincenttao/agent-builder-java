import type { ValidationBinding } from './validations.js';
export interface ReleaseInput { clientRequestId: string; snapshotId: string; validationId: string; expectedRevision: number; rollbackVersionId?: string }
export interface ReleaseReference { agentId: string; snapshotId: string; validationId: string; binding: ValidationBinding }
export interface ReleaseOperation {
  id: string; agentId: string; versionId: string; deploymentId: string; environmentId: string; smokeRunId: string;
  request: ReleaseInput; inputDigest: string; reference: ReleaseReference;
  status: 'queued' | 'preparing' | 'smoking' | 'succeeded' | 'failed'; diagnostic?: string;
  createdAt: string; updatedAt: string;
}
export interface ReleaseVersion { id: string; agentId: string; operationId: string; snapshotId: string; validationId: string; deploymentId: string; environmentId: string; reference: ReleaseReference; smokeEvidence: unknown; createdAt: string }
export interface ReleasePointer { agentId: string; revision: number; environmentId: string; versionId?: string; deploymentId?: string }
export interface ReleaseOverview { pointer: ReleasePointer | null; operations: ReleaseOperation[]; versions: ReleaseVersion[]; cleanupPending: string[] }
export const releaseInputSchema={type:'object',additionalProperties:false,required:['clientRequestId','snapshotId','validationId','expectedRevision'],properties:{
  clientRequestId:{type:'string',format:'uuid'},snapshotId:{type:'string',format:'uuid'},validationId:{type:'string',format:'uuid'},expectedRevision:{type:'integer',minimum:0},rollbackVersionId:{type:'string',format:'uuid'}
}} as const;
