import type {RunRuntime} from './run-service.js';
import type {RuntimeArtifact} from '../../../../packages/contracts/src/artifacts.js';
import {contentDigest} from '../snapshots/domain/assembly.js';
/** A default Bridge digest cannot stand in for a generated candidate. */
export async function runtimeArtifactMatches(runtime:Pick<RunRuntime,'artifact'>,digest:string,defaultDigest:string,specDigest:string,snapshotId:string,expected?:RuntimeArtifact):Promise<boolean>{
  if(digest===defaultDigest)return !expected||expected.kind==='assembled-template';
  if(!runtime.artifact)return digest===defaultDigest&&(!expected||expected.kind==='assembled-template');
  try{
    const artifact=await runtime.artifact(digest);
    if(artifact.kind==='assembled-template')return artifact.artifactDigest===digest&&artifact.sdkArtifactDigest===digest&&(!expected||expected.kind==='assembled-template');
    return artifact.kind==='generated-component'&&artifact.artifactDigest===digest&&artifact.sdkArtifactDigest===defaultDigest
      &&artifact.generated.sdkArtifactDigest===defaultDigest&&artifact.generated.specDigest===specDigest&&artifact.generated.snapshotId===snapshotId
      &&(!expected||contentDigest(artifact)===contentDigest(expected));
  }catch{return false;}
}
