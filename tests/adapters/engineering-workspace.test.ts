import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {expect,it} from 'vitest';
import {EngineeringWorkspace} from '../../apps/runner/src/engineering/workspace.js';
import type {AcceptanceBaseline} from '../../packages/contracts/src/baselines.js';
import {generatedUnit,generatedTool,generatedSkill} from '../support/generated-equipment.js';
import {repairContext,repairUnit,defectiveTool,sha} from '../support/repair-context.js';
import {RuntimeArtifactRegistry} from '../../apps/runner/src/runtime/artifact-registry.js';
const baseline:AcceptanceBaseline={id:randomUUID(),draftId:randomUUID(),draftRevision:1,digest:'b'.repeat(64),confirmedAt:new Date().toISOString(),confirmedBy:'fixture',content:{schemaVersion:1,templateId:'equipment-read@1',draftId:randomUUID(),draftRevision:1,audience:'fixture',requirements:[{id:'BR-001',text:'Report actual temperature',source:'user'}],cases:[{id:'TC-001',scenario:'read',title:'Read',requirementIds:['BR-001'],required:true,input:'查询设备',fault:'normal',assertions:[{ruleId:'temperature',expected:86}]}],seed:'enterprise-default@1',rulesVersion:'equipment-assertions@1'}};
async function workspace(){const root=resolve('test-results',`engineering-workspace-${randomUUID()}`);const ws=new EngineeringWorkspace(root,resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),{baseline,goal:'Generate equipment Tool and Skill',snapshotId:randomUUID()});await ws.initialize();return{root,ws};}
it('requires independent baseline-bound planning, observes a real failing Java unit test before implementation, and freezes its assertions',async()=>{
 const{root,ws}=await workspace();
 await expect(ws.write('developer','src/generated/EquipmentTool.java',generatedTool)).rejects.toMatchObject({code:'UNIT_RED_REQUIRED'});
 await expect(ws.write('tester','tests/plan.json','null')).rejects.toMatchObject({code:'TEST_PLAN_INVALID'});
 await expect(ws.write('tester','tests/plan.json',JSON.stringify({baselineDigest:baseline.digest,cases:[]}))).rejects.toMatchObject({code:'TEST_BASELINE_IMMUTABLE'});
 await ws.write('tester','tests/plan.json',JSON.stringify({baselineDigest:baseline.digest,cases:baseline.content.cases.map(c=>({caseId:c.id,requirementIds:c.requirementIds,assertions:c.assertions,steps:['Invoke the fixed candidate','Verify the external call and actual temperature']}))}));
 await ws.write('developer','test/generated/EquipmentToolTest.java',generatedUnit);
 const red=await ws.run('developer','unit-test');expect(red.status).toBe('failed');expect(ws.inspect().unitRed?.id).toBe(red.id);
 await expect(ws.write('developer','test/generated/EquipmentToolTest.java',generatedUnit+'\n')).rejects.toMatchObject({code:'UNIT_TEST_FROZEN'});
 await ws.write('developer','src/generated/EquipmentTool.java',generatedTool);await ws.write('developer','skills/equipment-query/SKILL.md',generatedSkill);
 expect((await ws.run('developer','unit-test')).status).toBe('passed');const built=await ws.run('developer','build');expect(built.status).toBe('passed');
 const bundle=ws.inspect().bundle!;expect(bundle.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
 const pinned=await readFile(join(root,'bundles',bundle.digest,'src/generated/EquipmentTool.java'),'utf8');
 await ws.write('developer','src/generated/EquipmentTool.java',generatedTool.replace('data.get("temperatureCelsius")','0'));
 expect(await readFile(join(root,'bundles',bundle.digest,'src/generated/EquipmentTool.java'),'utf8')).toBe(pinned);
 await expect(ws.run('developer','build')).rejects.toMatchObject({code:'UNIT_GREEN_STALE'});
 // A local edit outside the model tool must also invalidate recorded unit evidence at build time.
 await ws.write('developer','src/generated/EquipmentTool.java',generatedTool);
 await writeFile(join(root,'developer/test/generated/EquipmentToolTest.java'),generatedUnit+'\n// changed after green\n');
 await expect(ws.run('developer','build')).rejects.toMatchObject({code:'UNIT_TEST_FROZEN'});
 await writeFile(join(root,'evidence.json'),JSON.stringify({scope:'fixture-generated source with real JDK and pinned SDK',red,green:ws.inspect().unitGreen,bundle},null,2));await ws.cancel();
},90000);
it('pins SDK bytes before engineering commands and rejects replacement under the same path',async()=>{
 const root=resolve('test-results',`engineering-sdk-${randomUUID()}`);await mkdir(root,{recursive:true});const sdk=join(root,'sdk.jar');await copyFile(resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),sdk);
 const ws=new EngineeringWorkspace(join(root,'workspace'),sdk,{baseline,goal:'equipment',snapshotId:randomUUID()});await ws.initialize();
 try{
  await ws.write('tester','tests/plan.json',JSON.stringify({baselineDigest:baseline.digest,cases:baseline.content.cases.map(c=>({caseId:c.id,requirementIds:c.requirementIds,assertions:c.assertions,steps:['Invoke','Verify']}))}));
  await ws.write('developer','test/generated/EquipmentToolTest.java',generatedUnit);await writeFile(sdk,'replaced fixture');
  await expect(ws.run('developer','unit-test')).rejects.toMatchObject({code:'SDK_ARTIFACT_CHANGED'});
 }finally{await ws.cancel();}
});
it('reproduces a repair defect against old source, freezes prior tests and plan, then builds a new bundle with all regression tests',async()=>{
 const root=resolve('test-results',`engineering-repair-${randomUUID()}`),sdk=resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),snapshotId=randomUUID();
 const repair=repairContext(baseline,snapshotId,sha(await readFile(sdk)));const ws=new EngineeringWorkspace(root,sdk,{baseline,goal:'Repair actual temperature mapping',snapshotId,repair});
 await ws.initialize();
 try{
  expect(await ws.read('developer','src/generated/EquipmentTool.java')).toBe(defectiveTool);
  expect(ws.inspect().planDigest).toBe(repair.bundle.planDigest);
  await expect(ws.write('developer','test/generated/EquipmentToolTest.java',generatedUnit+'\n')).rejects.toMatchObject({code:'PRIOR_TEST_FROZEN'});
  await expect(ws.write('developer','src/generated/EquipmentTool.java',generatedTool)).rejects.toMatchObject({code:'UNIT_RED_REQUIRED'});
  await expect(ws.write('tester','tests/plan.json',repair.files.find(f=>f.path==='test-plan.json')!.content+' ')).rejects.toMatchObject({code:'TEST_PLAN_FROZEN'});
  await ws.write('developer','test/generated/EquipmentRepair1Test.java',repairUnit);
  const red=await ws.run('developer','unit-test');expect(red.status).toBe('failed');expect(red.output).toContain('REPAIR_REGRESSION_FAILED');expect(ws.inspect().unitRed?.id).toBe(red.id);
  await expect(ws.write('developer','test/generated/EquipmentRepair1Test.java',repairUnit+'\n')).rejects.toMatchObject({code:'UNIT_TEST_FROZEN'});
  await ws.write('developer','src/generated/EquipmentTool.java',generatedTool);expect((await ws.run('developer','unit-test')).status).toBe('passed');expect((await ws.run('developer','build')).status).toBe('passed');
  const bundle=ws.inspect().bundle!;expect(bundle.digest).not.toBe(repair.bundle.digest);expect(bundle.planDigest).toBe(repair.bundle.planDigest);expect(bundle.files.map(f=>f.path)).toContain('test/generated/EquipmentRepair1Test.java');
  expect(await readFile(join(root,'bundles',bundle.digest,'test/generated/EquipmentToolTest.java'),'utf8')).toBe(generatedUnit);
  const registry=new RuntimeArtifactRegistry(join(root,'runtime'),sdk);await registry.initialize();
  const artifact=await registry.compose(bundle,join(root,'bundles',bundle.digest),'a'.repeat(64));expect(artifact.kind).toBe('generated-component');
  await writeFile(join(root,'repair-evidence.json'),JSON.stringify({scope:'fixture defect, actual JDK and SDK',repair:repair.reference,red,green:ws.inspect().unitGreen,bundle},null,2));
 }finally{await ws.cancel();}
},90000);
