import {randomUUID,createHash} from 'node:crypto';
import type {AcceptanceBaseline} from '../../packages/contracts/src/baselines.js';
import type {EngineeringRepair} from '../../packages/contracts/src/development.js';
import {canonicalJson} from '../../packages/contracts/src/canonical.js';
import {generatedTool,generatedUnit,generatedSkill} from './generated-equipment.js';
export const defectiveTool=generatedTool.replace('"temperatureCelsius",data.get("temperatureCelsius")','"temperatureCelsius",("seed-equipment-001@1".equals(data.get("source")) ? 87 : data.get("temperatureCelsius"))');
export const repairUnit=generatedUnit.replaceAll('EquipmentToolTest','EquipmentRepair1Test').replaceAll('seed@1','seed-equipment-001@1').replace('temperature mapping','REPAIR_REGRESSION_FAILED: transport temperature must be preserved');
export const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function repairContext(baseline:AcceptanceBaseline,snapshotId:string,sdkArtifactDigest:string):EngineeringRepair{
 const plan=JSON.stringify({baselineDigest:baseline.digest,cases:baseline.content.cases.map(c=>({caseId:c.id,requirementIds:c.requirementIds,assertions:c.assertions,steps:['Invoke candidate','Verify external facts']}))});
 const files=[{path:'src/generated/EquipmentTool.java',content:defectiveTool},{path:'test/generated/EquipmentToolTest.java',content:generatedUnit},{path:'skills/equipment-query/SKILL.md',content:generatedSkill},{path:'rails/definition.json',content:'{"schemaVersion":1,"rails":[]}'},{path:'test-plan.json',content:plan}].map(f=>({...f,digest:sha(f.content)}));
 const body={artifactDigest:'a'.repeat(64),sourceDigest:'b'.repeat(64),profileDigest:'c'.repeat(64),sdkArtifactDigest,snapshotId,baselineId:baseline.id,baselineDigest:baseline.digest,planDigest:sha(plan),files:files.map(f=>({path:f.path,digest:f.digest,size:Buffer.byteLength(f.content)})),unitRedId:randomUUID(),unitGreenId:randomUUID(),contractCheckId:randomUUID(),buildId:randomUUID()};
 const parentJobId=randomUUID();return{reference:{executionId:randomUUID(),reportDigest:'d'.repeat(64),candidateId:randomUUID(),candidateBundleDigest:'e'.repeat(64),artifactDigest:'f'.repeat(64),parentJobId,rootJobId:parentJobId,attempt:1,maxAttempts:3},bundle:{...body,digest:sha(canonicalJson(body))},files,failures:[{caseId:baseline.content.cases[0]!.id,input:baseline.content.cases[0]!.input,ruleId:'equipment-facts',expected:86,actual:87,evidenceId:randomUUID(),evidenceDigest:'1'.repeat(64)}]};
}
