import {describe,expect,it} from 'vitest';
import {validateGenerationRequest,checkFileAccess,checkCommand,generationProfile,generationProfileFor,profileRuntimeTools} from './profile.js';
import {equipmentGenerationRequest,generationPolicyError,generationImplementationError,wealthBalanceGenerationRequest,wealthAssistantGenerationRequest,wealthAssistantRuntimeTools} from '../../../../packages/contracts/src/generation-profile.js';
const request={profileVersion:generationProfile.version,scope:[...generationProfile.scope],dependencies:[...generationProfile.dependencies],connectionProfile:generationProfile.connectionProfile};
describe('reviewed generation profile',()=>{
  it('selects profile-specific balance Tool and Skill paths without widening the equipment profile',()=>{
    const finance=generationProfileFor(wealthBalanceGenerationRequest.profileVersion);
    expect(finance).toMatchObject({version:'wealth-balance-java@1',toolClassName:'generated.AccountBalanceTool',toolName:'get_account_balance',operationId:'getAccountBalance',skillName:'balance-query',contractClass:'BalanceContract'});
    expect(finance.developerFiles).toEqual(['src/generated/AccountBalanceTool.java','test/generated/AccountBalanceToolTest.java','skills/balance-query/SKILL.md','rails/definition.json']);
    expect(()=>checkFileAccess('developer','write',finance.developerFiles[0],0,finance)).not.toThrow();
    expect(()=>checkFileAccess('tester','read',`implementation/${finance.developerFiles[0]}`,0,finance)).not.toThrow();
    expect(()=>checkFileAccess('developer','write','src/generated/EquipmentTool.java',0,finance)).toThrowError(expect.objectContaining({code:'FILE_OPERATION_NOT_ALLOWED'}));
  });
  it('keeps the equipment profile and admits only the bounded finance balance adapter profile',()=>{
    expect(generationPolicyError({...equipmentGenerationRequest,scope:[...equipmentGenerationRequest.scope],dependencies:[...equipmentGenerationRequest.dependencies]})).toBeUndefined();
    expect(generationPolicyError({...wealthBalanceGenerationRequest,scope:[...wealthBalanceGenerationRequest.scope],dependencies:[...wealthBalanceGenerationRequest.dependencies]})).toBeUndefined();
    expect(generationImplementationError({...wealthBalanceGenerationRequest,scope:[...wealthBalanceGenerationRequest.scope],dependencies:[...wealthBalanceGenerationRequest.dependencies]})).toBeUndefined();
    expect(generationImplementationError({...equipmentGenerationRequest,scope:[...equipmentGenerationRequest.scope],dependencies:[...equipmentGenerationRequest.dependencies]})).toBeUndefined();
    expect(()=>validateGenerationRequest({...wealthBalanceGenerationRequest,scope:[...wealthBalanceGenerationRequest.scope],dependencies:[...wealthBalanceGenerationRequest.dependencies]})).not.toThrow();
    expect(wealthBalanceGenerationRequest).toMatchObject({profileVersion:'wealth-balance-java@1',scope:['tool','skill'],connectionProfile:'mock-finance@1'});
  });
  it('admits one finance profile that binds both balance and wealth-product operations',()=>{
    const request={...wealthAssistantGenerationRequest,scope:[...wealthAssistantGenerationRequest.scope],dependencies:[...wealthAssistantGenerationRequest.dependencies]};
    expect(generationPolicyError(request)).toBeUndefined();
    expect(generationImplementationError(request)).toBeUndefined();
    expect(()=>validateGenerationRequest(request)).not.toThrow();
    expect(wealthAssistantGenerationRequest.profileVersion).toBe('wealth-assistant-java@1');
    expect(wealthAssistantRuntimeTools.map(tool=>[tool.name,tool.operationId])).toEqual([
      ['get_account_balance','getAccountBalance'],['list_wealth_products','listWealthProducts']
    ]);
    const profile=generationProfileFor(request.profileVersion);
    expect(profile).toMatchObject({toolClassName:'generated.WealthQueryTool',skillName:'wealth-query'});
    expect(profileRuntimeTools(profile)).toHaveLength(2);
  });
  it('rejects finance profile drift, extra scope, dependencies and production connections',()=>{
    const finance={...wealthBalanceGenerationRequest,scope:[...wealthBalanceGenerationRequest.scope],dependencies:[...wealthBalanceGenerationRequest.dependencies]};
    expect(generationPolicyError({...finance,profileVersion:'wealth-balance-java@99'})).toBe('GENERATION_PROFILE_UNSUPPORTED');
    expect(generationPolicyError({...finance,scope:['agent','skill','tool']})).toBe('GENERATION_SCOPE_UNSUPPORTED');
    expect(generationPolicyError({...finance,dependencies:[...finance.dependencies,'unreviewed@1']})).toBe('DEPENDENCY_NOT_ALLOWED');
    expect(generationPolicyError({...finance,connectionProfile:'production-bank'})).toBe('BUSINESS_CONNECTION_NOT_ALLOWED');
  });
  it('rejects unsupported scopes, dependency declarations and business connections without relaxing the fixed profile',()=>{
    expect(()=>validateGenerationRequest(request)).not.toThrow();
    for(const patch of [{profileVersion:'anything'},{scope:['agent']},{dependencies:['unreviewed-package@1']},{connectionProfile:'production-bank'}])
      expect(()=>validateGenerationRequest({...request,...patch} as typeof request)).toThrow();
  });
  it('restricts normal tool operations by role and exact paths, with no shell or mutable acceptance baseline',()=>{
    expect(()=>checkFileAccess('developer','write','src/generated/EquipmentTool.java')).not.toThrow();
    expect(()=>checkFileAccess('tester','write','tests/plan.json')).not.toThrow();
    expect(()=>checkFileAccess('tester','read','implementation/src/generated/EquipmentTool.java')).not.toThrow();
    for(const path of ['../secret','C:/secret','src/../secret','src\\generated\\EquipmentTool.java','/etc/passwd','src/generated/EquipmentTool.java:stream','opencode.json','baseline.json'])
      expect(()=>checkFileAccess('developer','write',path)).toThrow();
    expect(()=>checkFileAccess('tester','write','implementation/src/generated/EquipmentTool.java')).toThrow();
    expect(()=>checkFileAccess('tester','write','src/generated/EquipmentTool.java')).toThrow();
    expect(()=>checkCommand('tester','build')).toThrow();expect(()=>checkCommand('developer','java -version')).toThrow();
    expect(()=>checkCommand('developer','unit-test')).not.toThrow();
  });
});
