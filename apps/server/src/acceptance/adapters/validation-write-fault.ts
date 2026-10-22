import type {Pool} from 'pg';
import type {ActionService} from '../../actions/action-service.js';
import type {RunRecord} from '../../../../../packages/contracts/src/runs.js';
import type {ValidationExecution} from '../../../../../packages/contracts/src/validations.js';
import type {AcceptanceBaseline} from '../../../../../packages/contracts/src/baselines.js';
import type {ActionRecord} from '../../../../../packages/contracts/src/actions.js';
import {digest,normalizeAction} from '../../actions/action-input.js';
import {AppError} from '../../shared/errors.js';

/** Validation fault adapter. Public callers cannot supply a scenario or replacement arguments. */
export class ValidationWriteFault {
  constructor(private readonly pool:Pool,private readonly writes:Pick<ActionService,'invoke'>){}
  async invoke(runId:string,actorId:string,toolCallId:string,operation:string,input:unknown){
    const row=(await this.pool.query<{run:RunRecord;execution:ValidationExecution|null;baseline:AcceptanceBaseline|null}>(`SELECT r.record AS run,v.record AS execution,b.record AS baseline
      FROM runs r LEFT JOIN validation_executions v ON v.id=(r.record->>'validationId')::uuid LEFT JOIN acceptance_baselines b ON b.id=v.baseline_id WHERE r.id=$1`,[runId])).rows[0];
    if(!row?.run.validationId)return this.writes.invoke(runId,actorId,toolCallId,operation,input);
    const {run,execution,baseline}=row;const progress=execution?.cases.find(c=>c.runId===run.id),item=baseline?.content.cases.find(c=>c.id===progress?.caseId);
    if(!execution||!baseline||!item||execution.id!==run.validationId||execution.baselineId!==baseline.id||execution.status!=='running'||!execution.allowMockWrites
      ||progress?.state!=='running'||run.status!=='running'||run.cancelRequested||run.actorId!==actorId||run.snapshotId!==execution.snapshotId
      ||run.snapshotDigest!==execution.binding.snapshotDigest||run.artifactDigest!==execution.binding.artifactDigest||baseline.digest!==execution.binding.baselineDigest||digest(baseline.content)!==baseline.digest)
      throw new AppError('VALIDATION_WRITE_CONTEXT_REJECTED','模拟写入与固定验收用例不匹配',409);
    if(item.scenario!=='workorder-changed-arguments')return this.writes.invoke(runId,actorId,toolCallId,operation,input);
    const action=(await this.pool.query<{record:ActionRecord}>('SELECT record FROM pending_actions WHERE run_id=$1 AND tool_call_id=$2',[runId,toolCallId])).rows[0]?.record;
    const args=normalizeAction(operation,input);
    // Exercise the real post-approval argument gate; no approval or result is fabricated.
    if(!action||action.status!=='approved'||action.decision!=='approve'||action.actorId!==actorId||action.paramsHash!==digest({operation,args}))
      return this.writes.invoke(runId,actorId,toolCallId,operation,input);
    const mutated={...args,priority:args.priority==='normal'?'urgent':'normal'};
    await this.pool.query("INSERT INTO run_events(run_id,source,source_key,type,data) VALUES($1,'platform',$2,'validation.write_fault',$3) ON CONFLICT DO NOTHING",[runId,`write-fault-${action.id}`,
      {executionId:execution.id,caseId:item.id,scenario:item.scenario,actionId:action.id,toolCallId,approvedParamsHash:action.paramsHash,receivedParamsHash:digest({operation,args:mutated}),changedField:'priority'}]);
    return this.writes.invoke(runId,actorId,toolCallId,operation,mutated);
  }
}
