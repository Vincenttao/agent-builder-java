import {expect,it} from 'vitest';
import {wealthBalanceAssembly,wealthAssistantAssembly} from '../../packages/contracts/src/equipment-template.js';

it('assembles the generated balance Skill and tool with explicit no-fabrication outputs',()=>{
 const assembly=wealthBalanceAssembly('查询账户可用余额');
 expect(assembly).toMatchObject({generationProfileVersion:'wealth-balance-java@1',toolIds:[],railIds:['audit@1','tool-allowlist@1']});
 expect(assembly.systemPrompt).toContain('skill_tool');
 expect(assembly.systemPrompt).toContain('balance-query');
 expect(assembly.systemPrompt).toContain('relative_file_path');
 expect(assembly.systemPrompt).toContain('missingFields');
 expect(assembly.systemPrompt).toContain('availableBalanceFen');
 expect(assembly.systemPrompt).toContain('TOOL_TIMEOUT');
 expect(assembly.systemPrompt).toContain('message 明确余额未知');
});
it('assembles one generated read-only Agent for balance and wealth products',()=>{
 const assembly=wealthAssistantAssembly('查询余额与产品目录');
 expect(assembly).toMatchObject({generationProfileVersion:'wealth-assistant-java@1',toolIds:[],railIds:['audit@1','tool-allowlist@1']});
 expect(assembly.systemPrompt).toContain('wealth-query');
 expect(assembly.systemPrompt).toContain('get_account_balance');
 expect(assembly.systemPrompt).toContain('list_wealth_products');
 expect(assembly.systemPrompt).toContain('只读');
});
