import type {EngineeringRole,GenerationRequest} from '../../../../packages/contracts/src/development.js';
import {equipmentGenerationRequest,generationPolicyError} from '../../../../packages/contracts/src/generation-profile.js';
import {createHash} from 'node:crypto';
import {toolStub,toolContract,repairContract,engineeringSkills,platformContractTest} from './templates.js';
export class PolicyError extends Error {constructor(public readonly code:string){super(code);}}
export const generationProfile={version:equipmentGenerationRequest.profileVersion,executionMode:'trusted-local',scope:equipmentGenerationRequest.scope,
  dependencies:equipmentGenerationRequest.dependencies,connectionProfile:equipmentGenerationRequest.connectionProfile,
  templates:Object.fromEntries(Object.entries({toolStub,toolContract,repairContract,platformContractTest,...engineeringSkills}).map(([name,source])=>[name,createHash('sha256').update(source).digest('hex')])),
  engineVersion:'1.19.3',model:'deepseek-local/deepseek-v4-flash',maxSteps:16,maxTaskSeconds:900,maxCommandSeconds:60,maxFileBytes:32768,maxOutputBytes:262144,
  commands:['unit-test','build'],developerFiles:['src/generated/EquipmentTool.java','test/generated/EquipmentToolTest.java','skills/equipment-query/SKILL.md'],testerFiles:['tests/plan.json','tests/proposal.json'],
  repair:{maxAttempts:3,regressionFiles:['test/generated/EquipmentRepair1Test.java','test/generated/EquipmentRepair2Test.java','test/generated/EquipmentRepair3Test.java']}
} as const;
export function validateGenerationRequest(request:GenerationRequest):void{
  const error=generationPolicyError(request);if(error)throw new PolicyError(error);
}
export function checkFileAccess(role:EngineeringRole,operation:'read'|'write',path:string,repairAttempt=0):void{
  const own:readonly string[]=role==='developer'?generationProfile.developerFiles:generationProfile.testerFiles;
  if(own.includes(path))return;
  const regression=generationProfile.repair.regressionFiles.slice(0,repairAttempt);
  if(role==='developer'&&regression.some(file=>file===path))return;
  if(operation==='read'&&(path==='context.json'||path==='engineering-skill.md'))return;
  if(operation==='read'&&role==='tester'&&path.startsWith('implementation/')&&generationProfile.developerFiles.some(file=>path===`implementation/${file}`))return;
  if(operation==='read'&&role==='tester'&&regression.some(file=>path===`implementation/${file}`))return;
  throw new PolicyError('FILE_OPERATION_NOT_ALLOWED');
}
export function checkCommand(role:EngineeringRole,command:string):void{
  if(role!=='developer'||!generationProfile.commands.some(allowed=>allowed===command))throw new PolicyError('COMMAND_NOT_ALLOWED');
}
