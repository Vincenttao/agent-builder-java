import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { evaluateAcceptance, type AcceptanceCase, type BranchResult, type Binding } from './acceptance-gate.js';

const binding: Binding = { baselineDigest: 'baseline-1', artifactDigest: 'artifact-1', testSetDigest: 'tests-1', compatibilityKey: 'environment-1' };
const data = Buffer.from('external observation');
const hash = createHash('sha256').update(data).digest('hex');
const cases: AcceptanceCase[] = [{ caseId: 'AC-28', phase: 'P0-B', requirementIds: ['FR-012'], testFile: 'tests/contract/evidence.test.ts', executionMode: 'live-mock', branches: [{ id: 'external-state', evidenceKinds: ['external-state'] }] }];
const result = (changes: Partial<BranchResult> = {}): BranchResult => ({
  caseId: 'AC-28', branchId: 'external-state', binding, executionMode: 'live-mock', status: 'passed',
  artifactDigestAfter: binding.artifactDigest, assertions: [{ name: 'file actually exists', passed: true }],
  evidence: [{ kind: 'external-state', path: 'run-1/observation.json', sha256: hash }], ...changes
});
const evaluate = (results: BranchResult[], reader = async (_path: string): Promise<Uint8Array> => data) => evaluateAcceptance(cases, results, binding, reader);

describe('independent acceptance gate', () => {
  it('accepts complete assertions with readable, matching external evidence', async () => {
    expect((await evaluate([result()])).status).toBe('passed');
  });
  it('never treats an empty test set or missing required branch as passing', async () => {
    expect((await evaluateAcceptance([], [], binding, async () => data)).status).toBe('unverified');
    expect((await evaluate([])).status).toBe('unverified');
  });
  it.each(['skipped', 'unverified', 'blocked', 'failed'] as const)('does not promote %s', async status => {
    expect((await evaluate([result({ status })])).status).not.toBe('passed');
  });
  it('model score cannot override failed deterministic assertions', async () => {
    expect((await evaluate([result({ assertions: [{ name: 'file exists', passed: false }], modelScore: 1 })])).status).toBe('failed');
  });
  it('rejects a model-only assertion and simulated execution', async () => {
    expect((await evaluate([result({ assertions: [], modelScore: 1 })])).status).toBe('unverified');
    expect((await evaluate([result({ executionMode: 'simulated' })])).status).toBe('unverified');
  });
  it.each(Object.keys(binding) as (keyof Binding)[])('invalidates changed %s', async key => {
    expect((await evaluate([result({ binding: { ...binding, [key]: 'changed' } })])).status).toBe('unverified');
  });
  it('rejects candidate modification after execution', async () => {
    expect((await evaluate([result({ artifactDigestAfter: 'modified' })])).status).toBe('failed');
  });
  it('blocks when evidence is inaccessible, mismatched, or missing a required kind', async () => {
    expect((await evaluate([result()], async () => { throw new Error('offline'); })).status).toBe('blocked');
    expect((await evaluate([result()], async () => Buffer.from('tampered'))).status).toBe('failed');
    expect((await evaluate([result({ evidence: [] })])).status).toBe('unverified');
  });
  it('does not select a successful retry over an earlier failure in one report', async () => {
    expect((await evaluate([result({ status: 'failed' }), result()])).status).toBe('failed');
  });
  it('rejects duplicate requirements and unknown result branches', async () => {
    expect((await evaluateAcceptance([...cases, ...cases], [result()], binding, async () => data)).status).toBe('failed');
    expect((await evaluate([result(), result({ branchId: 'invented' })])).status).toBe('failed');
  });
  it('rejects unsafe evidence paths before accessing storage', async () => {
    const paths: string[] = [];
    for (const path of ['../secret', '/absolute', 'C:\\secret', 'run\\..\\secret', 'https://example.org/x']) {
      expect((await evaluate([result({ evidence: [{ kind: 'external-state', path, sha256: hash }] })], async p => { paths.push(p); return data; })).status).toBe('failed');
    }
    expect(paths).toEqual([]);
  });
});
