import { createHash } from 'node:crypto';

export type Phase = 'P0-A' | 'P0-B' | 'P0-C';
export type Verdict = 'passed' | 'failed' | 'blocked' | 'unverified';
export interface Binding {
  baselineDigest: string;
  artifactDigest: string;
  testSetDigest: string;
  compatibilityKey: string;
}
export interface AcceptanceCase {
  caseId: string;
  phase: Phase;
  requirementIds: string[];
  testFile: string | null;
  executionMode: 'live-mock' | 'simulated';
  branches: { id: string; evidenceKinds: string[] }[];
}
export interface BranchResult {
  caseId: string;
  branchId: string;
  binding: Binding;
  executionMode: 'live-mock' | 'simulated';
  status: Verdict | 'skipped';
  artifactDigestAfter: string;
  assertions: { name: string; passed: boolean }[];
  evidence: { kind: string; path: string; sha256: string }[];
  modelScore?: number;
}
export interface GateReport {
  status: Verdict;
  branches: { caseId: string; branchId: string; status: Verdict; reasons: string[] }[];
  errors: string[];
}

// Reports are produced by the platform executor, never copied from an Agent's verdict.
// A report represents ONE fixed attempt. Retry history is stored as separate reports.
export async function evaluateAcceptance(
  cases: AcceptanceCase[], results: BranchResult[], expected: Binding,
  readEvidence: (relativePath: string) => Promise<Uint8Array>
): Promise<GateReport> {
  const errors: string[] = [];
  const branches: GateReport['branches'] = [];
  const required = new Set<string>();
  const seenCases = new Set<string>();
  for (const item of cases) {
    if (seenCases.has(item.caseId)) errors.push(`DUPLICATE_CASE:${item.caseId}`);
    seenCases.add(item.caseId);
    if (!item.branches.length) errors.push(`EMPTY_BRANCHES:${item.caseId}`);
    for (const branch of item.branches) {
      const key = `${item.caseId}/${branch.id}`;
      if (required.has(key)) errors.push(`DUPLICATE_BRANCH:${key}`);
      required.add(key);
    }
  }
  for (const result of results) {
    if (!required.has(`${result.caseId}/${result.branchId}`)) errors.push(`UNKNOWN_BRANCH:${result.caseId}/${result.branchId}`);
  }
  for (const item of cases) for (const branch of item.branches) {
    const matches = results.filter(r => r.caseId === item.caseId && r.branchId === branch.id);
    const reasons: string[] = [];
    let status: Verdict = 'passed';
    const priority: Record<Verdict, number> = { passed: 0, unverified: 1, blocked: 2, failed: 3 };
    const reject = (value: Verdict, reason: string) => {
      if (priority[value] > priority[status]) status = value;
      reasons.push(reason);
    };
    if (!item.testFile) reject('unverified', 'TEST_NOT_IMPLEMENTED');
    if (!matches.length) reject('unverified', 'RESULT_MISSING');
    if (matches.length > 1) reject('failed', 'DUPLICATE_RESULT');
    const result = matches[0];
    if (result) {
      if (result.status !== 'passed') reject(result.status === 'skipped' ? 'unverified' : result.status, `EXECUTION_${result.status.toUpperCase()}`);
      if (result.executionMode !== item.executionMode) reject('unverified', 'REAL_EXECUTION_REQUIRED');
      for (const field of Object.keys(expected) as (keyof Binding)[]) {
        if (!expected[field] || result.binding[field] !== expected[field]) reject('unverified', `BINDING_MISMATCH:${field}`);
      }
      if (result.artifactDigestAfter !== expected.artifactDigest) reject('failed', 'ARTIFACT_CHANGED');
      if (!result.assertions.length) reject('unverified', 'ASSERTIONS_MISSING');
      for (const assertion of result.assertions) if (assertion.passed !== true) reject('failed', `ASSERTION_FAILED:${assertion.name}`);
      if (!branch.evidenceKinds.length) reject('unverified', 'EVIDENCE_REQUIREMENTS_MISSING');
      for (const kind of branch.evidenceKinds) {
        if (!result.evidence.some(e => e.kind === kind)) reject('unverified', `EVIDENCE_MISSING:${kind}`);
      }
      for (const evidence of result.evidence) {
        if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(evidence.path) || evidence.path.split('/').some(p => p === '.' || p === '..')) {
          reject('failed', 'EVIDENCE_PATH_REJECTED'); continue;
        }
        try {
          const bytes = await readEvidence(evidence.path);
          if (createHash('sha256').update(bytes).digest('hex') !== evidence.sha256) reject('failed', 'EVIDENCE_DIGEST_MISMATCH');
        } catch { reject('blocked', 'EVIDENCE_UNAVAILABLE'); }
      }
    }
    branches.push({ caseId: item.caseId, branchId: branch.id, status, reasons });
  }
  const status: Verdict = errors.length || branches.some(b => b.status === 'failed') ? 'failed'
    : branches.some(b => b.status === 'blocked') ? 'blocked'
    : !branches.length || branches.some(b => b.status === 'unverified') ? 'unverified' : 'passed';
  return { status, branches, errors };
}
