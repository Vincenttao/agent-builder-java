import type { ReleaseGate } from './release-service.js';
import type { ValidationService, ValidationDriver } from '../acceptance/application/validation-service.js';
import type { BaselineService } from '../acceptance/application/baseline-service.js';
import type { SnapshotService } from '../snapshots/application/snapshot-service.js';
import { AppError } from '../shared/errors.js';
import { contentDigest } from '../snapshots/domain/assembly.js';
import { validationBinding } from '../acceptance/application/validation-binding.js';
import type {CandidateService} from '../candidates/candidate-service.js';
export class ProjectReleaseGate implements ReleaseGate {
  constructor(private readonly validations: Pick<ValidationService,'report'>, private readonly baselines: Pick<BaselineService,'assertTarget'>, private readonly snapshots: Pick<SnapshotService,'get'>, private readonly environment: Pick<ValidationDriver,'identity'>,private readonly candidates?:Pick<CandidateService,'get'|'validationReference'>) {}
  async check(snapshotId:string,validationId:string) {
    const snapshot = await this.snapshots.get(snapshotId); const report = await this.validations.report(validationId);
    if(report.binding.modelProfile.executionMode!=='live-mock') throw new AppError('REAL_EXECUTION_REQUIRED','缺少真实模型执行验证，不能发布',409);
    if(report.verdict!=='passed'||report.reasons.length) throw new AppError('VALIDATION_NOT_PASSED','验收尚未通过，不能发布',409);
    if(report.snapshotId!==snapshotId||report.executionId!==validationId) throw new AppError('RELEASE_TARGET_MISMATCH','报告与发布目标不一致',409);
    const baseline=await this.baselines.assertTarget(report.baselineId,snapshot);
    if(!baseline.content.cases.length||report.cases.length!==baseline.content.cases.length) throw new AppError('VALIDATION_INCOMPLETE','验收用例集合不完整',409);
    for(const expected of baseline.content.cases){
      const matches=report.cases.filter(c=>c.caseId===expected.id); const actual=matches[0];
      if(matches.length!==1||!actual||actual.status!=='passed'||actual.reasons.length||!actual.evidenceId||!actual.evidenceDigest||!/^[a-f0-9]{64}$/.test(actual.evidenceDigest)||!expected.assertions.length||actual.assertions.length!==expected.assertions.length) throw new AppError('VALIDATION_INCOMPLETE','验收结果或证据不完整',409);
      for(const rule of expected.assertions){
        const matched=actual.assertions.filter(a=>a.ruleId===rule.ruleId); const result=matched[0];
        if(matched.length!==1||!result||result.status!=='passed'||contentDigest(result.expected)!==contentDigest(rule.expected)||contentDigest(result.actual)!==contentDigest(rule.expected)) throw new AppError('VALIDATION_INCOMPLETE','验收断言与确认基线不一致',409);
      }
    }
    const identity=await this.environment.identity(report.binding.candidate?.id);const current=validationBinding(snapshot,baseline,identity);
    if(report.binding.candidate){
      if(!this.candidates)throw new AppError('CANDIDATE_VALIDATION_UNAVAILABLE','无法核验报告对应的候选制品',409);
      const candidate=await this.candidates.get(report.binding.candidate.id);
      if(candidate.snapshotId!==snapshot.id||candidate.artifactDigest!==report.binding.artifactDigest||candidate.snapshotDigest!==snapshot.digest)throw new AppError('RELEASE_TARGET_MISMATCH','报告与候选制品不匹配',409);
      current.candidate=await this.candidates.validationReference(candidate.id);
    }
    if(identity.modelProfile.executionMode!=='live-mock'||contentDigest(current)!==contentDigest(report.binding)) throw new AppError('VALIDATION_BINDING_CHANGED','运行环境或目标版本已变化，需要重新验证',409);
    return { agentId:snapshot.draftId,snapshotId,validationId,binding:report.binding };
  }
}
