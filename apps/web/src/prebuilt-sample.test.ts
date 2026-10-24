import {describe, expect, it} from 'vitest';
import type {Candidate} from '../../../packages/contracts/src/candidates.js';
import type {Snapshot} from '../../../packages/contracts/src/index.js';
import type {AcceptanceBaseline} from '../../../packages/contracts/src/baselines.js';
import {equipmentSample, verifySample, matchesSampleReport} from './prebuilt-sample.js';

function fixture() {
  const candidate = {id:equipmentSample.candidateId, agentId:equipmentSample.draftId,
    snapshotId:equipmentSample.snapshotId, snapshotDigest:'snapshot-digest',
    artifactDigest:equipmentSample.artifactDigest, bundleDigest:equipmentSample.bundleDigest,
    provenance:'assembled-template', runtimeSpec:{agent:{},tools:[]},
    generated:{baselineId:equipmentSample.baselineId,baselineDigest:equipmentSample.baselineDigest}} as unknown as Candidate;
  const snapshot = {id:equipmentSample.snapshotId,draftId:equipmentSample.draftId,digest:'snapshot-digest',draftRevision:1} as Snapshot;
  const baseline = {id:equipmentSample.baselineId,draftId:equipmentSample.draftId,draftRevision:1,digest:equipmentSample.baselineDigest} as AcceptanceBaseline;
  return {candidate,snapshot,baseline};
}
describe('prebuilt sample binding',()=>{
  it('accepts the pinned candidate and matching immutable requirements',()=>{
    const {candidate,snapshot,baseline}=fixture();expect(()=>verifySample(candidate,snapshot,baseline)).not.toThrow();
  });
  it.each(['id','artifactDigest','bundleDigest','snapshotDigest','agentId'] as const)('rejects changed candidate %s instead of falling back to a template',field=>{
    const {candidate,snapshot,baseline}=fixture();candidate[field]='different';expect(()=>verifySample(candidate,snapshot,baseline)).toThrow();
  });
  it('rejects missing or different baselines',()=>{
    const {candidate,snapshot,baseline}=fixture();expect(()=>verifySample(candidate,snapshot,undefined)).toThrow();
    baseline.digest='changed';expect(()=>verifySample(candidate,snapshot,baseline)).toThrow();
  });
  it('does not reuse a report for a different candidate or artifact',()=>{
    const binding={artifactDigest:equipmentSample.artifactDigest,baselineDigest:equipmentSample.baselineDigest,candidate:{id:equipmentSample.candidateId,bundleDigest:equipmentSample.bundleDigest}};
    const report={snapshotId:equipmentSample.snapshotId,baselineId:equipmentSample.baselineId,binding};
    expect(matchesSampleReport(report)).toBe(true);
    expect(matchesSampleReport({...report,binding:{...binding,candidate:{...binding.candidate,id:'other'}}})).toBe(false);
    expect(matchesSampleReport({...report,binding:{...binding,artifactDigest:'other'}})).toBe(false);
  });
});
