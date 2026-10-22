import {describe,it,expect} from 'vitest';
import {componentEntries,RuntimeArtifactRegistry} from './artifact-registry.js';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
describe('Generated component admission',()=>{
  it('admits only fixed Skill and EquipmentTool class entries, rejecting archives before extraction',()=>{
    const files=['META-INF/','META-INF/MANIFEST.MF','generated/','generated/EquipmentTool.class','generated/EquipmentTool$1.class','skills/','skills/equipment-query/','skills/equipment-query/SKILL.md'];
    expect(componentEntries(files.join('\n'))).toEqual(['generated/EquipmentTool.class','generated/EquipmentTool$1.class','skills/equipment-query/SKILL.md']);
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
});
