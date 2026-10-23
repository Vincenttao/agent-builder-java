import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {expect,it} from 'vitest';
import {EngineeringWorkspace} from '../../apps/runner/src/engineering/workspace.js';
import {RuntimeArtifactRegistry} from '../../apps/runner/src/runtime/artifact-registry.js';
import {wealthBalanceGenerationRequest} from '../../packages/contracts/src/generation-profile.js';
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
