import {describe,it,expect} from 'vitest';
import {componentEntries,RuntimeArtifactRegistry} from './artifact-registry.js';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../../../packages/contracts/src/canonical.js';
describe('Generated component admission',()=>{
  it('admits only the pinned Tool class and one Skill entry, rejecting archives before extraction',()=>{
    const files=['META-INF/','META-INF/MANIFEST.MF','generated/','generated/EquipmentTool.class','generated/EquipmentTool$1.class','skills/','skills/equipment-query/','skills/equipment-query/SKILL.md'];
    expect(componentEntries(files.join('\n'))).toEqual(['generated/EquipmentTool.class','generated/EquipmentTool$1.class','skills/equipment-query/SKILL.md']);
    const finance=['META-INF/','META-INF/MANIFEST.MF','generated/','generated/AccountBalanceTool.class','skills/','skills/balance-query/','skills/balance-query/SKILL.md'];
    expect(componentEntries(finance.join('\n'),'generated/AccountBalanceTool.class','skills/balance-query/SKILL.md')).toEqual(['generated/AccountBalanceTool.class','skills/balance-query/SKILL.md']);
    for(const extra of ['../escape','generated/../escape','/root/file','C:/secret','generated\\EquipmentTool.class','generated/Extra.class','BOOT-INF/classes/local/Override.class','skills/equipment-query/extra.md','generated/EquipmentTool.class'])
      expect(()=>componentEntries([...files,extra].join('\n'))).toThrow('COMPONENT_ARCHIVE_INVALID');
    expect(()=>componentEntries('generated/EquipmentTool.class')).toThrow('COMPONENT_ARCHIVE_INVALID');
  });
  it('verifies default bytes and never accepts arbitrary digests or modified registered bytes',async()=>{
    const root=await mkdtemp(join(tmpdir(),'builder-artifacts-'));const base=join(root,'base.jar');await writeFile(base,'base fixture');
    const registry=new RuntimeArtifactRegistry(join(root,'runner'),base);await registry.initialize();
    const digest=createHash('sha256').update('base fixture').digest('hex');
    expect(await registry.get(digest)).toEqual({kind:'assembled-template',artifactDigest:digest,sdkArtifactDigest:digest});
    await expect(registry.get('../base.jar')).rejects.toThrow('ARTIFACT_MISMATCH');
    await expect(registry.get('f'.repeat(64))).rejects.toThrow('ARTIFACT_NOT_FOUND');
    await writeFile(join(root,'runner','artifacts',digest+'.jar'),'modified');
    await expect(registry.get(digest)).rejects.toThrow('ARTIFACT_MISMATCH');
  });
  it('restores a pinned legacy bridge artifact after the bundled runtime version changes',async()=>{
    const root=await mkdtemp(join(tmpdir(),'builder-artifact-upgrade-'));const store=join(root,'runner');
    const oldJar=join(root,'old.jar'),newJar=join(root,'new.jar');await writeFile(oldJar,'old bridge bytes');await writeFile(newJar,'new bridge bytes');
    const entries=['META-INF/MANIFEST.MF','BOOT-INF/classes/application.properties','BOOT-INF/classes/local/agentbuilder/bridge/BridgeApplication.class','BOOT-INF/classes/local/agentbuilder/bridge/BridgeManifestController.class'];
    const oldRegistry=new RuntimeArtifactRegistry(store,oldJar,async()=>entries);await oldRegistry.initialize();const oldDigest=oldRegistry.defaultDigest;
    const upgradedRegistry=new RuntimeArtifactRegistry(store,newJar,async()=>entries);await upgradedRegistry.initialize();
    expect(upgradedRegistry.defaultDigest).not.toBe(oldDigest);
    expect(await upgradedRegistry.get(oldDigest)).toEqual({kind:'assembled-template',artifactDigest:oldDigest,sdkArtifactDigest:oldDigest});
    const candidateBytes='legacy generated component';const candidateDigest=createHash('sha256').update(candidateBytes).digest('hex');
    const descriptor={kind:'generated-component' as const,artifactDigest:candidateDigest,sdkArtifactDigest:oldDigest,generated:{kind:'equipment-tool-skill@1' as const,
      developmentBundleDigest:'1'.repeat(64),sdkArtifactDigest:oldDigest,snapshotId:'snapshot',specDigest:'2'.repeat(64),componentDigest:'3'.repeat(64),skillDigest:'4'.repeat(64),classes:{'generated/EquipmentTool.class':'5'.repeat(64)}}};
    await writeFile(join(store,'artifacts',candidateDigest+'.jar'),candidateBytes);
    const digest=createHash('sha256').update(canonicalJson(descriptor)).digest('hex');
    await writeFile(join(store,'artifacts',candidateDigest+'.json'),JSON.stringify({descriptor,digest}));
    expect(await upgradedRegistry.get(candidateDigest)).toEqual(descriptor);
  });
});
