import {describe,it,expect} from 'vitest';
import {runtimeArtifactMatches} from './artifact-binding.js';
import type {RuntimeArtifact} from '../../../../packages/contracts/src/artifacts.js';

describe('runtime artifact release bindings',()=>{
  const current='a'.repeat(64),legacy='b'.repeat(64),spec='c'.repeat(64),snapshot='snapshot-1';
  it('accepts immutable legacy assembled templates after the bundled default changes',async()=>{
    const descriptor:RuntimeArtifact={kind:'assembled-template',artifactDigest:legacy,sdkArtifactDigest:legacy};
    const runtime={artifact:async(digest:string)=>digest===legacy?descriptor:({kind:'assembled-template',artifactDigest:digest,sdkArtifactDigest:digest} as RuntimeArtifact)};
    expect(await runtimeArtifactMatches(runtime,legacy,current,spec,snapshot)).toBe(true);
    expect(await runtimeArtifactMatches(runtime,legacy,current,spec,snapshot,descriptor)).toBe(true);
  });
  it('does not allow a template to stand in for a generated candidate',async()=>{
    const runtime={artifact:async(digest:string):Promise<RuntimeArtifact>=>({kind:'assembled-template',artifactDigest:digest,sdkArtifactDigest:digest})};
    expect(await runtimeArtifactMatches(runtime,legacy,current,spec,snapshot,{kind:'generated-component',artifactDigest:legacy,sdkArtifactDigest:legacy,generated:{
      kind:'equipment-tool-skill@1',developmentBundleDigest:'d'.repeat(64),sdkArtifactDigest:legacy,snapshotId:snapshot,specDigest:spec,
      componentDigest:'e'.repeat(64),skillDigest:'f'.repeat(64),classes:{'generated/EquipmentTool.class':'1'.repeat(64)}
    }})).toBe(false);
  });
});
