import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {Snapshot} from '../../../../packages/contracts/src/index.js';
import type {AcceptanceBaseline} from '../../../../packages/contracts/src/baselines.js';
import type {DevelopmentJob,EngineeringRepair} from '../../../../packages/contracts/src/development.js';
import type {CandidateService} from '../candidates/candidate-service.js';
import type {ValidationService} from '../acceptance/application/validation-service.js';
import type {EngineeringPort} from './development-service.js';
import {contentDigest} from '../snapshots/domain/assembly.js';
import {AppError} from '../shared/errors.js';
export interface RepairSources {validations:Pick<ValidationService,'report'|'evidence'>;candidates:Pick<CandidateService,'get'|'validationReference'>}
export async function prepareRepair(pool:Pool,runner:EngineeringPort,sources:RepairSources|undefined,executionId:string,snapshot:Snapshot,baseline:AcceptanceBaseline):Promise<EngineeringRepair>{
 if(!sources||!runner.file)throw new AppError('REPAIR_UNAVAILABLE','失败报告与固定源码读取不可用',409);
 const report=await sources.validations.report(executionId);const ref=report.binding.candidate;
 if(report.snapshotId!==snapshot.id||report.baselineId!==baseline.id||report.binding.snapshotDigest!==snapshot.digest||report.binding.baselineDigest!==baseline.digest||report.binding.testSetDigest!==contentDigest(baseline.content.cases)||!ref||ref.provenance!=='generated-component'||!ref.developmentJobId)
  throw new AppError('REPAIR_TARGET_MISMATCH','修复报告必须绑定同一需求、基线和生成候选',409);
 if(report.verdict!=='failed'||report.cases.length!==baseline.content.cases.length||new Set(report.cases.map(c=>c.caseId)).size!==report.cases.length||report.cases.some(c=>!['passed','failed'].includes(c.status)))
  throw new AppError('REPAIR_NOT_IMPLEMENTATION_FAILURE','请先排除环境阻塞或未验证情况，再修复具有失败断言的候选',409);
 const candidate=await sources.candidates.get(ref.id);const reference=await sources.candidates.validationReference(ref.id);
 if(contentDigest(ref)!==contentDigest(reference)||candidate.snapshotId!==snapshot.id||candidate.artifactDigest!==report.binding.artifactDigest||candidate.generated?.baselineId!==baseline.id)
  throw new AppError('REPAIR_TARGET_MISMATCH','失败报告与候选版本不匹配',409);
 const parent=(await pool.query<{record:DevelopmentJob}>('SELECT record FROM development_jobs WHERE id=$1',[ref.developmentJobId])).rows[0]?.record;
 if(!parent||parent.status!=='built'||!parent.bundle||parent.bundle.digest!==candidate.generated.developmentBundleDigest||parent.bundle.planDigest!==ref.testPlanDigest)
  throw new AppError('REPAIR_SOURCE_MISMATCH','旧候选缺少匹配的固定构建包',409);
 const failures:EngineeringRepair['failures']=[];
 for(const item of report.cases){
  const expected=baseline.content.cases.find(c=>c.id===item.caseId);
  if(!expected||contentDigest(item.assertions.map(a=>({ruleId:a.ruleId,expected:a.expected})))!==contentDigest(expected.assertions)||item.assertions.some(a=>!['passed','failed'].includes(a.status))||!item.evidenceId||!item.evidenceDigest)
   throw new AppError('REPAIR_EVIDENCE_INCOMPLETE','修复需要完整的原始断言与执行证据',409);
  const evidence=await sources.validations.evidence(executionId,item.evidenceId);
  if(!evidence.complete||contentDigest(evidence)!==item.evidenceDigest)throw new AppError('REPAIR_EVIDENCE_INCOMPLETE','失败证据不完整',409);
  for(const assertion of item.assertions.filter(a=>a.status==='failed'))failures.push({caseId:item.caseId,input:expected.input,ruleId:assertion.ruleId,expected:assertion.expected,actual:assertion.actual,evidenceId:item.evidenceId,evidenceDigest:item.evidenceDigest});
 }
 if(!failures.length)throw new AppError('REPAIR_NOT_IMPLEMENTATION_FAILURE','没有可用于修复的失败断言',409);
 const files:EngineeringRepair['files']=[];
 for(const descriptor of parent.bundle.files.filter(f=>f.path!=='component.jar')){
  const file=await runner.file(parent.id,descriptor.path);
  if(file.path!==descriptor.path||file.digest!==descriptor.digest||createHash('sha256').update(file.content).digest('hex')!==descriptor.digest||Buffer.byteLength(file.content)!==descriptor.size||descriptor.size>32768)
   throw new AppError('REPAIR_SOURCE_MISMATCH','旧候选文件摘要不匹配',409);
  files.push(file);
 }
 return{reference:{executionId,reportDigest:contentDigest(report),candidateId:candidate.id,candidateBundleDigest:candidate.bundleDigest,artifactDigest:candidate.artifactDigest,parentJobId:parent.id,rootJobId:parent.repair?.rootJobId??parent.id,attempt:0,maxAttempts:3},bundle:parent.bundle,files,failures};
}
