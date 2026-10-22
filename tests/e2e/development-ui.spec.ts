import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {draftInput} from '../support/fixtures.js';
import {equipmentAssembly} from '../../packages/contracts/src/equipment-template.js';
import {assemble,contentDigest} from '../../apps/server/src/snapshots/domain/assembly.js';
import {equipmentBaseline} from '../../apps/server/src/acceptance/application/equipment-baseline.js';
import type {DevelopmentJob} from '../../packages/contracts/src/development.js';
import type {Candidate} from '../../packages/contracts/src/candidates.js';
import type {ValidationExecution,ValidationReport} from '../../packages/contracts/src/validations.js';
test('development UI restores tasks, cancels, and displays source and command evidence using explicit API fixtures',async({page})=>{
 const now=new Date().toISOString();const draft={...draftInput,name:'自动开发界面测试夹具',id:randomUUID(),revision:1,createdAt:now,updatedAt:now,brief:{...draftInput.brief,output:{value:'设备状态报告',source:'user' as const,confirmed:true}}};
 const snapshotId=randomUUID();const assembly=equipmentAssembly();const snapshot={id:snapshotId,draftId:draft.id,draftRevision:1,digest:'a'.repeat(64),createdAt:now,content:{draft,assembly,runtimeSpec:assemble(snapshotId,assembly),executionMode:'trusted-local',sdk:{core:'0.1.17',runtime:'0.1.4'},modelProfile:'fixture',connectionProfile:'mock-equipment@1'}};
 const content=equipmentBaseline(draft,'equipment-read@1');const baseline={id:randomUUID(),draftId:draft.id,draftRevision:1,digest:contentDigest(content),confirmedAt:now,confirmedBy:'fixture',content};
 const commandId=randomUUID();let starts=0;let job:DevelopmentJob|undefined;const history:DevelopmentJob[]=[];
 let registered:Candidate|undefined;let validation:ValidationExecution|undefined;let report:ValidationReport|undefined;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());const path=url.pathname;let body:unknown={items:[]};
  if(path==='/api/auth/session')body={csrfToken:'fixture-csrf'};
  else if(path==='/api/environment')body={checkedAt:now,executionMode:'trusted-local',sandboxEnabled:false,database:'ready',model:'configured_unverified',runtime:'ready',canRun:true,canSaveDraft:true,blockers:[]};
  else if(path==='/api/drafts')body={items:[draft]};
  else if(path===`/api/drafts/${draft.id}/snapshots`)body={items:[snapshot]};
  else if(path.includes('baseline-preview'))body={content,digest:baseline.digest};
  else if(path.endsWith('/baselines'))body={items:[baseline]};
  else if(path.endsWith('/releases'))body={pointer:null,versions:[],operations:[],cleanupPending:[]};
  else if(path===`/api/drafts/${draft.id}/development`)body={items:history};
  else if(path===`/api/drafts/${draft.id}/candidates`)body={items:registered?[registered]:[]};
  else if(path==='/api/candidates'&&route.request().method()==='POST'){
   const input=route.request().postDataJSON();expect(input.developmentJobId).toBe(job?.id);expect(input.snapshotId).toBe(snapshotId);
   body={id:randomUUID(),agentId:draft.id,snapshotId,snapshotDigest:snapshot.digest,specDigest:'a'.repeat(64),artifactDigest:'9'.repeat(64),bundleDigest:'8'.repeat(64),provenance:'generated-component',createdAt:now,generated:{developmentJobId:job!.id,baselineId:baseline.id}};registered=body as Candidate;
  }
  else if(path===`/api/snapshots/${snapshotId}/validations`){
   if(route.request().method()==='POST'){
    const input=route.request().postDataJSON();expect(input.candidateId).toBe(registered!.id);expect(input.baselineId).toBe(baseline.id);
    validation={id:randomUUID(),snapshotId,baselineId:baseline.id,clientRequestId:input.clientRequestId,inputDigest:'5'.repeat(64),allowMockWrites:false,status:'completed',verdict:'unverified',cases:content.cases.map(c=>({caseId:c.id,runId:randomUUID(),state:'completed'})),results:[],createdAt:now,updatedAt:now,binding:{baselineDigest:baseline.digest,snapshotDigest:snapshot.digest,artifactDigest:registered!.artifactDigest,testSetDigest:contentDigest(content.cases),compatibilityKey:'6'.repeat(64),mockDigest:'7'.repeat(64),modelProfile:{digest:'a'.repeat(64),executionMode:'simulated'} as ValidationExecution['binding']['modelProfile'],candidate:{id:registered!.id,bundleDigest:registered!.bundleDigest,provenance:'generated-component',developmentJobId:job!.id,testPlanDigest:job!.bundle!.planDigest}}};
    report={executionId:validation.id,baselineId:baseline.id,snapshotId,binding:validation.binding,verdict:'unverified',reasons:['REAL_MODEL_REQUIRED'],cases:content.cases.map(c=>({caseId:c.id,status:'passed',assertions:c.assertions.map(a=>({...a,status:'passed',actual:a.expected})),reasons:[],evidenceId:randomUUID(),evidenceDigest:'d'.repeat(64)})),createdAt:now};body=validation;
   }else body={items:validation?[validation]:[]};
  }else if(path.startsWith('/api/validations/')&&validation){body=path.endsWith('/report')?report:path.includes('/evidence/')?{scope:'UI fixture',candidateId:registered!.id,ingress:'/test-api/deployments/fixture'}:validation;}
  else if(path===`/api/snapshots/${snapshotId}/development`){starts++;const input=route.request().postDataJSON();expect(input.baselineId).toBe(baseline.id);expect(input.generation.scope).toEqual(['tool','skill']);
   job={id:randomUUID(),agentId:draft.id,snapshotId,baselineId:baseline.id,baselineDigest:baseline.digest,inputDigest:'b'.repeat(64),createdAt:now,updatedAt:now,status:starts===1?'running':'built',roles:[{role:'tester',status:'completed',sessionId:'fixture-tester'},{role:'developer',status:starts===1?'running':'completed',sessionId:'fixture-developer'}]};
   if(starts>1)job.bundle={digest:'c'.repeat(64),artifactDigest:'d'.repeat(64),sourceDigest:'e'.repeat(64),profileDigest:'f'.repeat(64),sdkArtifactDigest:'1'.repeat(64),snapshotId,baselineId:baseline.id,baselineDigest:baseline.digest,planDigest:'2'.repeat(64),unitRedId:commandId,unitGreenId:randomUUID(),contractCheckId:randomUUID(),buildId:randomUUID(),files:[{path:'src/generated/EquipmentTool.java',digest:'3'.repeat(64),size:42}]};
   if(starts===3){expect(input.repairExecutionId).toBe(report!.executionId);job.repair={executionId:report!.executionId,reportDigest:'a'.repeat(64),candidateId:registered!.id,candidateBundleDigest:registered!.bundleDigest,artifactDigest:registered!.artifactDigest,parentJobId:history[0]!.id,rootJobId:history[0]!.id,attempt:1,maxAttempts:3};job.roles[0]!.status='reused';}
   history.unshift(job);body=job;
  }else if(path.startsWith('/api/development/')&&job){
   if(path.endsWith('/cancel')){job.status='cancelled';body=job;}
   else if(path.endsWith('/events'))body={items:job.status==='built'&&Number(url.searchParams.get('after')??0)===0?[{sequence:1,occurredAt:now,subjectId:job.id,role:null,type:'command.completed',data:{id:commandId,commandId:'unit-test',status:'failed',exitCode:1}}]:[]};
   else if(path.endsWith('/file'))body={path:'src/generated/EquipmentTool.java',digest:'3'.repeat(64),content:'// UI fixture: <svg onload="window.untrusted=true">\nclass EquipmentTool {}'};
   else if(path.includes('/commands/'))body={id:commandId,commandId:'unit-test',status:'failed',exitCode:1,output:'IMPLEMENTATION_REQUIRED',args:[],executable:'java',startedAt:now,finishedAt:now,truncated:false};
   else body=job;
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/');await page.getByRole('button',{name:draft.name,exact:true}).click();let panel=page.getByTestId(`development-${snapshotId}`);
 await panel.getByRole('button',{name:'启动双角色开发',exact:true}).click();await expect(panel.getByTestId('development-status')).toHaveText('开发中');
 await page.reload();await page.getByRole('button',{name:draft.name,exact:true}).click();panel=page.getByTestId(`development-${snapshotId}`);await expect(panel.getByTestId('development-status')).toHaveText('开发中');
 await panel.getByRole('button',{name:'取消开发任务',exact:true}).click();await expect(panel.getByTestId('development-status')).toHaveText('已取消');await expect(panel.getByRole('button',{name:'启动双角色开发',exact:true})).toBeEnabled();
 await panel.getByRole('button',{name:'启动双角色开发',exact:true}).click();await expect(panel.getByTestId('development-status')).toHaveText('构建完成');
 await panel.getByRole('button',{name:'src/generated/EquipmentTool.java',exact:true}).click();await expect(panel.getByTestId('development-review')).toContainText('<svg onload=');expect(await page.evaluate(()=>Reflect.get(window,'untrusted'))).toBeUndefined();
 await panel.getByText(/开发与测试执行记录（/).click();await panel.getByRole('button',{name:'查看执行证据',exact:true}).click();await expect(panel.getByTestId('development-review')).toContainText('IMPLEMENTATION_REQUIRED');
 const candidate=page.getByTestId(`candidate-${snapshotId}`);await candidate.getByRole('button',{name:'刷新可用构建',exact:true}).click();await expect(candidate.getByLabel('候选来源').locator('option')).toHaveCount(2);await candidate.getByLabel('候选来源').selectOption(job!.id);
 await candidate.getByRole('button',{name:'登记固定候选',exact:true}).click();await expect(candidate.getByTestId('candidate-source')).toHaveText('来源：自动生成 Tool 与 Skill');
 await expect(candidate.getByTestId('bound-skill')).toContainText('已绑定 Skill：equipment-query');
 await expect(candidate.getByRole('button',{name:'启动独立预览',exact:true})).toBeEnabled();
 const acceptance=page.getByTestId(`validation-${snapshotId}`);await expect(acceptance.getByLabel('自动验收目标')).toHaveValue(registered!.id);
 await acceptance.getByRole('button',{name:'运行验收用例',exact:true}).click();await expect(acceptance.getByTestId('validation-status')).toHaveText('未验证');await expect(acceptance.getByTestId('validation-candidate')).toContainText(registered!.id);
 await acceptance.getByText('验收版本与摘要',{exact:true}).click();await expect(acceptance.getByText('验收版本与摘要',{exact:true}).locator('..')).toContainText(job!.bundle!.planDigest);
 await acceptance.getByText('TC-001 · 通过',{exact:true}).click();await acceptance.getByRole('button',{name:'查看证据 TC-001',exact:true}).click();await expect(acceptance.getByTestId('validation-evidence')).toContainText('/test-api/deployments/fixture');
 await expect(acceptance.getByRole('button',{name:'发布此验证版本',exact:true})).toBeDisabled();
 await expect(panel.getByRole('button',{name:'按失败证据修复',exact:true})).toHaveCount(0);
 report!.verdict='failed';report!.reasons=[];report!.cases[0]!.status='failed';report!.cases[0]!.assertions[0]!.status='failed';report!.cases[0]!.assertions[0]!.actual='wrong';validation!.verdict='failed';
 await page.reload();await page.getByRole('button',{name:draft.name,exact:true}).click();await expect(acceptance.getByTestId('validation-status')).toHaveText('未通过');
 await panel.getByRole('button',{name:'按失败证据修复',exact:true}).click();await expect(panel.getByTestId('repair-reference')).toContainText('第 1 / 3 次');await expect(panel.getByTestId('repair-reference')).toContainText(report!.executionId);
 await expect(panel.getByText(/测试 Agent：复用固定方案/)).toBeVisible();expect(starts).toBe(3);
 await expect(acceptance.getByTestId('validation-status')).toHaveText('未通过');
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await mkdir('test-results/tdd-016',{recursive:true});await panel.screenshot({path:'test-results/tdd-016/development-ui-mobile.png'});await candidate.screenshot({path:'test-results/tdd-016/generated-candidate-ui-mobile.png'});await acceptance.screenshot({path:'test-results/tdd-016/candidate-validation-ui-mobile.png'});
 await writeFile('test-results/tdd-016/development-ui.json',JSON.stringify({checkedAt:now,testMode:'stubbed-management-api',checks:['task-restore','cancel','generated-source-text-only','command-evidence','generated-candidate-registration','candidate-validation-binding','test-api-evidence','simulated-not-publishable','failed-report-repair','fixed-plan-reuse','old-report-retained','390px-layout'],liveModel:false},null,2));
});
