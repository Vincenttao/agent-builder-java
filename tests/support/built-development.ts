import {randomUUID} from 'node:crypto';
import type {Pool} from '../../apps/server/src/db/pool.js';
import type {Snapshot} from '../../packages/contracts/src/index.js';
import type {AcceptanceBaseline} from '../../packages/contracts/src/baselines.js';
import type {DevelopmentJob,GeneratedBundle,EngineeringTaskInput} from '../../packages/contracts/src/development.js';
import type {RuntimeArtifact} from '../../packages/contracts/src/artifacts.js';
import {equipmentGenerationRequest} from '../../packages/contracts/src/generation-profile.js';
import {contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
/** Database admission fixture only. It does not prove actual generation, compilation or JAR loading. */
export async function builtDevelopmentFixture(pool:Pool,snapshot:Snapshot,baseline:AcceptanceBaseline,baseDigest:string){
 const body={artifactDigest:'c'.repeat(64),sourceDigest:'d'.repeat(64),profileDigest:'e'.repeat(64),sdkArtifactDigest:baseDigest,
  snapshotId:snapshot.id,baselineId:baseline.id,baselineDigest:baseline.digest,planDigest:'f'.repeat(64),files:[{path:'skills/equipment-query/SKILL.md',digest:'1'.repeat(64),size:200}],unitRedId:randomUUID(),unitGreenId:randomUUID(),contractCheckId:randomUUID(),buildId:randomUUID()};
 const bundle:GeneratedBundle={...body,digest:contentDigest(body)};
 const task:EngineeringTaskInput={context:{snapshotId:snapshot.id,baseline,goal:'fixture'},generation:{...equipmentGenerationRequest,scope:[...equipmentGenerationRequest.scope],dependencies:[...equipmentGenerationRequest.dependencies]},maxSeconds:30};
 const now=new Date().toISOString();const job:DevelopmentJob={id:randomUUID(),agentId:snapshot.draftId,snapshotId:snapshot.id,baselineId:baseline.id,baselineDigest:baseline.digest,inputDigest:contentDigest(task),status:'built',createdAt:now,updatedAt:now,roles:[],bundle};
 await pool.query('INSERT INTO development_jobs(id,draft_id,snapshot_id,baseline_id,client_request_id,input_digest,task_input,record) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[job.id,job.agentId,snapshot.id,baseline.id,randomUUID(),job.inputDigest,task,job]);
 const artifact:RuntimeArtifact={kind:'generated-component',artifactDigest:'9'.repeat(64),sdkArtifactDigest:baseDigest,generated:{kind:'equipment-tool-skill@1',developmentBundleDigest:bundle.digest,sdkArtifactDigest:baseDigest,snapshotId:snapshot.id,specDigest:contentDigest(snapshot.content.runtimeSpec),componentDigest:bundle.artifactDigest,skillDigest:'1'.repeat(64),classes:{'generated/EquipmentTool.class':'2'.repeat(64)}}};
 return{job,bundle,artifact};
}
