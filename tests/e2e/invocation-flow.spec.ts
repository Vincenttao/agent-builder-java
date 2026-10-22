import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import type {InvocationView,MessageInput,DemoGrant} from '../../packages/contracts/src/invocations.js';
test('published business App recovers a lost response after refresh without repeating execution, and separates identities',async({page})=>{
  test.skip(process.env.RUN_LIVE_E2E!=='1','Opt-in live model invocation');test.setTimeout(180000);
  const previous=JSON.parse(await readFile('test-results/tdd-009/release-restart.json','utf8'));
  const agentId=previous.currentVersion.agentId as string;const attempts:MessageInput[]=[];let accepted:InvocationView|undefined;let grant:DemoGrant|undefined;
  await page.goto('/');await page.getByLabel('本地访问令牌').fill(process.env.LOCAL_BOOTSTRAP_TOKEN!);await page.getByRole('button',{name:'进入工作台',exact:true}).click();
  await expect(page.getByRole('button',{name:'退出',exact:true})).toBeVisible();
  const draftResponse=await page.request.get(`/api/drafts/${agentId}`);expect(draftResponse.status()).toBe(200);const draft=await draftResponse.json();
  // The saved fixture identifies the project; the authoritative pointer determines today's target.
  const overview=await(await page.request.get(`/api/drafts/${agentId}/releases`)).json();const currentVersion=overview.versions.find((value:{id:string})=>value.id===overview.pointer.versionId);
  expect(currentVersion).toBeDefined();
  async function loginIdentity(panel:ReturnType<typeof page.getByTestId>,actor:string){
    const response=page.waitForResponse(value=>value.url().endsWith('/api/demo-sessions')&&value.status()===201);
    await panel.getByRole('button',{name:'进入模拟 App',exact:true}).click();grant=await(await response).json() as DemoGrant;
    expect(grant.actorId).toBe(actor);
  }
  async function enter(actor='U1002'){
    await page.getByRole('button',{name:draft.name,exact:true}).click();const panel=page.getByTestId(`demo-app-${agentId}`);
    await panel.getByLabel('模拟业务身份').selectOption(actor);await loginIdentity(panel,actor);
    await expect(panel.getByText(`当前身份：${actor} · 模拟环境`,{exact:true})).toBeVisible();return panel;
  }
  let panel=await enter();let drop=true;
  await page.route(`**/agent-api/agents/${agentId}/messages`,async route=>{
    attempts.push(route.request().postDataJSON() as MessageInput);
    if(drop){drop=false;const response=await route.fetch();expect(response.status()).toBe(202);accepted=await response.json() as InvocationView;await route.abort('failed');}
    else await route.continue();
  });
  await panel.getByRole('button',{name:'发送业务请求',exact:true}).click();await expect(panel.getByRole('button',{name:'重试原请求',exact:true})).toBeEnabled();expect(accepted).toBeDefined();
  await page.reload();panel=await enter();await panel.getByRole('button',{name:'重试原请求',exact:true}).click();
  await expect(panel.getByTestId('demo-request-status')).toHaveText('已完成',{timeout:120000});expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
  await panel.getByText('演示详情与证据',{exact:true}).click();const detail=JSON.parse(await panel.getByTestId('demo-evidence').innerText());
  expect(detail.requestId).toBe(accepted!.requestId);expect(detail.runId).toBe(accepted!.runId);expect(detail.actorId).toBe('U1002');expect(detail.agentVersion).toBe(currentVersion.id);
  expect(detail.externalEvidence).toHaveLength(1);expect(detail.externalEvidence[0]).toMatchObject({actorId:'U1002',runId:detail.runId,operation:'equipment-status',status:200,result:{temperatureCelsius:86}});
  const run=await(await page.request.get(`/api/runs/${detail.runId}`)).json();expect(run.status).toBe('succeeded');expect(run.deploymentId).toBe(currentVersion.deploymentId);
  const evidence=await page.evaluate(async({id,token})=>(await fetch(`/agent-api/requests/${id}`,{headers:{authorization:`Bearer ${token}`}})).json(),{id:detail.requestId,token:grant!.token});
  await page.reload();panel=await enter();await expect(panel.getByTestId('demo-request-status')).toHaveText('已完成');expect(attempts).toHaveLength(2);
  await panel.getByLabel('模拟业务身份').selectOption('U1001');await expect(panel.getByTestId('demo-result')).toHaveCount(0);await loginIdentity(panel,'U1001');
  await expect(panel.getByText('当前身份：U1001 · 模拟环境',{exact:true})).toBeVisible();
  const foreignStatus=await page.evaluate(async({id,token})=>(await fetch(`/agent-api/requests/${id}`,{headers:{authorization:`Bearer ${token}`}})).status,{id:detail.requestId,token:grant!.token});expect(foreignStatus).toBe(404);
  expect(await(await page.request.get(`/api/runs/${detail.runId}`)).json()).toEqual(run);
  await panel.getByLabel('模拟业务身份').selectOption('U1002');await loginIdentity(panel,'U1002');await expect(panel.getByTestId('demo-request-status')).toHaveText('已完成');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await panel.screenshot({path:'test-results/tdd-010/demo-mobile.png'});
  await writeFile('test-results/tdd-010/live-invocation.json',JSON.stringify({modelMode:'live-deepseek',attempts,evidence,foreignStatus,executionUnchangedAfterRefresh:true,requestRecoveredFromLostResponse:true,oldRunPreserved:true},null,2));
});
