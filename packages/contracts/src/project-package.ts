import type {AssemblyInput,DraftInput} from './index.js';
import type {AcceptanceBaseline,BaselineTemplateId} from './baselines.js';
import type {GeneratedBundle} from './development.js';
import type {RuntimeSpec} from './index.js';
import type {MockScenePackage} from './mock-scene.js';

export interface PortableDevelopmentJob {
  id:string;snapshotId:string;snapshotDigest:string;baselineId:string;baselineDigest:string;inputDigest:string;
  status:'built';generation:{profileVersion:string;scope:('agent'|'skill'|'rail'|'tool')[];dependencies:string[];connectionProfile:string};
  bundle:GeneratedBundle;files:{path:string;digest:string;content:string}[];
}
export interface PortableCandidate {
  id:string;snapshotId:string;snapshotDigest:string;specDigest:string;artifactDigest:string;bundleDigest:string;
  provenance:'assembled-template'|'generated-component';runtimeSpec?:RuntimeSpec;
  generated?:{developmentJobId:string;developmentBundleDigest:string;baselineId:string;baselineDigest:string;sourceDigest:string};
}

export interface ProjectPackage {
  schemaVersion:1;
  packageKind:'agent-builder-project';
  source:{projectId:string;revision:number;exportedAt:string};
  draft:DraftInput;
  snapshots:{sourceDigest:string;assembly:AssemblyInput}[];
  baselines:{templateId:BaselineTemplateId;sourceDigest:string;content:AcceptanceBaseline['content']}[];
  automation:{jobs:PortableDevelopmentJob[];candidates:PortableCandidate[];artifactDependencies:{artifactDigest:string;sdkArtifactDigest?:string;restore:'rebuild-from-source'|'platform-template';sourceJobId?:string}[]};
  mockScene?:MockScenePackage;
  connectionRequirements:{profile:string;action:'rebind'}[];
  packageDigest:string;
}
