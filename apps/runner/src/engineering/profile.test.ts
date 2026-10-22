import {describe,expect,it} from 'vitest';
import {validateGenerationRequest,checkFileAccess,checkCommand,generationProfile} from './profile.js';
const request={profileVersion:generationProfile.version,scope:['tool','skill'] as ('tool'|'skill')[],dependencies:[...generationProfile.dependencies],connectionProfile:generationProfile.connectionProfile};
describe('reviewed generation profile',()=>{
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
