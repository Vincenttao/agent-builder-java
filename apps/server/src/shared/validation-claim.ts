import type { PoolClient } from 'pg';
import type { ValidationExecution } from '../../../../packages/contracts/src/validations.js';
import type { TestDeployment } from '../../../../packages/contracts/src/candidates.js';
import { AppError } from './errors.js';
/** Internal admission authority; never accepted by a public request schema. */
export interface ValidationClaim { executionId: string; owner: string; token: string }
export interface ValidationTestAuthority extends ValidationClaim {runId:string}
export async function assertTestAuthority(client:PoolClient,target:TestDeployment,authority?:ValidationTestAuthority,cancelling=false){
  if(!target.validation){if(authority)throw new AppError('VALIDATION_CASE_MISMATCH','测试部署不属于此验收任务',409);return;}
  if(!authority)throw new AppError('VALIDATION_AUTHORITY_REQUIRED','自动验收入口仅接受当前执行器授权',403);
  const record=await assertValidationClaim(client,authority,authority.runId,cancelling);
  if(target.validation.executionId!==record.id||target.validation.runId!==authority.runId||record.binding.candidate?.id!==target.candidateId
    ||record.cases.find(c=>c.runId===authority.runId)?.caseId!==target.validation.caseId)throw new AppError('VALIDATION_CASE_MISMATCH','执行授权与测试用例不匹配',409);
}
export async function assertValidationClaim(client: PoolClient, claim: ValidationClaim, runId: string, cancelling = false) {
  const record = (await client.query<{ record: ValidationExecution }>(`SELECT record FROM validation_executions WHERE id=$1 AND lease_owner=$2
    AND fencing_token=$3 AND lease_until>clock_timestamp() FOR UPDATE`, [claim.executionId, claim.owner, claim.token])).rows[0]?.record;
  if (!record || !['queued','running', ...(cancelling ? ['cancelling'] : [])].includes(record.status)
      || !record.cases.some(item => item.runId === runId && item.state !== 'completed')) throw new AppError('VALIDATION_CLAIM_LOST', '验证任务已取消、已结束或已由其他执行器接管', 409);
  return record;
}
