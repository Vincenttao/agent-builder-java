export interface ActionRecord {
  id: string; runId: string; actorId: string; environmentId: string; snapshotDigest: string; artifactDigest: string;
  toolCallId: string; operation: string; args: Record<string, unknown>; paramsHash: string; actionHash: string;
  createdAt: string; expiresAt: string; updatedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'invalidated' | 'executing' | 'unknown' | 'succeeded' | 'failed';
  decisionId?: string; decision?: 'approve' | 'reject'; decidedAt?: string;
  response?: { status: number; result: unknown };
}
export interface ActionDecision { decisionId: string; decision: 'approve' | 'reject'; actionHash: string }
export const actionDecisionSchema = {
  type: 'object', additionalProperties: false, required: ['decisionId', 'decision', 'actionHash'], properties: {
    decisionId: { type: 'string', format: 'uuid' }, decision: { enum: ['approve', 'reject'] },
    actionHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }
  }
} as const;
