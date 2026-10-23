import type { RuntimeModelProfile } from './model-profile.js';
export type ValidationVerdict = 'passed' | 'failed' | 'blocked' | 'unverified';
export interface ValidationInput { clientRequestId: string; baselineId: string; allowMockWrites: boolean; candidateId?: string }
export interface ValidationCandidate { id:string; bundleDigest:string; specDigest?:string; provenance:'assembled-template'|'generated-component'; developmentJobId?:string; testPlanDigest?:string }
export interface ValidationBinding {
  baselineDigest: string; snapshotDigest: string; artifactDigest: string; testSetDigest: string; compatibilityKey: string;
  modelProfile: RuntimeModelProfile; mockDigest: string; candidate?:ValidationCandidate;
}
export interface CaseProgress { caseId: string; runId: string; state: 'queued' | 'running' | 'completed'; startedAt?: string; beforeApprovalCalls?: unknown[]; decisionSubmitted?: boolean; testDeploymentId?:string; requestId?:string }
export interface AssertionResult { ruleId: string; status: ValidationVerdict; expected: unknown; actual: unknown }
export interface ProjectCaseResult { caseId: string; status: ValidationVerdict; assertions: AssertionResult[]; reasons: string[]; evidenceId?: string; evidenceDigest?: string }
export interface ValidationExecution {
  id: string; snapshotId: string; baselineId: string; clientRequestId: string; inputDigest: string; allowMockWrites: boolean;
  binding: ValidationBinding; status: 'queued' | 'running' | 'cancelling' | 'completed'; verdict?: ValidationVerdict;
  cases: CaseProgress[]; results: ProjectCaseResult[]; createdAt: string; updatedAt: string;
}
export interface ValidationReport { executionId: string; baselineId: string; snapshotId: string; binding: ValidationBinding; verdict: ValidationVerdict; reasons: string[]; cases: ProjectCaseResult[]; createdAt: string }
export const validationInputSchema = { type: 'object', additionalProperties: false, required: ['clientRequestId','baselineId','allowMockWrites'], properties: {
  clientRequestId: { type: 'string', format: 'uuid' }, baselineId: { type: 'string', format: 'uuid' }, allowMockWrites: { type: 'boolean' }, candidateId:{type:'string',format:'uuid'}
} } as const;
