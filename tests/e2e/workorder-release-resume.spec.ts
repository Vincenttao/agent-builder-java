import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import type {ReleaseOverview} from '../../packages/contracts/src/releases.js';
import type {InvocationView} from '../../packages/contracts/src/invocations.js';

interface PassedWorkorderProof {
  id:string;
  draft:{id:string;name:string};
  snapshot:{id:string};
  candidate:{id:string;artifactDigest:string};
  report:{verdict:string;cases:{caseId:string;status:string}[];binding:{artifactDigest:string}};
}

function mockState(environmentId:string,runId:string){
  if(![environmentId,runId].every(v=>/^[a-f0-9-]{36}$/.test(v)))throw new Error('INVALID_OBSERVATION_ID');
  const code=`const h={authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN};const base=process.env.MOCK_BASE_URL;const read=async p=>{const r=await fetch(base+p,{headers:h});if(!r.ok)throw new Error('MOCK_OBSERVATION_FAILED');return r.json()};console.log(JSON.stringify({environment:await read('/control/environments/${environmentId}'),calls:await read('/control/environments/${environmentId}/calls?runId=${runId}')}));`;
  return JSON.parse(execFileSync('docker',['compose','--env-file','.env.local','exec','-T','app','node','--input-type=module','-e',code],{encoding:'utf8',windowsHide:true})) as {environment:{state:{workOrders?:Record<string,unknown>}};calls:{items:{operation:string}[]}};
}

test('resume a passed Docker workorder report through release and an externally verified business approval',async({page})=>{
  test.skip(process.env.RUN_LIVE_E2E!=='1'||!process.env.WORKORDER_PROOF_PATH,'Explicit live opt-in and a retained passed proof are required');
  test.setTimeout(300_000);page.setDefaultTimeout(30_000);
  const source=await readFile(process.env.WORKORDER_PROOF_PATH!,'utf8'),proof=JSON.parse(source) as PassedWorkorderProof;
  expect(proof.report.verdict).toBe('passed');expect(proof.report.cases).toHaveLength(8);expect(proof.report.cases.every(c=>c.status==='passed')).toBe(true);expect(proof.report.binding.artifactDigest).toBe(proof.candidate.artifactDigest);
  const root=`test-results/tdd-017/live-${proof.id}`;
  const save=async(value:unknown)=>writeFile(`${root}/live-release-resume.json`,JSON.stringify(value,null,2));
  const evidence:Record<string,unknown>={sourceRunId:proof.id,status:'running',candidateId:proof.candidate.id,artifactDigest:proof.candidate.artifactDigest};
  try{
    await page.goto('/');await page.getByLabel('本地访问令牌').fill(process.env.LOCAL_BOOTSTRAP_TOKEN!);await page.getByRole('button',{name:'进入工作台',exact:true}).click();
    await expect(page.getByRole('button',{name:'退出',exact:true})).toBeVisible();
    const session=await(await page.request.get('/api/auth/session')).json() as {csrfToken:string},origin=new URL(page.url()).origin,headers={origin,'x-csrf-token':session.csrfToken};
    async function api<T>(path:string,method='GET',data?:unknown,authorization?:string):Promise<T>{const response=await page.request.fetch(path,{method,headers:authorization?{authorization}:headers,...(data===undefined?{}:{data}),timeout:90_000});expect(response.ok(),`HTTP ${response.status()} ${path}`).toBe(true);return response.json() as Promise<T>;}
    await page.getByLabel('选择项目').selectOption({label:`${proof.draft.name} · r1`});await page.getByRole('tab',{name:/发布与验证/}).click();
    const publication=page.getByTestId(`publication-${proof.snapshot.id}`);await expect(publication).toBeVisible();
    await publication.getByLabel('我已审阅验收报告，同意切换演示入口').check();await publication.getByRole('button',{name:/发布此验证版本/}).click();
    await expect(publication.getByTestId('release-status')).toHaveText('发布成功',{timeout:240_000});
    const overview=await api<ReleaseOverview>(`/api/drafts/${proof.draft.id}/releases`),version=overview.versions.find(v=>v.id===overview.pointer?.versionId)!;
    expect(version.reference.binding.candidate?.id).toBe(proof.candidate.id);expect(version.reference.binding.artifactDigest).toBe(proof.candidate.artifactDigest);evidence.publication=overview;
    const demo=page.getByTestId(`demo-app-${proof.draft.id}`);await demo.getByLabel('模拟业务身份').selectOption('U1002');await demo.getByRole('button',{name:'进入模拟 App',exact:true}).click();
    await demo.getByLabel('业务请求').fill('查询 PUMP-001 的状态、温度和来源，申请创建检查工单。');await demo.getByRole('button',{name:'发送业务请求',exact:true}).click();await expect(demo.getByTestId('demo-request-status')).toHaveText('等待确认',{timeout:180_000});
    const detail=JSON.parse(await demo.getByTestId('demo-evidence').textContent()??'{}') as {requestId:string;runId:string;environmentId:string};evidence.businessIds=detail;
    const before=mockState(detail.environmentId,detail.runId);evidence.beforeApproval=before;
    expect(before.calls.items.filter(c=>c.operation==='work-order-create')).toHaveLength(0);expect(Object.keys(before.environment.state.workOrders??{})).toHaveLength(0);
    await demo.getByRole('button',{name:'确认模拟操作',exact:true}).click();await expect(demo.getByTestId('demo-request-status')).toHaveText('已完成',{timeout:180_000});
    const grant=await api<{token:string}>('/api/demo-sessions','POST',{agentId:proof.draft.id,actorId:'U1002'}),authorization=`Bearer ${grant.token}`;
    const business=await api<InvocationView>(`/agent-api/requests/${detail.requestId}`,'GET',undefined,authorization);evidence.business=business;
    expect(business.agentVersion).toBe(version.id);expect(business.run).toMatchObject({status:'succeeded',artifactDigest:proof.candidate.artifactDigest,actorId:'U1002'});expect(business.actions).toHaveLength(1);expect(business.actions[0]!.status).toBe('succeeded');
    const action=business.actions[0]!;await api(`/agent-api/requests/${business.requestId}/actions/${action.id}/decision`,'POST',{decisionId:action.decisionId,actionHash:action.actionHash,decision:'approve'},authorization);
    const after=mockState(detail.environmentId,detail.runId);evidence.afterDuplicateConfirmation=after;
    expect(after.calls.items.filter(c=>c.operation==='work-order-create')).toHaveLength(1);expect(Object.keys(after.environment.state.workOrders??{})).toHaveLength(1);
    evidence.status='passed';await save(evidence);console.log(JSON.stringify({stage:'workorder-release-resume-passed',sourceRunId:proof.id,versionId:version.id,requestId:business.requestId,actualWorkOrders:Object.keys(after.environment.state.workOrders??{}).length}));
  }catch(error){evidence.status='failed';evidence.failure=String(error);await save(evidence);throw error;}
});
