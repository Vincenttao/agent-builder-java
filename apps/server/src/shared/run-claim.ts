import type {PoolClient} from 'pg';
import type {RunRecord} from '../../../../packages/contracts/src/runs.js';
import {AppError} from './errors.js';
export interface RunClaim {runId:string;owner:string;token:string}
export async function assertRunClaim(client:PoolClient,claim:RunClaim){
  const record=(await client.query<{record:RunRecord}>(`SELECT record FROM runs WHERE id=$1 AND lease_owner=$2 AND worker_fencing_token=$3
    AND lease_until>clock_timestamp() AND record->>'status' NOT IN ('succeeded','failed','cancelled','interrupted') FOR UPDATE`,[claim.runId,claim.owner,claim.token])).rows[0]?.record;
  if(!record)throw new AppError('RUN_CLAIM_LOST','运行已结束或由其他 worker 接管',409);return record;
}
