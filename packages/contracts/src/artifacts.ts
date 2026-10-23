export interface GeneratedComponentManifest {
  kind:'equipment-tool-skill@1'|'generated-tool-skill@1';developmentBundleDigest:string;sdkArtifactDigest:string;snapshotId:string;specDigest:string;
  componentDigest:string;skillDigest:string;classes:Record<string,string>;
  toolClassName?:string;toolName?:string;operationId?:string;skillName?:string;skillPath?:string;
}
export type RuntimeArtifact = {kind:'assembled-template';artifactDigest:string;sdkArtifactDigest:string}
  | {kind:'generated-component';artifactDigest:string;sdkArtifactDigest:string;generated:GeneratedComponentManifest};
