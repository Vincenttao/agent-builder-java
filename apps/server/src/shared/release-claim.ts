import type { PoolClient } from 'pg';
import type { ReleaseOperation } from '../../../../packages/contracts/src/releases.js';
import { AppError } from './errors.js';
export interface ReleaseClaim { kind: 'release'; operationId: string; owner: string; token: string }
export async function assertReleaseClaim(client: PoolClient, claim: ReleaseClaim, runId: string) {
  const record = (await client.query<{record: ReleaseOperation}>(`SELECT record FROM release_operations
    WHERE id=$1 AND lease_owner=$2 AND fencing_token=$3 AND lease_until>clock_timestamp() FOR UPDATE`, [claim.operationId, claim.owner, claim.token])).rows[0]?.record;
  if (!record || !['queued','preparing','smoking'].includes(record.status) || record.smokeRunId !== runId)
    throw new AppError('RELEASE_CLAIM_LOST', '发布任务已结束或由其他执行器接管', 409);
  return record;
}
