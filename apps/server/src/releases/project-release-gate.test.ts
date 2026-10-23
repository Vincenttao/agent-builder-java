import { expect, it } from 'vitest';
import { ProjectReleaseGate } from './project-release-gate.js';
import { equipmentBaseline } from '../acceptance/application/equipment-baseline.js';
import { contentDigest } from '../snapshots/domain/assembly.js';
import { runtimeModelProfile } from '../../../runner/src/runtime/model-profile.js';
import { draftInput } from '../../../../tests/support/fixtures.js';
import type { Snapshot } from '../../../../packages/contracts/src/index.js';
import type { AcceptanceBaseline } from '../../../../packages/contracts/src/baselines.js';
import type { ValidationReport } from '../../../../packages/contracts/src/validations.js';
function setup() {
  const draft = {...draftInput,id:'draft',revision:1,createdAt:'',updatedAt:''};
  const content = equipmentBaseline(draft,'equipment-read@1');
  const baseline:AcceptanceBaseline = {id:'baseline',draftId:'draft',draftRevision:1,digest:contentDigest(content),content,confirmedAt:'',confirmedBy:'test'};
  const snapshot:Snapshot = {id:'snapshot',draftId:'draft',draftRevision:1,digest:'a'.repeat(64),createdAt:'',content:{draft,assembly:{agentType:'DeepAgent',systemPrompt:'fixture',maxIterations:4,toolIds:['equipment-status@1'],railIds:['audit@1','tool-allowlist@1']},runtimeSpec:{agent:{id:'agent',type:'DeepAgent',systemPrompt:'fixture',maxIterations:4,rails:['audit','tool-allowlist']},tools:[]},executionMode:'trusted-local',sdk:{core:'test',runtime:'test'},modelProfile:'test',connectionProfile:'enterprise-mock@1'}};
  const identity = {artifactDigest:'b'.repeat(64),mockDigest:'c'.repeat(64),modelProfile:runtimeModelProfile()};
  const binding = {baselineDigest:baseline.digest,snapshotDigest:snapshot.digest,artifactDigest:identity.artifactDigest,testSetDigest:contentDigest(content.cases),modelProfile:identity.modelProfile,mockDigest:identity.mockDigest,
    compatibilityKey:contentDigest({model:identity.modelProfile,mock:identity.mockDigest,connection:snapshot.content.connectionProfile,sdk:snapshot.content.sdk,assembly:snapshot.content.assembly,policy:'approval@1',rules:content.rulesVersion,seed:content.seed})};
  const report:ValidationReport = {executionId:'validation',baselineId:baseline.id,snapshotId:snapshot.id,binding,verdict:'passed',reasons:[],createdAt:'',cases:content.cases.map(c=>({caseId:c.id,status:'passed',assertions:c.assertions.map(a=>({...a,status:'passed',actual:a.expected})),reasons:[],evidenceId:`evidence-${c.id}`,evidenceDigest:'d'.repeat(64)}))};
  const gate = new ProjectReleaseGate({report:async()=>report},{assertTarget:async()=>baseline},{get:async()=>snapshot},{identity:async()=>identity});
  return {gate,report,identity,snapshot,baseline};
}
it('does not accept simulated or unverified reports as permission to publish',async()=>{
  const h=setup(); h.report.binding.modelProfile=runtimeModelProfile('http://127.0.0.1:1/v1');
  await expect(h.gate.check('snapshot','validation')).rejects.toMatchObject({code:'REAL_EXECUTION_REQUIRED'});
  const other=setup(); other.report.verdict='unverified'; await expect(other.gate.check('snapshot','validation')).rejects.toMatchObject({code:'VALIDATION_NOT_PASSED'});
});
it('requires every fixed case and assertion, evidence references and exact target bindings',async()=>{
  for(const change of [
    (h:ReturnType<typeof setup>)=>{h.report.cases.pop();},
    (h:ReturnType<typeof setup>)=>{h.report.cases[0]!.assertions.pop();},
    (h:ReturnType<typeof setup>)=>{delete h.report.cases[0]!.evidenceId;},
    (h:ReturnType<typeof setup>)=>{h.report.snapshotId='other';}
  ]){const h=setup();change(h);await expect(h.gate.check('snapshot','validation')).rejects.toBeDefined();}
});
it('rechecks the actual environment and accepts only the same validated target',async()=>{
  const h=setup();expect((await h.gate.check('snapshot','validation')).binding).toEqual(h.report.binding);
  h.identity.mockDigest='e'.repeat(64);await expect(h.gate.check('snapshot','validation')).rejects.toMatchObject({code:'VALIDATION_BINDING_CHANGED'});
});
it('revalidates the exact generated candidate and plan instead of substituting the default template',async()=>{
  const h=setup();const runtimeSpec={...h.snapshot.content.runtimeSpec,agent:{...h.snapshot.content.runtimeSpec.agent,rails:[...h.snapshot.content.runtimeSpec.agent.rails,'tool-call-limit@1:3']}};const candidate={id:'candidate',agentId:'draft',snapshotId:h.snapshot.id,snapshotDigest:h.snapshot.digest,runtimeSpec,specDigest:contentDigest(runtimeSpec),artifactDigest:'9'.repeat(64),bundleDigest:'8'.repeat(64),provenance:'generated-component' as const,createdAt:''};
  const ref={id:candidate.id,bundleDigest:candidate.bundleDigest,specDigest:candidate.specDigest,provenance:candidate.provenance,developmentJobId:'job',testPlanDigest:'7'.repeat(64)};h.report.binding.candidate={...ref};h.report.binding.artifactDigest=candidate.artifactDigest;
  const selected:string[]=[];const environment={identity:async(id?:string)=>{selected.push(id??'template');return{...h.identity,artifactDigest:id===candidate.id?candidate.artifactDigest:h.identity.artifactDigest};}};
  const gate=new ProjectReleaseGate({report:async()=>h.report},{assertTarget:async()=>h.baseline},{get:async()=>h.snapshot},environment,{get:async()=>candidate,validationReference:async()=>ref});
  const release=await gate.check('snapshot','validation');expect(release.binding).toEqual(h.report.binding);expect(release.runtimeSpec).toEqual(runtimeSpec);expect(selected).toEqual(['candidate']);
  ref.testPlanDigest='6'.repeat(64);await expect(gate.check('snapshot','validation')).rejects.toMatchObject({code:'VALIDATION_BINDING_CHANGED'});
  await expect(new ProjectReleaseGate({report:async()=>h.report},{assertTarget:async()=>h.baseline},{get:async()=>h.snapshot},environment).check('snapshot','validation')).rejects.toMatchObject({code:'CANDIDATE_VALIDATION_UNAVAILABLE'});
});
