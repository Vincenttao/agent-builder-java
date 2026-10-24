import type {Candidate} from '../../../packages/contracts/src/candidates.js';
import type {Snapshot} from '../../../packages/contracts/src/index.js';
import type {AcceptanceBaseline} from '../../../packages/contracts/src/baselines.js';

// This catalog references existing immutable local data. It does not import or build artifacts.
export const equipmentSample = {
  draftId:'ec76f387-478b-4a92-85e6-85729a78afd9',
  snapshotId:'4c434ad3-78c8-417b-bab5-8919b73ed9f1',
  candidateId:'0c9bc4d9-c934-4480-9ce4-184a1ca9f82a',
  baselineId:'6aea0440-1b72-4abb-a276-7d3a4ec47c03',
  baselineDigest:'86e6d8ea428c820b9f5778bfe2c17c15b55288007f4ae10e1d87dc6efb5a7a18',
  artifactDigest:'34d73b50b1b8e63dcac93c925eaeebeccf8c2ffdc2fb96d87e9a14ebf0e4b1f2',
  bundleDigest:'e1ebaf6e2ddc5b6c44ef70ef55467f13cfd1c3b246f6ebde6be2b3c4d5ee0f13',
  source:'平台既有只读模板候选（AC-16 历史项目）',
} as const;

export function verifySample(candidate:Candidate,snapshot:Snapshot|undefined,baseline:AcceptanceBaseline|undefined):void {
  const s=equipmentSample;
  if (!snapshot || !baseline || candidate.id!==s.candidateId || candidate.agentId!==s.draftId ||
    candidate.snapshotId!==s.snapshotId || snapshot.id!==s.snapshotId || snapshot.draftId!==s.draftId ||
    candidate.snapshotDigest!==snapshot.digest || candidate.artifactDigest!==s.artifactDigest ||
    candidate.bundleDigest!==s.bundleDigest || !candidate.runtimeSpec || candidate.provenance!=='assembled-template' ||
    baseline.id!==s.baselineId || baseline.digest!==s.baselineDigest || baseline.draftId!==s.draftId ||
    baseline.draftRevision!==snapshot.draftRevision) {
    throw new Error('样例版本或验收基线不匹配。请连接保留该候选的主环境；不会自动生成或替换候选。');
  }
}

type SampleReportBinding={snapshotId:string;baselineId:string;binding:{artifactDigest:string;baselineDigest:string;candidate?:{id:string;bundleDigest:string}}};
export function matchesSampleReport(value:SampleReportBinding):boolean {
  const s=equipmentSample;
  return value.snapshotId===s.snapshotId && value.baselineId===s.baselineId &&
    value.binding.baselineDigest===s.baselineDigest && value.binding.artifactDigest===s.artifactDigest &&
    value.binding.candidate?.id===s.candidateId && value.binding.candidate.bundleDigest===s.bundleDigest;
}
