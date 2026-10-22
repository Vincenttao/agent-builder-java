import type {BusinessCase} from '../../../../../packages/contracts/src/baselines.js';
import type {CaseProgress} from '../../../../../packages/contracts/src/validations.js';
import type {TestDeployment} from '../../../../../packages/contracts/src/candidates.js';
import type {InvocationView} from '../../../../../packages/contracts/src/invocations.js';
import type {ValidationDriver,ValidationTarget} from '../application/validation-service.js';
import type {CaseObservation} from '../application/case-assertions.js';
import type {CandidateService} from '../../candidates/candidate-service.js';
import type {RunService,RunRuntime} from '../../runs/run-service.js';
import type {PublishedRuntime} from '../../invocations/invocation-service.js';
import type {HttpMock} from '../../runs/http-ports.js';
import type {PostgresActions} from '../../actions/postgres-actions.js';
import type {ValidationClaim} from '../../shared/validation-claim.js';
import type {TestApiClient} from './test-api-client.js';
import {runtimeArtifactMatches} from '../../runs/artifact-binding.js';
import {contentDigest} from '../../snapshots/domain/assembly.js';
import {AppError} from '../../shared/errors.js';
const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
/** Every business request uses the candidate HTTP ingress. Control ports only collect independent evidence. */
export class CandidateValidationDriver implements ValidationDriver {
  readonly candidateValidation=true as const;
  constructor(private readonly legacy:ValidationDriver,private readonly candidates:CandidateService,private readonly runtime:RunRuntime&PublishedRuntime,
    private readonly mock:HttpMock,private readonly runs:RunService,private readonly actions:PostgresActions,private readonly http:TestApiClient){}
  async identity(candidateId?:string){
    const identity=await this.legacy.identity();if(!candidateId)return identity;
    const candidate=await this.candidates.get(candidateId);
    if(!await runtimeArtifactMatches(this.runtime,candidate.artifactDigest,identity.artifactDigest,candidate.specDigest,candidate.snapshotId,candidate.generated?.runtimeArtifact))throw new AppError('CANDIDATE_RUNTIME_CHANGED','候选制品不可用或已变化',409);
    return{...identity,artifactDigest:candidate.artifactDigest};
  }
  async advance(target:ValidationTarget,item:BusinessCase,progress:CaseProgress):ReturnType<ValidationDriver['advance']>{
    if(!target.binding.candidate)return this.legacy.advance(target,item,progress);
    const authority={...target.claim,runId:progress.runId};
    if(!progress.testDeploymentId){
      const deployment=await this.http.management<TestDeployment>('/api/test-deployments','POST',{clientRequestId:progress.runId,candidateId:target.binding.candidate.id,
        requirementBaselineId:target.baselineId,suiteDigest:target.binding.testSetDigest,purpose:'test',ttlSeconds:900},authority);
      return{pending:true,progress:{...progress,testDeploymentId:deployment.id}};
    }
    const root=`/api/test-deployments/${progress.testDeploymentId}`;const deployment=await this.http.management<TestDeployment>(root);
    if(deployment.validation?.executionId!==target.claim.executionId||deployment.validation.runId!==progress.runId||contentDigest(deployment.binding)!==contentDigest(target.binding))throw new AppError('VALIDATION_CASE_MISMATCH','测试部署绑定不匹配',409);
    if(deployment.status==='preparing'||deployment.status==='stopping')return{pending:true,progress};
    if(deployment.status==='failed')throw new AppError('TEST_DEPLOYMENT_FAILED','测试部署准备或停止失败',409);
    if(deployment.status==='stopped'){
      if(!progress.requestId)throw new AppError('TEST_REQUEST_MISSING','测试部署停止前没有可核验请求',409);
      const view=await this.http.management<InvocationView>(`${root}/requests/${progress.requestId}`);
      return this.observe(target,item,progress,deployment,view);
    }
    const session=await this.http.management<{token:string}>(`${root}/sessions`,'POST',{actorId:deployment.validation.actorId},authority);
    if(!progress.requestId){
      const view=await this.http.business<InvocationView>(deployment.id,session.token,'/messages','POST',{clientRequestId:progress.runId,input:item.input});
      if(view.runId!==progress.runId)throw new AppError('VALIDATION_CASE_MISMATCH','测试入口返回了错误的 Run',409);
      return{pending:true,progress:{...progress,requestId:view.requestId}};
    }
    const request=`/requests/${progress.requestId}`;const view=await this.http.business<InvocationView>(deployment.id,session.token,request);
    if(view.run?.status==='waiting_confirmation'){
      if(!item.scenario.startsWith('workorder-'))await this.http.business(deployment.id,session.token,`${request}/cancel`,'POST',{});
      else if(!progress.beforeApprovalCalls)return{pending:true,progress:{...progress,beforeApprovalCalls:await this.mock.calls(deployment.environmentId,progress.runId)}};
      else{
        const action=view.actions.find(a=>a.status==='pending');
        if(action&&item.scenario!=='workorder-expired'&&!progress.decisionSubmitted){
          const decision={decisionId:progress.runId,actionHash:action.actionHash,decision:item.scenario==='workorder-reject'?'reject':'approve'};
          await this.http.business(deployment.id,session.token,`${request}/actions/${action.id}/decision`,'POST',decision);
          if(decision.decision==='approve')await this.http.business(deployment.id,session.token,`${request}/actions/${action.id}/decision`,'POST',decision);
          return{pending:true,progress:{...progress,decisionSubmitted:true}};
        }
      }
    }
    if(view.run&&terminal.has(view.run.status))await this.http.management(`${root}/stop`,'POST',{},authority);
    return{pending:true,progress};
  }
  private async observe(target:ValidationTarget,item:BusinessCase,progress:CaseProgress,deployment:TestDeployment,view:InvocationView):Promise<CaseObservation>{
    if(!view.run||view.runId!==progress.runId||view.requestId!==progress.requestId||view.candidateId!==target.binding.candidate!.id||view.testDeploymentId!==deployment.id)throw new Error('TEST_REQUEST_MISMATCH');
    const [environment,calls,actions,loaded]=await Promise.all([this.mock.inspect(deployment.environmentId),this.mock.calls(deployment.environmentId,progress.runId),this.actions.list(progress.runId),this.runtime.deployment(deployment.deploymentId)]);
    const events:unknown[]=[];let after=0;
    for(let page=0;;page++){if(page===20)throw new Error('EVIDENCE_LIMIT_REACHED');const part=await this.runs.events(progress.runId,after);events.push(...part);if(part.length<500)break;after=part.at(-1)!.seq;}
    const attempts=(await Promise.all(actions.map(action=>this.actions.attempts(action.id)))).flat();
    const expected={seed:'enterprise-default@1',fault:item.fault,clock:'2026-10-21T08:00:00.000Z'};
    const complete=terminal.has(view.run.status)&&deployment.status==='stopped'&&!deployment.failure&&loaded.status==='stopped'
      &&loaded.artifactDigest===target.binding.artifactDigest&&loaded.specDigest===contentDigest(target.snapshot.content.runtimeSpec)&&loaded.modelProfile?.digest===target.binding.modelProfile.digest
      &&environment.id===deployment.environmentId&&view.run.environmentId===environment.id&&Number.isInteger(environment.revision)&&environment.revision>=1&&contentDigest(environment.config)===contentDigest(expected)
      &&view.run.validationId===target.claim.executionId&&view.run.artifactDigest===target.binding.artifactDigest;
    return{run:view.run,calls:calls as Record<string,unknown>[],actions,attempts,events,businessState:environment.state,complete,
      candidateEvidence:{ingress:`/test-api/deployments/${deployment.id}`,requestId:view.requestId,candidate:target.binding.candidate!,testDeployment:deployment,loadedManifest:loaded},
      ...(progress.beforeApprovalCalls?{beforeApprovalCalls:progress.beforeApprovalCalls}:{})};
  }
  async cancel(runId:string,claim:ValidationClaim){
    const {target}=await this.http.management<{target:TestDeployment|null}>(`/api/test-deployments/by-validation-run/${runId}`);
    if(!target)return this.legacy.cancel(runId,claim);
    const stopped=await this.http.management<TestDeployment>(`/api/test-deployments/${target.id}/stop`,'POST',{}, {...claim,runId});
    return['stopped','failed'].includes(stopped.status);
  }
}
