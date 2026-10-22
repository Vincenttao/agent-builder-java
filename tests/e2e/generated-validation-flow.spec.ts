import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {draftInput} from '../support/fixtures.js';
import {equipmentAssembly} from '../../packages/contracts/src/equipment-template.js';
import type {DevelopmentJob} from '../../packages/contracts/src/development.js';
import type {Candidate} from '../../packages/contracts/src/candidates.js';
import type {ValidationExecution,ValidationReport} from '../../packages/contracts/src/validations.js';
import type {InvocationView} from '../../packages/contracts/src/invocations.js';
import type {ReleaseOverview} from '../../packages/contracts/src/releases.js';
test('Docker generates, validates and publishes one exact candidate through real browser and business ingress',async({page})=>{
  test.skip(process.env.RUN_LIVE_E2E!=='1','Explicit live opt-in required');test.setTimeout(1_200_000);
  const root='test-results/tdd-015';await mkdir(root,{recursive:true});const proof:Record<string,unknown>={startedAt:new Date().toISOString(),scope:'Live DeepSeek; Docker app, runner and PostgreSQL Mock; real browser controls',status:'running'};
  try{
    await page.goto('/');await page.getByLabel('本地访问令牌').fill(process.env.LOCAL_BOOTSTRAP_TOKEN!);await page.getByRole('button',{name:'进入工作台',exact:true}).click();
    await expect(page.getByRole('button',{name:'退出',exact:true})).toBeVisible();const session=await(await page.request.get('/api/auth/session')).json();const origin=new URL(page.url()).origin;
    const headers={origin,'x-csrf-token':session.csrfToken as string};
    async function api<T>(path:string,method='GET',data?:unknown,authorization?:string):Promise<T>{const response=await page.request.fetch(path,{method,headers:authorization?{authorization}:headers,...(data===undefined?{}:{data}),timeout:90000});expect(response.ok(),`HTTP ${response.status()} ${path}`).toBe(true);return response.json() as Promise<T>;}
    const draft=await api<{id:string;name:string}>('/api/drafts','POST',{...draftInput,name:`生成候选验收 ${Date.now()}`,brief:{...draftInput.brief,goal:{value:'生成 Tool 与 Skill 并查询设备状态和温度',source:'user',confirmed:true},output:{value:'设备状态报告',source:'user',confirmed:true}}});proof.draft=draft;
    const preview=await api<{digest:string}>(`/api/drafts/${draft.id}/baseline-preview?templateId=equipment-read@1`);const baseline=await api<{id:string}>(`/api/drafts/${draft.id}/baselines`,'POST',{expectedRevision:1,templateId:'equipment-read@1',expectedDigest:preview.digest,confirmed:true});proof.baseline=baseline;
    const snapshot=await api<{id:string}>(`/api/drafts/${draft.id}/snapshots`,'POST',{expectedRevision:1,assembly:{...equipmentAssembly(),systemPrompt:equipmentAssembly().systemPrompt+' 每次设备查询先调用 skill_tool 读取 equipment-query 的 SKILL.md，再按 Skill 使用 get_equipment。'}});proof.snapshot=snapshot;
    await page.reload();await page.getByRole('button',{name:draft.name,exact:true}).click();const development=page.getByTestId(`development-${snapshot.id}`);await development.getByRole('button',{name:'启动双角色开发',exact:true}).click();
    console.log(JSON.stringify({stage:'docker-development-started',draftId:draft.id}));
    await expect.poll(async()=>{const jobs=await api<{items:DevelopmentJob[]}>(`/api/drafts/${draft.id}/development`);const job=jobs.items[0];if(job)proof.job=job;return Boolean(job&&['built','failed','cancelled','reconciling'].includes(job.status));},{timeout:960000,intervals:[1000,2000,3000]}).toBe(true);
    const job=proof.job as DevelopmentJob;expect(job.status,job.diagnostic).toBe('built');await expect(development.getByTestId('development-status')).toHaveText('构建完成');
    const candidatePanel=page.getByTestId(`candidate-${snapshot.id}`);await candidatePanel.getByRole('button',{name:'刷新可用构建',exact:true}).click();await expect(candidatePanel.getByLabel('候选来源').locator('option')).toHaveCount(2);await candidatePanel.getByLabel('候选来源').selectOption(job.id);await candidatePanel.getByRole('button',{name:'登记固定候选',exact:true}).click();await expect(candidatePanel.getByTestId('candidate-source')).toHaveText('来源：自动生成 Tool 与 Skill');
    const candidate=(await api<{items:Candidate[]}>(`/api/drafts/${draft.id}/candidates`)).items.find(c=>c.generated?.developmentJobId===job.id)!;expect(candidate).toBeDefined();proof.candidate=candidate;
    const acceptance=page.getByTestId(`validation-${snapshot.id}`);await expect(acceptance.getByLabel('自动验收目标')).toHaveValue(candidate.id);await acceptance.getByRole('button',{name:'运行验收用例',exact:true}).click();console.log(JSON.stringify({stage:'docker-validation-started',candidateId:candidate.id}));
    await expect.poll(async()=>{const values=await api<{items:ValidationExecution[]}>(`/api/snapshots/${snapshot.id}/validations`);const value=values.items[0];if(value)proof.validation=value;return value?.status;},{timeout:600000,intervals:[1000,2000,3000]}).toBe('completed');
    const validation=proof.validation as ValidationExecution;const report=await api<ValidationReport>(`/api/validations/${validation.id}/report`);proof.report=report;proof.caseEvidence=await Promise.all(report.cases.map(c=>api(`/api/validations/${validation.id}/evidence/${c.evidenceId}`)));
    expect(report.verdict,JSON.stringify(report.cases.map(c=>({id:c.caseId,status:c.status,reasons:c.reasons})))).toBe('passed');expect(report.binding.candidate?.id).toBe(candidate.id);expect(report.binding.artifactDigest).toBe(candidate.artifactDigest);expect(report.binding.candidate?.testPlanDigest).toBe(job.bundle!.planDigest);expect(report.cases).toHaveLength(3);
    await expect(acceptance.getByTestId('validation-status')).toHaveText('通过');
    const publication=page.getByTestId(`publication-${snapshot.id}`);await publication.getByLabel('我已审阅验收报告，同意切换演示入口').check();await publication.getByRole('button',{name:'发布此验证版本',exact:true}).click();await expect(publication.getByTestId('release-status')).toHaveText('发布成功',{timeout:240000});
    const overview=await api<ReleaseOverview>(`/api/drafts/${draft.id}/releases`);proof.published=overview;const version=overview.versions.find(v=>v.id===overview.pointer?.versionId)!;expect(version.reference.binding.candidate?.id).toBe(candidate.id);expect(version.reference.binding.artifactDigest).toBe(candidate.artifactDigest);
    const grant=await api<{token:string;environmentId:string}>('/api/demo-sessions','POST',{agentId:draft.id,actorId:'U1002'});const authorization=`Bearer ${grant.token}`;
    const sent=await api<InvocationView>(`/agent-api/agents/${draft.id}/messages`,'POST',{clientRequestId:randomUUID(),input:'查询 PUMP-001 的状态、温度和来源，输出设备报告。'},authorization);
    await expect.poll(async()=>{const value=await api<InvocationView>(`/agent-api/requests/${sent.requestId}`,'GET',undefined,authorization);proof.business=value;return value.run?.status;},{timeout:180000,intervals:[500,1000,2000]}).toBe('succeeded');
    const business=proof.business as InvocationView;expect(business.agentVersion).toBe(version.id);expect(business.run).toMatchObject({actorId:'U1002',artifactDigest:candidate.artifactDigest});expect(business.run!.externalEvidence).toHaveLength(1);proof.businessEvents=await api(`/api/runs/${business.runId}/events`);
    proof.engineeringEvents=await api(`/api/development/${job.id}/events`);
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await publication.screenshot({path:`${root}/docker-generated-publication-mobile.png`});await candidatePanel.screenshot({path:`${root}/docker-generated-candidate-mobile.png`});
    proof.status='passed-live-docker-generated-validation-publication';console.log(JSON.stringify({stage:'docker-live-passed',candidateId:candidate.id,validationId:validation.id,versionId:version.id,requestId:business.requestId}));
  }finally{proof.finishedAt=new Date().toISOString();await writeFile(`${root}/live-docker-generated.json`,JSON.stringify(proof,null,2));}
});
