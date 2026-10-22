import type { Snapshot } from '../../../../../packages/contracts/src/index.js';
import type { AcceptanceBaseline } from '../../../../../packages/contracts/src/baselines.js';
import type { ValidationBinding } from '../../../../../packages/contracts/src/validations.js';
import type { RuntimeModelProfile } from '../../../../../packages/contracts/src/model-profile.js';
import { contentDigest } from '../../snapshots/domain/assembly.js';
export function validationBinding(snapshot:Snapshot,baseline:AcceptanceBaseline,identity:{artifactDigest:string;mockDigest:string;modelProfile:RuntimeModelProfile}):ValidationBinding {
  return {baselineDigest:baseline.digest,snapshotDigest:snapshot.digest,artifactDigest:identity.artifactDigest,testSetDigest:contentDigest(baseline.content.cases),modelProfile:identity.modelProfile,mockDigest:identity.mockDigest,
    compatibilityKey:contentDigest({model:identity.modelProfile,mock:identity.mockDigest,connection:snapshot.content.connectionProfile,sdk:snapshot.content.sdk,assembly:snapshot.content.assembly,policy:'approval@1',rules:baseline.content.rulesVersion,seed:baseline.content.seed})};
}
