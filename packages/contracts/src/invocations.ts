import type { RunRecord } from './runs.js';
import type { ActionRecord } from './actions.js';
export interface DemoIdentity { agentId: string; environmentId: string; actorId: 'U1001' | 'U1002' }
export interface InvocationIdentity extends DemoIdentity { testDeploymentId?: string }
export interface MessageInput { clientRequestId: string; input: string; conversationId?: string }
export interface Conversation extends InvocationIdentity { id: string; agentVersion: string|null; createdAt: string; candidateId?:string; artifactDigest?:string }
export interface Invocation extends InvocationIdentity {
  id: string; clientRequestId: string; input: string; inputDigest: string; conversationId: string;
  agentVersion: string|null; candidateId?:string; artifactDigest?:string; runId: string; status: 'reserved' | 'blocked' | 'admitted' | 'cancelled';
  diagnostic?: string; createdAt: string; updatedAt: string;
}
export interface InvocationView {
  requestId: string; runId: string; conversationId: string; agentVersion: string|null;
  testDeploymentId?:string; candidateId?:string; artifactDigest?:string;
  request: Invocation; run: RunRecord | null; actions: ActionRecord[];
}
export interface DemoGrant extends DemoIdentity { token: string; expiresAt: string }
export const messageInputSchema = { type: 'object', additionalProperties: false, required: ['clientRequestId','input'], properties: {
  clientRequestId: { type: 'string', format: 'uuid' }, input: { type: 'string', minLength: 1, maxLength: 8000, pattern: '\\S' },
  conversationId: { type: 'string', format: 'uuid' }
} } as const;
