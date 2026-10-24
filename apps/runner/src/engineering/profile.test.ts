import {describe,expect,it} from 'vitest';
import {validateGenerationRequest,checkFileAccess,checkCommand,generationProfile,generationProfileFor,profileRuntimeTools} from './profile.js';
import {equipmentGenerationRequest,generationPolicyError,generationImplementationError,wealthBalanceGenerationRequest,wealthAssistantGenerationRequest,wealthAssistantRuntimeTools,wealthToolGenerationRequest,wealthSkillGenerationRequest} from '../../../../packages/contracts/src/generation-profile.js';
import {wealthQueryEngineeringSkills,wealthQueryToolContract} from './templates.js';
const request={profileVersion:generationProfile.version,scope:[...generationProfile.scope],dependencies:[...generationProfile.dependencies],connectionProfile:generationProfile.connectionProfile};
describe('reviewed generation profile',()=>{
  it('requires generated finance Tool to project product records to the allowlisted response fields',()=>{
    expect(wealthQueryToolContract).toContain('Project each product item into a new map containing only productId, name, status, minimumAmountFen and description');
    expect(wealthQueryEngineeringSkills.developer).toContain('never return raw product maps or fields outside that allowlist');
  });
  it('requires an error-only response when a finance Tool fails',()=>{
    expect(wealthQueryEngineeringSkills.developer).toContain('on TOOL_TIMEOUT or TOOL_UNAVAILABLE, return only a tool-error JSON object');
    expect(wealthQueryEngineeringSkills.developer).toContain('never include account, currency, balance, date or product fields in an error response');
  });
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
  it('pins a constructible Java null-response fixture and exact developer test path',()=>{
    expect(wealthQueryEngineeringSkills.developer).toContain('test/generated/WealthQueryToolTest.java');
    expect(wealthQueryEngineeringSkills.developer).toContain('Never place null in List.of');
    expect(wealthQueryToolContract).toContain('test/generated/WealthQueryToolTest.java');
    expect(wealthQueryToolContract).toContain('without placing null in List.of');
    expect(wealthQueryToolContract).toContain('Arrays.asList');
    expect(wealthQueryEngineeringSkills.developer).toContain('Arrays.asList');
    expect(wealthQueryToolContract).toContain('compare their contents with equals()');
    expect(wealthQueryEngineeringSkills.developer).toContain('compare contents with equals()');
    expect(wealthQueryEngineeringSkills.developer).toContain('Do not emit debug output');
    expect(wealthQueryToolContract).toContain('provide a valid balance input');
    expect(wealthQueryEngineeringSkills.developer).toContain('call the Tool with a valid accountId');
  });
  it('rejects finance profile drift, extra scope, dependencies and production connections',()=>{
    const finance={...wealthBalanceGenerationRequest,scope:[...wealthBalanceGenerationRequest.scope],dependencies:[...wealthBalanceGenerationRequest.dependencies]};
    expect(generationPolicyError({...finance,profileVersion:'wealth-balance-java@99'})).toBe('GENERATION_PROFILE_UNSUPPORTED');
    expect(generationPolicyError({...finance,scope:['agent','skill','tool']})).toBe('GENERATION_SCOPE_UNSUPPORTED');
    expect(generationPolicyError({...finance,dependencies:[...finance.dependencies,'unreviewed@1']})).toBe('DEPENDENCY_NOT_ALLOWED');
    expect(generationPolicyError({...finance,connectionProfile:'production-bank'})).toBe('BUSINESS_CONNECTION_NOT_ALLOWED');
  });
  it('recognizes exact standalone finance Tool and Skill request contracts without accepting widened scope',()=>{
    for(const request of [wealthToolGenerationRequest,wealthSkillGenerationRequest]){
      const normalized={...request,scope:[...request.scope],dependencies:[...request.dependencies]};
      expect(generationPolicyError(normalized)).toBeUndefined();
      expect(generationImplementationError(normalized)).toBe('GENERATION_PROFILE_NOT_IMPLEMENTED');
      expect(generationPolicyError({...normalized,scope:['tool','skill']})).toBe('GENERATION_SCOPE_UNSUPPORTED');
    }
    expect(wealthToolGenerationRequest.scope).toEqual(['tool']);
    expect(wealthSkillGenerationRequest.scope).toEqual(['skill']);
  });
  it('maps standalone finance profiles to disjoint developer write sets',()=>{
    const tool=generationProfileFor(wealthToolGenerationRequest.profileVersion);
    const skill=generationProfileFor(wealthSkillGenerationRequest.profileVersion);
    expect('developerWritableFiles' in tool&&tool.developerWritableFiles).toEqual(['src/generated/AccountBalanceTool.java','test/generated/AccountBalanceToolTest.java']);
    expect('developerWritableFiles' in skill&&skill.developerWritableFiles).toEqual(['skills/balance-query/SKILL.md']);
    expect(()=>checkFileAccess('developer','write','skills/balance-query/SKILL.md',0,tool)).toThrowError(expect.objectContaining({code:'FILE_OPERATION_NOT_ALLOWED'}));
    expect(()=>checkFileAccess('developer','write','src/generated/AccountBalanceTool.java',0,skill)).toThrowError(expect.objectContaining({code:'FILE_OPERATION_NOT_ALLOWED'}));
    expect(()=>checkFileAccess('tester','read','implementation/src/generated/AccountBalanceTool.java',0,skill)).not.toThrow();
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
