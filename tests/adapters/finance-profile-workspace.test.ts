import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {expect,it} from 'vitest';
import {EngineeringWorkspace} from '../../apps/runner/src/engineering/workspace.js';
import {RuntimeArtifactRegistry} from '../../apps/runner/src/runtime/artifact-registry.js';
import {wealthBalanceGenerationRequest,wealthAssistantGenerationRequest,wealthAssistantRuntimeTools} from '../../packages/contracts/src/generation-profile.js';
import type {AcceptanceBaseline} from '../../packages/contracts/src/baselines.js';
import {generatedBalanceTool,generatedBalanceUnit,generatedBalanceSkill} from '../support/generated-balance.js';

const baseline:AcceptanceBaseline={id:randomUUID(),draftId:randomUUID(),draftRevision:1,digest:'b'.repeat(64),confirmedAt:new Date().toISOString(),confirmedBy:'finance-fixture',content:{schemaVersion:1,templateId:'equipment-read@1',draftId:randomUUID(),draftRevision:1,audience:'profile adapter fixture',requirements:[{id:'BR-BAL-001',text:'Read the exact available account balance',source:'user'}],cases:[{id:'TC-BAL-001',scenario:'balance-read',title:'Read account balance',requirementIds:['BR-BAL-001'],required:true,input:'Query account A1001 balance',fault:'normal',assertions:[{ruleId:'balance-fen',expected:1000000}]}],seed:'enterprise-default@1',rulesVersion:'equipment-assertions@1'}};
const generation={...wealthBalanceGenerationRequest,scope:[...wealthBalanceGenerationRequest.scope],dependencies:[...wealthBalanceGenerationRequest.dependencies]};
it('runs the finance profile TDD workspace through a real Java build and binds its Tool into the immutable bundle',async()=>{
  const root=resolve('test-results',`finance-profile-${randomUUID()}`),sdk=resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),snapshotId=randomUUID();
  const runtimeSpec={agent:{id:'balance-agent',type:'DeepAgent' as const,systemPrompt:'Query the simulated account balance and report only tool output.',maxIterations:5,rails:['tool-allowlist']},tools:[]};
  const ws=new EngineeringWorkspace(root,sdk,{baseline,goal:'Generate a read-only account balance Tool and Skill',snapshotId,runtimeSpec},undefined,generation);
  await ws.initialize();
  try{
    const context=JSON.parse(await ws.read('developer','context.json')) as {profile:{version:string;toolName:string;skillName:string}};
    expect(context.profile).toMatchObject({version:'wealth-balance-java@1',toolName:'get_account_balance',skillName:'balance-query'});
    await expect(ws.write('developer','src/generated/EquipmentTool.java','forbidden')).rejects.toMatchObject({code:'FILE_OPERATION_NOT_ALLOWED'});
    await ws.write('tester','tests/plan.json',JSON.stringify({baselineDigest:baseline.digest,cases:baseline.content.cases.map(item=>({caseId:item.id,requirementIds:item.requirementIds,assertions:item.assertions,steps:['Call the pinned balance Tool with account A1001','Verify the response and Mock account state']}))}));
    await ws.write('developer','test/generated/AccountBalanceToolTest.java',generatedBalanceUnit);
    const red=await ws.run('developer','unit-test');expect(red.status).toBe('failed');expect(red.output).toContain('IMPLEMENTATION_REQUIRED');
    await ws.write('developer','src/generated/AccountBalanceTool.java',generatedBalanceTool);
    await ws.write('developer','skills/balance-query/SKILL.md',generatedBalanceSkill);
    expect((await ws.run('developer','unit-test')).status).toBe('passed');
    expect((await ws.run('developer','build')).status).toBe('passed');
    const bundle=ws.inspect().bundle!;
    expect(bundle.profileVersion).toBe('wealth-balance-java@1');
    expect(bundle.runtimeSpec?.tools).toEqual([expect.objectContaining({name:'get_account_balance',operationId:'getAccountBalance',inputFields:{accountId:'string'},responseFields:{accountId:'string',currency:'string',availableBalanceFen:'integer',asOf:'string'}})]);
    const registry=new RuntimeArtifactRegistry(join(root,'runtime'),sdk);await registry.initialize();
    const artifact=await registry.compose(bundle,join(root,'bundles',bundle.digest),'c'.repeat(64));
    expect(artifact.kind).toBe('generated-component');
    if(artifact.kind==='generated-component')expect(artifact.generated).toMatchObject({kind:'generated-tool-skill@1',toolClassName:'generated.AccountBalanceTool',toolName:'get_account_balance',operationId:'getAccountBalance',skillName:'balance-query',skillPath:'skills/balance-query/SKILL.md'});
  }finally{await ws.cancel();}
},90000);
it('builds one generated WealthQuery component with both pinned runtime Tools',async()=>{
  const root=resolve('test-results',`wealth-assistant-profile-${randomUUID()}`),sdk=resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),snapshotId=randomUUID();
  const runtimeSpec={agent:{id:'wealth-agent',type:'DeepAgent' as const,systemPrompt:'Read wealth-query and query balance or products.',maxIterations:6,rails:['tool-allowlist']},tools:[]};
  const ws=new EngineeringWorkspace(root,sdk,{baseline,goal:'Generate one read-only Tool and Skill for account balance and wealth products',snapshotId,runtimeSpec},undefined,
    {...wealthAssistantGenerationRequest,scope:[...wealthAssistantGenerationRequest.scope],dependencies:[...wealthAssistantGenerationRequest.dependencies]});
  await ws.initialize();
  try{
    await ws.write('tester','tests/plan.json',JSON.stringify({baselineDigest:baseline.digest,cases:baseline.content.cases.map(item=>({caseId:item.id,requirementIds:item.requirementIds,assertions:item.assertions,steps:['Query A1001 balance through the generated Tool','Verify the pinned Mock response']}))}));
    const test=`package generated;\nimport com.openjiuwen.core.foundation.tool.Tool;\nimport com.openjiuwen.core.foundation.tool.ToolCard;\nimport java.util.Map;\nimport java.util.List;\npublic final class WealthQueryToolTest { static void check(boolean v){if(!v)throw new AssertionError("FAILED");} public static void main(String[] x)throws Exception { Tool b=new Tool(new ToolCard("finance@1","get_account_balance","fixture",Map.of())){ protected Object invokeInternal(Map<String,Object> i,Map<String,Object> k){return Map.of("accountId","A1001","currency","CNY","availableBalanceFen",1000000,"asOf","mock-time");}}; Tool p=new Tool(new ToolCard("finance@1","list_wealth_products","fixture",Map.of())){ protected Object invokeInternal(Map<String,Object> i,Map<String,Object> k){return Map.of("items",List.of(Map.of("productId","P1","name","Fund","status","active","minimumAmountFen",10000,"description","Mock")),"version","seed@1");}}; check(new WealthQueryTool(b).invoke(Map.of("accountId","A1001"),Map.of()).toString().contains("1000000"));check(new WealthQueryTool(p).invoke(Map.of(),Map.of()).toString().contains("P1")); } }`;
    await ws.write('developer','test/generated/WealthQueryToolTest.java',test);
    const red=await ws.run('developer','unit-test');expect(red.status).toBe('failed');expect(red.output).toContain('IMPLEMENTATION_REQUIRED');
    const implementation=`package generated;\nimport com.openjiuwen.core.foundation.tool.Tool;\nimport java.util.Map;\nimport java.util.List;\npublic final class WealthQueryTool extends Tool { private final Tool transport; public WealthQueryTool(Tool t){super(t.getCard());transport=t;} protected Object invokeInternal(Map<String,Object> i,Map<String,Object> k)throws Exception {String n=getCard().getName(); if(n.equals("get_account_balance")){if(i.size()!=1||!(i.get("accountId") instanceof String a)||a.isBlank())throw new IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID");Object r=transport.invoke(i,k);if(!(r instanceof Map<?,?> m)||!(m.get("accountId") instanceof String)||!(m.get("currency") instanceof String)||!(m.get("availableBalanceFen") instanceof Integer||m.get("availableBalanceFen") instanceof Long)||!(m.get("asOf") instanceof String))throw new IllegalStateException("TOOL_RESPONSE_CONTRACT_INVALID");return Map.of("accountId",m.get("accountId"),"currency",m.get("currency"),"availableBalanceFen",m.get("availableBalanceFen"),"asOf",m.get("asOf"));}if(n.equals("list_wealth_products")){if(!i.isEmpty())throw new IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID");Object r=transport.invoke(i,k);if(!(r instanceof Map<?,?> m)||!(m.get("items") instanceof List<?> items)||!(m.get("version") instanceof String v))throw new IllegalStateException("TOOL_RESPONSE_CONTRACT_INVALID");for(Object q:items)if(!(q instanceof Map<?,?> z)||!(z.get("productId") instanceof String)||!(z.get("name") instanceof String)||!(z.get("status") instanceof String)||!(z.get("minimumAmountFen") instanceof Integer||z.get("minimumAmountFen") instanceof Long)||!(z.get("description") instanceof String))throw new IllegalStateException("TOOL_RESPONSE_CONTRACT_INVALID");return Map.of("items",items,"version",v);}throw new IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID");} }`;
    await ws.write('developer','src/generated/WealthQueryTool.java',implementation);
    await ws.write('developer','skills/wealth-query/SKILL.md','---\nname: wealth-query\ndescription: Read account balance and wealth product list\n---\nUse get_account_balance with accountId or list_wealth_products with no arguments. Report only returned facts.\n');
    expect((await ws.run('developer','unit-test')).status).toBe('passed');expect((await ws.run('developer','build')).status).toBe('passed');
    const bundle=ws.inspect().bundle!;expect(bundle.runtimeSpec?.tools.map(tool=>tool.name)).toEqual(['get_account_balance','list_wealth_products']);
    const registry=new RuntimeArtifactRegistry(join(root,'runtime'),sdk);await registry.initialize();const artifact=await registry.compose(bundle,join(root,'bundles',bundle.digest),'c'.repeat(64));
    expect(artifact.kind).toBe('generated-component');if(artifact.kind==='generated-component')expect(artifact.generated).toMatchObject({kind:'generated-tool-skill@2',toolBindings:wealthAssistantRuntimeTools.map(tool=>({toolClassName:'generated.WealthQueryTool',toolName:tool.name,operationId:tool.operationId}))});
  }finally{await ws.cancel();}
},120000);
