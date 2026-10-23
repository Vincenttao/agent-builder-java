import {randomUUID} from 'node:crypto';
import type {Pool} from '../../apps/server/src/db/pool.js';
import type {Snapshot} from '../../packages/contracts/src/index.js';
import type {AcceptanceBaseline} from '../../packages/contracts/src/baselines.js';
import type {DevelopmentJob,GeneratedBundle,EngineeringTaskInput,GenerationRequest} from '../../packages/contracts/src/development.js';
import {equipmentGenerationRequest,wealthBalanceGenerationRequest,wealthAssistantGenerationRequest,generatedRuntimeTools} from '../../packages/contracts/src/generation-profile.js';
import {contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
import {effectiveRuntimeSpec,type GeneratedRailDefinition} from '../../packages/contracts/src/rail-generation.js';
/** Database admission fixture only. It does not prove actual generation, compilation or JAR loading. */
export async function builtDevelopmentFixture(pool:Pool,snapshot:Snapshot,baseline:AcceptanceBaseline,baseDigest:string,goal='fixture',railDefinition:GeneratedRailDefinition={schemaVersion:1,rails:[]},generation:GenerationRequest={...equipmentGenerationRequest,scope:[...equipmentGenerationRequest.scope],dependencies:[...equipmentGenerationRequest.dependencies]}){
 const runtimeBase=structuredClone(snapshot.content.runtimeSpec);const generatedTools=generatedRuntimeTools(generation.profileVersion);if(generatedTools&&runtimeBase.tools.length===0)runtimeBase.tools=generatedTools;
 const runtimeSpec=effectiveRuntimeSpec(runtimeBase,railDefinition);const finance=generation.profileVersion===wealthBalanceGenerationRequest.profileVersion;const assistant=generation.profileVersion===wealthAssistantGenerationRequest.profileVersion;
 const skillPath=assistant?'skills/wealth-query/SKILL.md':finance?'skills/balance-query/SKILL.md':'skills/equipment-query/SKILL.md';const toolClass=assistant?'generated.WealthQueryTool':finance?'generated.AccountBalanceTool':'generated.EquipmentTool';
 const body={artifactDigest:'c'.repeat(64),sourceDigest:'d'.repeat(64),profileDigest:'e'.repeat(64),sdkArtifactDigest:baseDigest,
  profileVersion:generation.profileVersion,snapshotId:snapshot.id,baselineId:baseline.id,baselineDigest:baseline.digest,planDigest:'f'.repeat(64),railDefinition,runtimeSpec,files:[{path:skillPath,digest:'1'.repeat(64),size:200}],unitRedId:randomUUID(),unitGreenId:randomUUID(),contractCheckId:randomUUID(),buildId:randomUUID()};
 const bundle:GeneratedBundle={...body,digest:contentDigest(body)};
 const task:EngineeringTaskInput={context:{snapshotId:snapshot.id,baseline,goal,runtimeSpec:snapshot.content.runtimeSpec},generation:{...generation,scope:[...generation.scope],dependencies:[...generation.dependencies]},maxSeconds:30};
 const now=new Date().toISOString();const job:DevelopmentJob={id:randomUUID(),agentId:snapshot.draftId,snapshotId:snapshot.id,baselineId:baseline.id,baselineDigest:baseline.digest,inputDigest:contentDigest(task),status:'built',createdAt:now,updatedAt:now,roles:[],bundle};
 await pool.query('INSERT INTO development_jobs(id,draft_id,snapshot_id,baseline_id,client_request_id,input_digest,task_input,record) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[job.id,job.agentId,snapshot.id,baseline.id,randomUUID(),job.inputDigest,task,job]);
 const primary=generatedTools?.[0];const artifact={kind:'generated-component' as const,artifactDigest:'9'.repeat(64),sdkArtifactDigest:baseDigest,generated:{kind:assistant?'generated-tool-skill@2' as const:'generated-tool-skill@1' as const,developmentBundleDigest:bundle.digest,sdkArtifactDigest:baseDigest,snapshotId:snapshot.id,specDigest:contentDigest(runtimeSpec),componentDigest:bundle.artifactDigest,skillDigest:'1'.repeat(64),classes:{[`${toolClass.replaceAll('.','/')}.class`]:'2'.repeat(64)},toolClassName:toolClass,toolName:primary!.name,operationId:primary!.operationId,skillName:assistant?'wealth-query':finance?'balance-query':'equipment-query',skillPath,...(assistant?{toolBindings:generatedTools!.map(tool=>({toolClassName:toolClass,toolName:tool.name,operationId:tool.operationId}))}:{})}};
 return{job,bundle,artifact};
}
