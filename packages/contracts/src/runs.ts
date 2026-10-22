import type { RuntimeModelProfile } from './model-profile.js';
export interface RunEnvironment { seed: 'enterprise-default@1' | 'enterprise-low-balance@1'; fault: 'normal' | 'read-timeout' | 'write-before-failure' | 'write-after-timeout' | 'missing-field'; clock: string }
export const runInputSchema = { type: 'object', additionalProperties: false, required: ['clientRequestId', 'input'], properties: {
  clientRequestId: { type: 'string', format: 'uuid' }, input: { type: 'string', minLength: 1, maxLength: 8000, pattern: '\\S' }
} } as const;
export interface RunInput { clientRequestId: string; input: string }
export interface RunRecord {
  id: string; snapshotId: string; snapshotDigest: string; artifactDigest: string; environmentId: string; actorId: string;
  clientRequestId: string; input: string; inputDigest: string; deploymentId: string;
  status: 'queued' | 'running' | 'waiting_confirmation' | 'reconciling' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  cancelRequested: boolean; started: boolean; createdAt: string; updatedAt: string; result?: unknown;
  externalEvidence: unknown[]; diagnostic?: string; dependencyFailures: number;
  modelProfile?: RuntimeModelProfile;
  environmentConfig?: RunEnvironment;
  validationId?: string;
  invocationId?: string;
  conversationId?: string;
  sharedTarget?: { kind: 'published'; versionId: string } | { kind: 'release-smoke'; operationId: string } | { kind:'test'; testDeploymentId:string; candidateId:string };
}
export interface RunEvent { seq: number; runId: string; source: string; type: string; data: unknown; at: string }
