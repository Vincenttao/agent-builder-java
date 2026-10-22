import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {draftInput} from '../support/fixtures.js';
import type {Candidate} from '../../packages/contracts/src/candidates.js';
import type {AcceptanceBaseline} from '../../packages/contracts/src/baselines.js';
import type {ValidationExecution,ValidationReport} from '../../packages/contracts/src/validations.js';
import type {InvocationView} from '../../packages/contracts/src/invocations.js';
import type {ReleaseOverview} from '../../packages/contracts/src/releases.js';

// Independent control-plane observation; credentials remain in the container environment.
function mockState(environmentId:string,runId:string){
  if(![environmentId,runId].every(v=>/^[a-f0-9-]{36}$/.test(v)))throw new Error('INVALID_OBSERVATION_ID');
  const code=`const h={authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN};const base=process.env.MOCK_BASE_URL;const read=async p=>{const r=await fetch(base+p,{headers:h});if(!r.ok)throw new Error('MOCK_OBSERVATION_FAILED');return r.json()};console.log(JSON.stringify({environment:await read('/control/environments/${environmentId}'),calls:await read('/control/environments/${environmentId}/calls?runId=${runId}')}));`;
  return JSON.parse(execFileSync('docker',['compose','--env-file','.env.local','exec','-T','app','node','--input-type=module','-e',code],{encoding:'utf8',windowsHide:true})) as {environment:{state:{workOrders?:Record<string,unknown>}};calls:{items:{operation:string}[]}};
}

test('Docker workorder baseline passes all eight cases then publishes and performs an approved business write',async({page})=>{
  test.skip(process.env.RUN_LIVE_E2E!=='1','Explicit live opt-in required');test.setTimeout(1_200_000);
  const id=randomUUID(),root=`test-results/tdd-017/live-${id}`;await mkdir(root,{recursive:true});
  const proof:Record<string,unknown>={id,startedAt:new Date().toISOString(),scope:'Real DeepSeek, Docker JVM and PostgreSQL Mock; real five-minute expiry; fixed template candidate; browser review, validation, release and business approval',status:'running'};
  const save=()=>writeFile(`${root}/live-docker-workorder.json`,JSON.stringify(proof,null,2));
  try{
    await page.goto('/');await page.getByLabel('本地访问令牌').fill(process.env.LOCAL_BOOTSTRAP_TOKEN!);await page.getByRole('button',{name:'进入工作台',exact:true}).click();
    await expect(page.getByRole('button',{name:'退出',exact:true})).toBeVisible();const session=await(await page.request.get('/api/auth/session')).json();const origin=new URL(page.url()).origin;
    const headers={origin,'x-csrf-token':session.csrfToken as string};
    async function api<T>(path:string,method='GET',data?:unknown,authorization?:string):Promise<T>{const response=await page.request.fetch(path,{method,headers:authorization?{authorization}:headers,...(data===undefined?{}:{data}),timeout:90000});expect(response.ok(),`HTTP ${response.status()} ${path}`).toBe(true);return response.json() as Promise<T>;}
    const draft=await api<{id:string;name:string}>('/api/drafts','POST',{...draftInput,name:`工单完整验收 ${id.slice(0,8)}`,brief:{...draftInput.brief,goal:{value:'查询设备事实，经有效确认创建模拟工单；拒绝、过期、参数改变均不得写入，重试不得重复创建',source:'user',confirmed:true},output:{value:'设备事实、审批记录及可核查的工单',source:'user',confirmed:true}}});proof.draft=draft;await save();
    await page.reload();await page.getByRole('button',{name:draft.name,exact:true}).click();await page.getByLabel('能力模板').selectOption('equipment-workorder');
    const review=page.getByTestId('baseline-review');await expect(review.locator('details')).toHaveCount(8);await review.getByLabel('我已审阅需求、测试场景和预期结果').check();await review.getByRole('button',{name:'确认验收基线',exact:true}).click();await expect(review.getByRole('status')).toHaveText('基线已确认');
    const baseline=(await api<{items:AcceptanceBaseline[]}>(`/api/drafts/${draft.id}/baselines`)).items[0]!;expect(baseline.content.rulesVersion).toBe('equipment-workorder-assertions@2');proof.baseline=baseline;
    await page.getByRole('button',{name:'固定为测试版本',exact:true}).click();await expect(page.getByTestId('snapshot-card')).toHaveCount(1);
    const snapshot=(await api<{items:{id:string}[]}>(`/api/drafts/${draft.id}/snapshots`)).items[0]!;proof.snapshot=snapshot;
    const candidatePanel=page.getByTestId(`candidate-${snapshot.id}`);await candidatePanel.getByRole('button',{name:'登记固定候选',exact:true}).click();await expect(candidatePanel.getByTestId('candidate-source')).toHaveText('来源：模板装配');
    const candidate=(await api<{items:Candidate[]}>(`/api/drafts/${draft.id}/candidates`)).items[0]!;proof.candidate=candidate;
    const acceptance=page.getByTestId(`validation-${snapshot.id}`);await expect(acceptance.getByLabel('自动验收目标')).toHaveValue(candidate.id);await expect(acceptance.getByRole('button',{name:'运行验收用例',exact:true})).toBeDisabled();
    await acceptance.getByLabel('允许测试执行器按场景批准模拟工单写入').check();await acceptance.getByRole('button',{name:'运行验收用例',exact:true}).click();await save();
    console.log(JSON.stringify({stage:'workorder-validation-started',id,draftId:draft.id,candidateId:candidate.id}));
    let last=-1;
    await expect.poll(async()=>{const value=(await api<{items:ValidationExecution[]}>(`/api/snapshots/${snapshot.id}/validations`)).items[0];if(value){proof.validation=value;await save();const count=value.cases.filter(c=>c.state==='completed').length;if(count!==last){last=count;console.log(JSON.stringify({stage:'workorder-validation',completed:count,total:8,validationId:value.id}));}}return value?.status;},{timeout:900000,intervals:[1500,3000]}).toBe('completed');
    const validation=proof.validation as ValidationExecution,report=await api<ValidationReport>(`/api/validations/${validation.id}/report`);proof.report=report;
    proof.caseEvidence=await Promise.all(report.cases.map(c=>c.evidenceId?api(`/api/validations/${validation.id}/evidence/${c.evidenceId}`):null));await save();
    expect(report.verdict,JSON.stringify(report.cases.map(c=>({id:c.caseId,status:c.status,reasons:c.reasons})))).toBe('passed');expect(report.cases).toHaveLength(8);expect(report.cases.every(c=>c.status==='passed')).toBe(true);expect(report.binding.candidate?.id).toBe(candidate.id);
    await expect(acceptance.getByTestId('validation-status')).toHaveText('通过');await acceptance.getByText('TC-007 · 通过',{exact:true}).click();await acceptance.getByRole('button',{name:'查看证据 TC-007',exact:true}).click();await expect(acceptance.getByTestId('validation-evidence')).toContainText('action.input_rejected');
    await acceptance.screenshot({path:`${root}/workorder-acceptance.png`});
    const publication=page.getByTestId(`publication-${snapshot.id}`);await publication.getByLabel('我已审阅验收报告，同意切换演示入口').check();await publication.getByRole('button',{name:'发布此验证版本',exact:true}).click();await expect(publication.getByTestId('release-status')).toHaveText('发布成功',{timeout:240000});
    const overview=await api<ReleaseOverview>(`/api/drafts/${draft.id}/releases`),version=overview.versions.find(v=>v.id===overview.pointer?.versionId)!;proof.publication=overview;expect(version.reference.binding.candidate?.id).toBe(candidate.id);expect(version.reference.binding.artifactDigest).toBe(candidate.artifactDigest);await save();
    const demo=page.getByTestId(`demo-app-${draft.id}`);await demo.getByLabel('模拟业务身份').selectOption('U1002');await demo.getByRole('button',{name:'进入模拟 App',exact:true}).click();await demo.getByLabel('业务请求').fill('查询 PUMP-001 的状态、温度和来源，申请创建检查工单。');await demo.getByRole('button',{name:'发送业务请求',exact:true}).click();await expect(demo.getByTestId('demo-request-status')).toHaveText('等待确认',{timeout:180000});
    const detail=JSON.parse(await demo.getByTestId('demo-evidence').textContent()??'{}') as {requestId:string;runId:string;environmentId:string};proof.businessIds=detail;proof.beforeApproval=mockState(detail.environmentId,detail.runId);
    expect((proof.beforeApproval as ReturnType<typeof mockState>).calls.items.filter(c=>c.operation==='work-order-create')).toHaveLength(0);expect(Object.keys((proof.beforeApproval as ReturnType<typeof mockState>).environment.state.workOrders??{})).toHaveLength(0);await save();
    await demo.getByRole('button',{name:'确认模拟操作',exact:true}).click();await expect(demo.getByTestId('demo-request-status')).toHaveText('已完成',{timeout:180000});
    const grant=await api<{token:string}>('/api/demo-sessions','POST',{agentId:draft.id,actorId:'U1002'}),authorization=`Bearer ${grant.token}`;
    const business=await api<InvocationView>(`/agent-api/requests/${detail.requestId}`,'GET',undefined,authorization);proof.business=business;expect(business.agentVersion).toBe(version.id);expect(business.run).toMatchObject({status:'succeeded',artifactDigest:candidate.artifactDigest,actorId:'U1002'});expect(business.actions).toHaveLength(1);expect(business.actions[0]!.status).toBe('succeeded');
    const action=business.actions[0]!;await api(`/agent-api/requests/${business.requestId}/actions/${action.id}/decision`,'POST',{decisionId:action.decisionId,actionHash:action.actionHash,decision:'approve'},authorization);
    proof.afterDuplicateConfirmation=mockState(detail.environmentId,detail.runId);expect((proof.afterDuplicateConfirmation as ReturnType<typeof mockState>).calls.items.filter(c=>c.operation==='work-order-create')).toHaveLength(1);expect(Object.keys((proof.afterDuplicateConfirmation as ReturnType<typeof mockState>).environment.state.workOrders??{})).toHaveLength(1);
    proof.businessEvents=await api(`/api/runs/${business.runId}/events`);expect((proof.businessEvents as {items:{type:string}[]}).items.some(e=>e.type==='validation.write_fault')).toBe(false);
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await demo.screenshot({path:`${root}/workorder-business-mobile.png`});await publication.screenshot({path:`${root}/workorder-publication-mobile.png`});
    proof.status='passed-live-docker-workorder-validation-publication';console.log(JSON.stringify({stage:'workorder-live-passed',id,validationId:validation.id,versionId:version.id,requestId:business.requestId}));
  }catch(error){proof.status='failed-live-docker-workorder-validation-publication';proof.failure='See the Playwright result and retained validation report';throw error;}
  finally{proof.finishedAt=new Date().toISOString();await save();}
});
