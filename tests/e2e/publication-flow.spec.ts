import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
test('真实设备验证后发布两个版本并回滚，独立冒烟实例不替换旧证据',async({page})=>{
  test.skip(process.env.RUN_LIVE_E2E!=='1','Opt-in live model publication');test.setTimeout(600000);
  const previous=JSON.parse(await readFile('test-results/project-validation-live.json','utf8'));
  await page.goto('/');await page.getByLabel('本地访问令牌').fill(process.env.LOCAL_BOOTSTRAP_TOKEN!);await page.getByRole('button',{name:'进入工作台'}).click();
  const snapshot=await(await page.request.get(`/api/snapshots/${previous.report.snapshotId}`)).json();
  await page.getByRole('button',{name:snapshot.content.draft.name,exact:true}).click();
  const firstPanel=page.getByTestId(`publication-${snapshot.id}`);await expect(firstPanel).toBeVisible({timeout:5000});
  async function validateAndPublish(id:string){
    const section=page.getByTestId(`validation-${id}`);await section.getByRole('button',{name:'运行验收用例',exact:true}).click();
    await expect(section.getByTestId('validation-status')).toHaveText('验证中',{timeout:10000});
    await expect(section.getByTestId('validation-status')).toHaveText('通过',{timeout:240000});
    const panel=page.getByTestId(`publication-${id}`);await expect(panel.getByRole('button',{name:'发布此验证版本',exact:true})).toBeDisabled();
    await panel.getByLabel('我已审阅验收报告，同意切换演示入口').check();await panel.getByRole('button',{name:'发布此验证版本',exact:true}).click();
    await expect(panel.getByTestId('release-status')).toHaveText('发布成功',{timeout:150000});
    return(await page.request.get(`/api/drafts/${snapshot.draftId}/releases`)).json();
  }
  const first=await validateAndPublish(snapshot.id);const v1=first.versions.find((v:{id:string})=>v.id===first.pointer.versionId);
  const oldRun=await(await page.request.get(`/api/runs/${first.operations[0].smokeRunId}`)).json();
  const instructions=page.getByLabel('Agent 指令');await instructions.fill((await instructions.inputValue())+'\n用简洁中文给出建议，保留规定的 JSON 结构。');
  await page.getByRole('button',{name:'固定为测试版本',exact:true}).click();
  const snapshots=await(await page.request.get(`/api/drafts/${snapshot.draftId}/snapshots`)).json();const newer=snapshots.items.find((s:{id:string})=>s.id!==snapshot.id);
  const second=await validateAndPublish(newer.id);expect(second.pointer.versionId).not.toBe(v1.id);expect(second.pointer.environmentId).toBe(first.pointer.environmentId);
  expect(await(await page.request.get(`/api/runs/${oldRun.id}`)).json()).toEqual(oldRun);
  const panel=page.getByTestId(`publication-${newer.id}`);await panel.getByLabel('我已审阅验收报告，同意切换演示入口').check();
  await panel.getByText(/^发布历史（/).click();
  await panel.getByRole('button',{name:`回滚到 ${v1.id.slice(0,8)}`,exact:true}).click();
  await expect(panel.getByTestId('release-status')).toHaveText('发布成功',{timeout:150000});
  await expect.poll(async()=> (await(await page.request.get(`/api/drafts/${snapshot.draftId}/releases`)).json()).pointer.revision,{timeout:150000}).toBe(second.pointer.revision+1);
  const final=await(await page.request.get(`/api/drafts/${snapshot.draftId}/releases`)).json();const rolled=final.versions.find((v:{id:string})=>v.id===final.pointer.versionId);
  expect(rolled.snapshotId).toBe(snapshot.id);expect(rolled.deploymentId).not.toBe(v1.deploymentId);expect(rolled.environmentId).toBe(v1.environmentId);
  for(const version of [v1,second.versions.find((v:{id:string})=>v.id===second.pointer.versionId),rolled]){
    expect(version.smokeEvidence.case.status).toBe('passed');expect(version.smokeEvidence.readOnly).toBe(true);
    expect(version.smokeEvidence.observation.calls).toHaveLength(1);expect(version.smokeEvidence.observation.calls[0].operation).toBe('equipment-status');
  }
  await writeFile('test-results/publication-live.json',JSON.stringify({modelMode:'live-deepseek',first,second,final,oldRun},null,2));
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await panel.screenshot({path:'test-results/publication-mobile.png'});
});
