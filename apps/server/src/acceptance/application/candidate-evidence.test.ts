import {expect,it} from 'vitest';
import {candidateEvidenceComplete} from './candidate-evidence.js';
import type {CaseObservation} from './case-assertions.js';
import type {Candidate,TestDeployment} from '../../../../../packages/contracts/src/candidates.js';
import type {ValidationBinding} from '../../../../../packages/contracts/src/validations.js';
import {runtimeModelProfile} from '../../../../runner/src/runtime/model-profile.js';
function fixture(){
  const generated={kind:'equipment-tool-skill@1' as const,developmentBundleDigest:'b'.repeat(64),sdkArtifactDigest:'a'.repeat(64),snapshotId:'snapshot',specDigest:'c'.repeat(64),componentDigest:'d'.repeat(64),skillDigest:'e'.repeat(64),classes:{'generated/EquipmentTool.class':'f'.repeat(64)}};
  const candidate:Candidate={id:'candidate',agentId:'agent',snapshotId:'snapshot',snapshotDigest:'1'.repeat(64),specDigest:generated.specDigest,artifactDigest:'9'.repeat(64),bundleDigest:'2'.repeat(64),provenance:'generated-component',createdAt:'',generated:{developmentJobId:'job',developmentBundleDigest:generated.developmentBundleDigest,baselineId:'baseline',baselineDigest:'3'.repeat(64),sourceDigest:'4'.repeat(64),runtimeArtifact:{kind:'generated-component',artifactDigest:'9'.repeat(64),sdkArtifactDigest:generated.sdkArtifactDigest,generated}}};
  const binding:ValidationBinding={baselineDigest:'3'.repeat(64),snapshotDigest:candidate.snapshotDigest,artifactDigest:candidate.artifactDigest,testSetDigest:'5'.repeat(64),compatibilityKey:'6'.repeat(64),modelProfile:runtimeModelProfile(),mockDigest:'7'.repeat(64),candidate:{id:candidate.id,bundleDigest:candidate.bundleDigest,provenance:candidate.provenance,developmentJobId:'job',testPlanDigest:'8'.repeat(64)}};
  const target:TestDeployment={id:'test',clientRequestId:'run',inputDigest:'0'.repeat(64),agentId:'agent',candidateId:candidate.id,snapshotId:'snapshot',deploymentId:'deployment',environmentId:'environment',environmentConfig:{seed:'enterprise-default@1',fault:'normal',clock:''},requirementBaselineId:'baseline',purpose:'test',binding,status:'stopped',failure:false,createdAt:'',updatedAt:'',expiresAt:'',validation:{executionId:'validation',caseId:'case',runId:'run',input:'query',actorId:'U1001'}};
  const observation:CaseObservation={run:{id:'run',status:'succeeded'},calls:[{runId:'run',operation:'equipment-status',status:200}],events:['skill_loaded','generated_tool_invoked'].map(event=>({data:{event:{event,sessionId:'run',skillDigest:generated.skillDigest,componentDigest:generated.componentDigest,developmentBundleDigest:generated.developmentBundleDigest}}})),actions:[],attempts:[],businessState:{},complete:true,
    candidateEvidence:{ingress:'/test-api/deployments/test',requestId:'request',candidate:binding.candidate!,testDeployment:target,loadedManifest:{status:'stopped',artifactDigest:candidate.artifactDigest,specDigest:candidate.specDigest,generated,modelProfile:binding.modelProfile}}};
  const check=()=>candidateEvidenceComplete(observation,candidate,binding,'validation',{caseId:'case',runId:'run',state:'running',testDeploymentId:'test',requestId:'request'});
  return{observation,check};
}
it('requires stopped actual candidate bytes and source-matched Skill/Tool events from the same Run',()=>{
  expect(fixture().check()).toBe(true);
  for(const mutate of [
    (o:CaseObservation)=>{delete o.candidateEvidence;},
    (o:CaseObservation)=>{o.candidateEvidence!.ingress='/agent-api/agents/agent';},
    (o:CaseObservation)=>{o.candidateEvidence!.testDeployment.status='ready';},
    (o:CaseObservation)=>{o.candidateEvidence!.loadedManifest={status:'stopped',artifactDigest:'a'.repeat(64)};},
    (o:CaseObservation)=>{o.events[0]={data:{event:{event:'skill_loaded',sessionId:'another-run'}}};},
    (o:CaseObservation)=>{o.events=[];}
  ]){const h=fixture();mutate(h.observation);expect(h.check()).toBe(false);}
});
