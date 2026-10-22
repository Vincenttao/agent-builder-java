import type { BusinessCase } from '../../../../../packages/contracts/src/baselines.js';
import type { CaseProgress } from '../../../../../packages/contracts/src/validations.js';
import type { RunEvent } from '../../../../../packages/contracts/src/runs.js';
import type { ValidationDriver, ValidationTarget } from '../application/validation-service.js';
import type { CaseObservation } from '../application/case-assertions.js';
import type { RunService } from '../../runs/run-service.js';
import type { HttpMock } from '../../runs/http-ports.js';
import type { PostgresActions } from '../../actions/postgres-actions.js';
import { AppError } from '../../shared/errors.js';
import { canonicalJson } from '../../../../../packages/contracts/src/canonical.js';
import type { ValidationClaim } from '../../shared/validation-claim.js';
const terminal = new Set(['succeeded','failed','cancelled','interrupted']);
export class RunValidationDriver implements ValidationDriver {
  constructor(private readonly runs: RunService, private readonly mock: HttpMock, private readonly actions: PostgresActions) {}
  async identity() {
    const [ready, manifest] = await Promise.all([this.runs.readiness(), this.mock.identity()]);
    if (!ready.canRun || !ready.runtime?.modelProfile) throw new AppError('VALIDATION_ENVIRONMENT_BLOCKED', '运行环境或模型版本信息不可用', 409);
    return { artifactDigest: ready.runtime.artifactDigest, modelProfile: ready.runtime.modelProfile, mockDigest: manifest.implementationDigest };
  }
  async advance(target: ValidationTarget, item: BusinessCase, progress: CaseProgress): ReturnType<ValidationDriver['advance']> {
    const config = { seed: 'enterprise-default@1' as const, fault: item.fault, clock: '2026-10-21T08:00:00.000Z' };
    const run = await this.runs.create(target.snapshot.id, { clientRequestId: progress.runId, input: item.input }, { runId: progress.runId, environmentConfig: config, artifactDigest: target.binding.artifactDigest, modelDigest: target.binding.modelProfile.digest, claim: target.claim });
    if (run.status === 'waiting_confirmation') {
      if (!item.scenario.startsWith('workorder-')) { await this.runs.cancel(run.id, target.claim); return { pending: true, progress }; }
      // Persist this observation before any approval. A worker restart must not lose the pre-write evidence.
      if (!progress.beforeApprovalCalls) return { pending: true, progress: { ...progress, beforeApprovalCalls: await this.mock.calls(run.environmentId, run.id) } };
      const actions = await this.actions.list(run.id); const action = actions.find(a => a.status === 'pending');
      if (action && item.scenario !== 'workorder-expired' && !progress.decisionSubmitted) {
        const decision = item.scenario === 'workorder-reject' ? 'reject' : 'approve';
        await this.actions.decide(action.id, run.id, run.actorId, { decisionId: progress.runId, actionHash: action.actionHash, decision }, target.claim);
        if (decision === 'approve') await this.actions.decide(action.id, run.id, run.actorId, { decisionId: progress.runId, actionHash: action.actionHash, decision }, target.claim);
        return { pending: true, progress: { ...progress, decisionSubmitted: true } };
      }
    }
    if (!terminal.has(run.status)) return { pending: true, progress };
    const [environment, calls, actions] = await Promise.all([this.mock.inspect(run.environmentId), this.mock.calls(run.environmentId, run.id), this.actions.list(run.id)]);
    const events: RunEvent[] = []; let after = 0;
    for (let page = 0; ; page++) {
      if (page === 20) throw new Error('EVIDENCE_LIMIT_REACHED');
      const part = await this.runs.events(run.id, after); events.push(...part); if (part.length < 500) break; after = part.at(-1)!.seq;
    }
    const attempts = (await Promise.all(actions.map(action => this.actions.attempts(action.id)))).flat();
    const observation: CaseObservation = { run, calls: calls as Record<string, unknown>[], actions, attempts, events, businessState: environment.state,
      complete: environment.id === run.environmentId && Number.isInteger(environment.revision) && environment.revision >= 1 && canonicalJson(environment.config) === canonicalJson(config),
      ...(progress.beforeApprovalCalls ? { beforeApprovalCalls: progress.beforeApprovalCalls } : {}) };
    return observation;
  }
  async cancel(runId: string, claim: ValidationClaim) {
    try { return terminal.has((await this.runs.cancel(runId, claim)).status); }
    catch (error) { if (error instanceof AppError && error.code === 'RUN_NOT_FOUND') return true; throw error; }
  }
}
