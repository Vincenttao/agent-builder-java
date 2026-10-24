export interface GeneratedComponentManifest {
  kind:'equipment-tool-skill@1'|'generated-tool-skill@1'|'generated-tool-skill@2'|'generated-tool-skill@3';developmentBundleDigest:string;sdkArtifactDigest:string;snapshotId:string;specDigest:string;
  componentDigest:string;skillDigest:string;classes:Record<string,string>;
  generatedScope?:('agent'|'skill'|'rail'|'tool')[];
  toolClassName?:string;toolName?:string;operationId?:string;skillName?:string;skillPath?:string;
  toolBindings?:{toolClassName:string;toolName:string;operationId:string}[];
}
export type RuntimeArtifact = {kind:'assembled-template';artifactDigest:string;sdkArtifactDigest:string}
  | {kind:'generated-component';artifactDigest:string;sdkArtifactDigest:string;generated:GeneratedComponentManifest};
