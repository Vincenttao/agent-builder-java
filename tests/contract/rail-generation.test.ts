import {describe,expect,it} from 'vitest';
import {effectiveRuntimeSpec,railDefinitionForGoal,RailDefinitionError,resolveGeneratedRailDefinition,validateGeneratedRailDefinition} from '../../packages/contracts/src/rail-generation.js';
import type {RuntimeSpec} from '../../packages/contracts/src/index.js';
const base:RuntimeSpec={agent:{id:'agent',type:'DeepAgent',systemPrompt:'fixture',maxIterations:5,rails:['audit','tool-allowlist']},tools:[]};
describe('restricted Rail generation contract',()=>{
 it('derives only the explicitly stated per-run call limit and enforces its parameter schema',()=>{
  const goal='设备 Agent 每次运行最多 3 次工具调用';const expected={schemaVersion:1 as const,rails:[{templateId:'tool-call-limit@1' as const,parameters:{maximum:3}}]};
  expect(railDefinitionForGoal(goal)).toEqual(expected);expect(validateGeneratedRailDefinition(goal,expected)).toEqual(expected);
  for(const maximum of [0,21])expect(()=>validateGeneratedRailDefinition(goal,{...expected,rails:[{...expected.rails[0]!,parameters:{maximum}}]})).toThrowError(RailDefinitionError);
  for(const invalid of [{schemaVersion:1,rails:[{templateId:'unregistered@1',parameters:{maximum:3}}]},{schemaVersion:1,rails:[{templateId:'tool-call-limit@1',parameters:{maximum:3,enabled:false}}]},{schemaVersion:2,rails:expected.rails}])
   expect(()=>validateGeneratedRailDefinition(goal,invalid)).toThrowError(RailDefinitionError);
 });
 it('rejects ambiguous or out-of-range natural-language limits instead of silently omitting the Rail',()=>{
  expect(railDefinitionForGoal('只查询设备状态')).toEqual({schemaVersion:1,rails:[]});
  expect(()=>railDefinitionForGoal('工具调用限额为 3')).toThrowError(RailDefinitionError);
  expect(()=>railDefinitionForGoal('每次运行最多 21 次工具调用')).toThrowError(RailDefinitionError);
  expect(()=>railDefinitionForGoal('每次运行最多 3 次工具调用，最多 5 次工具调用')).toThrowError(RailDefinitionError);
 });
 it('uses a platform-owned empty definition when Rail is outside scope and rejects a missing required scope',()=>{
  expect(resolveGeneratedRailDefinition('查询账户余额',false,{})).toEqual({schemaVersion:1,rails:[]});
  expect(()=>resolveGeneratedRailDefinition('每次运行最多 3 次工具调用',false,{})).toThrowError('RAIL_SCOPE_NOT_ALLOWED');
  const declared={schemaVersion:1 as const,rails:[{templateId:'tool-call-limit@1' as const,parameters:{maximum:3}}]};
  expect(resolveGeneratedRailDefinition('每次运行最多 3 次工具调用',true,declared)).toEqual(declared);
 });
 it('changes only the registered Rail entry in the effective Agent specification',()=>{
  const definition=railDefinitionForGoal('每次运行最多 3 次工具调用');
  expect(effectiveRuntimeSpec(base,definition)).toEqual({...base,agent:{...base.agent,rails:['audit','tool-allowlist','tool-call-limit@1:3']}});
  expect(()=>effectiveRuntimeSpec({...base,agent:{...base.agent,rails:[...base.agent.rails,'tool-call-limit@1:2']}},definition)).toThrowError('RAIL_CONFIG_CONFLICT');
 });
});
