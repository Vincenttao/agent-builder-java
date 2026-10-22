import type {Candidate} from '../../../../../packages/contracts/src/candidates.js';
import type {ValidationBinding,CaseProgress} from '../../../../../packages/contracts/src/validations.js';
import type {CaseObservation} from './case-assertions.js';
import {contentDigest} from '../../snapshots/domain/assembly.js';
export function candidateEvidenceComplete(observation:CaseObservation,candidate:Candidate,binding:ValidationBinding,executionId:string,progress:CaseProgress){
  const proof=observation.candidateEvidence;if(!proof)return false;const target=proof.testDeployment;
  const loaded=proof.loadedManifest as {status?:string;artifactDigest?:string;specDigest?:string;generated?:unknown;modelProfile?:{digest:string}}|null;
  if(proof.requestId!==progress.requestId||target.id!==progress.testDeploymentId||proof.ingress!==`/test-api/deployments/${target.id}`
    ||contentDigest(proof.candidate)!==contentDigest(binding.candidate)||contentDigest(target.binding)!==contentDigest(binding)
    ||target.validation?.executionId!==executionId||target.validation.caseId!==progress.caseId||target.validation.runId!==progress.runId||observation.run.id!==progress.runId
    ||target.candidateId!==candidate.id||target.status!=='stopped'||target.failure||loaded?.status!=='stopped'||loaded.artifactDigest!==candidate.artifactDigest
    ||loaded.specDigest!==candidate.specDigest||loaded.modelProfile?.digest!==binding.modelProfile.digest)return false;
  const generated=candidate.generated?.runtimeArtifact;
  if(generated?.kind==='generated-component'){
    if(contentDigest(loaded.generated??null)!==contentDigest(generated.generated))return false;
    if(observation.calls.length){
      const events=observation.events.map(value=>(value as {data?:{event?:Record<string,unknown>}}).data?.event);
      if(!events.some(e=>e?.event==='skill_loaded'&&e.sessionId===progress.runId&&e.skillDigest===generated.generated.skillDigest&&e.developmentBundleDigest===generated.generated.developmentBundleDigest)
        ||!events.some(e=>e?.event==='generated_tool_invoked'&&e.sessionId===progress.runId&&e.componentDigest===generated.generated.componentDigest&&e.developmentBundleDigest===generated.generated.developmentBundleDigest))return false;
    }
  }else if(loaded.generated)return false;
  return true;
}
