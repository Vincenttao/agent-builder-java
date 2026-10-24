import type {EngineeringRole,GenerationRequest} from '../../../../packages/contracts/src/development.js';
import {equipmentGenerationRequest,wealthBalanceGenerationRequest,wealthAssistantGenerationRequest,wealthToolGenerationRequest,wealthSkillGenerationRequest,generationImplementationError,equipmentRuntimeTool,wealthBalanceRuntimeTool,wealthAssistantRuntimeTools} from '../../../../packages/contracts/src/generation-profile.js';
import {createHash} from 'node:crypto';
import {toolStub,toolContract,repairContract,engineeringSkills,platformContractTest,balanceToolStub,balanceToolContract,balancePlatformContractTest,balanceEngineeringSkills,wealthQueryToolStub,wealthQueryToolContract,wealthQueryPlatformContractTest,wealthQueryEngineeringSkills} from './templates.js';
export class PolicyError extends Error {constructor(public readonly code:string){super(code);}}
const hashTemplates=(entries:Record<string,string>)=>Object.fromEntries(Object.entries(entries).map(([name,source])=>[name,createHash('sha256').update(source).digest('hex')]));
const limits={executionMode:'trusted-local',engineVersion:'1.19.3',model:'deepseek-local/deepseek-v4-flash',maxSteps:16,maxTaskSeconds:900,maxCommandSeconds:60,maxFileBytes:32768,maxOutputBytes:262144,commands:['unit-test','build'] as const,testerFiles:['tests/plan.json','tests/proposal.json'] as const};
export const generationProfile={...limits,version:equipmentGenerationRequest.profileVersion,scope:equipmentGenerationRequest.scope,
  dependencies:equipmentGenerationRequest.dependencies,connectionProfile:equipmentGenerationRequest.connectionProfile,
  runtimeTool:equipmentRuntimeTool,
  developerFiles:['src/generated/EquipmentTool.java','test/generated/EquipmentToolTest.java','skills/equipment-query/SKILL.md','rails/definition.json'],
  repair:{maxAttempts:3,regressionFiles:['test/generated/EquipmentRepair1Test.java','test/generated/EquipmentRepair2Test.java','test/generated/EquipmentRepair3Test.java']},
  toolClassName:'generated.EquipmentTool',toolName:'get_equipment',operationId:'equipment-status',skillName:'equipment-query',skillPath:'skills/equipment-query/SKILL.md',contractClass:'EquipmentContract',
  sourceStub:toolStub,implementationContract:toolContract,repairContract,platformContractTest,engineeringSkills,
  templates:hashTemplates({toolStub,toolContract,repairContract,platformContractTest,...engineeringSkills})
} as const;
export const wealthBalanceProfile={...generationProfile,version:wealthBalanceGenerationRequest.profileVersion,scope:wealthBalanceGenerationRequest.scope,
  dependencies:wealthBalanceGenerationRequest.dependencies,connectionProfile:wealthBalanceGenerationRequest.connectionProfile,
  runtimeTool:wealthBalanceRuntimeTool,
  developerFiles:['src/generated/AccountBalanceTool.java','test/generated/AccountBalanceToolTest.java','skills/balance-query/SKILL.md','rails/definition.json'],
  repair:{maxAttempts:3,regressionFiles:['test/generated/AccountBalanceRepair1Test.java','test/generated/AccountBalanceRepair2Test.java','test/generated/AccountBalanceRepair3Test.java']},
  toolClassName:'generated.AccountBalanceTool',toolName:'get_account_balance',operationId:'getAccountBalance',skillName:'balance-query',skillPath:'skills/balance-query/SKILL.md',contractClass:'BalanceContract',
  sourceStub:balanceToolStub,implementationContract:balanceToolContract,repairContract:'',platformContractTest:balancePlatformContractTest,engineeringSkills:balanceEngineeringSkills,
  templates:hashTemplates({toolStub:balanceToolStub,toolContract:balanceToolContract,platformContractTest:balancePlatformContractTest,...balanceEngineeringSkills})
} as const;
export const wealthAssistantProfile={...wealthBalanceProfile,version:wealthAssistantGenerationRequest.profileVersion,scope:wealthAssistantGenerationRequest.scope,
  dependencies:wealthAssistantGenerationRequest.dependencies,connectionProfile:wealthAssistantGenerationRequest.connectionProfile,
  runtimeTools:wealthAssistantRuntimeTools,
  developerFiles:['src/generated/WealthQueryTool.java','test/generated/WealthQueryToolTest.java','skills/wealth-query/SKILL.md','rails/definition.json'],
  repair:{maxAttempts:3,regressionFiles:['test/generated/WealthQueryRepair1Test.java','test/generated/WealthQueryRepair2Test.java','test/generated/WealthQueryRepair3Test.java']},
  toolClassName:'generated.WealthQueryTool',toolName:'get_account_balance',operationId:'getAccountBalance',skillName:'wealth-query',skillPath:'skills/wealth-query/SKILL.md',contractClass:'WealthQueryContract',
  sourceStub:wealthQueryToolStub,implementationContract:wealthQueryToolContract,repairContract:'',platformContractTest:wealthQueryPlatformContractTest,engineeringSkills:wealthQueryEngineeringSkills,
  templates:hashTemplates({toolStub:wealthQueryToolStub,toolContract:wealthQueryToolContract,platformContractTest:wealthQueryPlatformContractTest,...wealthQueryEngineeringSkills})
} as const;
export const wealthToolProfile={...wealthBalanceProfile,version:wealthToolGenerationRequest.profileVersion,scope:wealthToolGenerationRequest.scope,
  dependencies:wealthToolGenerationRequest.dependencies,connectionProfile:wealthToolGenerationRequest.connectionProfile,
  developerWritableFiles:['src/generated/AccountBalanceTool.java','test/generated/AccountBalanceToolTest.java']
} as const;
export const wealthSkillProfile={...wealthBalanceProfile,version:wealthSkillGenerationRequest.profileVersion,scope:wealthSkillGenerationRequest.scope,
  dependencies:wealthSkillGenerationRequest.dependencies,connectionProfile:wealthSkillGenerationRequest.connectionProfile,
  developerWritableFiles:['skills/balance-query/SKILL.md']
} as const;
export type GenerationProfile=typeof generationProfile|typeof wealthBalanceProfile|typeof wealthAssistantProfile|typeof wealthToolProfile|typeof wealthSkillProfile;
export const profileRuntimeTools=(profile:GenerationProfile)=>'runtimeTools' in profile?[...profile.runtimeTools]:[profile.runtimeTool];
export function generationProfileFor(version:string):GenerationProfile{
  if(version===generationProfile.version)return generationProfile;
  if(version===wealthBalanceProfile.version)return wealthBalanceProfile;
  if(version===wealthAssistantProfile.version)return wealthAssistantProfile;
  if(version===wealthToolProfile.version)return wealthToolProfile;
  if(version===wealthSkillProfile.version)return wealthSkillProfile;
  throw new PolicyError('GENERATION_PROFILE_UNSUPPORTED');
}
export function validateGenerationRequest(request:GenerationRequest):void{
 const error=generationImplementationError(request);if(error)throw new PolicyError(error);
}
export function checkFileAccess(role:EngineeringRole,operation:'read'|'write',path:string,repairAttempt=0,profile:GenerationProfile=generationProfile):void{
  const own:readonly string[]=role==='developer'
    ?operation==='write'&&'developerWritableFiles' in profile?profile.developerWritableFiles:profile.developerFiles
    :profile.testerFiles;
  if(own.includes(path))return;
  const regression=profile.repair.regressionFiles.slice(0,repairAttempt);
  if(role==='developer'&&regression.some(file=>file===path))return;
  if(operation==='read'&&(path==='context.json'||path==='engineering-skill.md'))return;
  if(operation==='read'&&role==='tester'&&path.startsWith('implementation/')&&profile.developerFiles.some(file=>path===`implementation/${file}`))return;
  if(operation==='read'&&role==='tester'&&regression.some(file=>path===`implementation/${file}`))return;
  throw new PolicyError('FILE_OPERATION_NOT_ALLOWED');
}
export function checkCommand(role:EngineeringRole,command:string,profile:GenerationProfile=generationProfile):void{
  if(role!=='developer'||!profile.commands.some(allowed=>allowed===command))throw new PolicyError('COMMAND_NOT_ALLOWED');
}
