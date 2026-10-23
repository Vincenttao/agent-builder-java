import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {draftInput} from '../support/fixtures.js';
import {mockScenePackage} from '../../apps/mock-services/src/scene.js';

test('project export downloads a portable package and import creates a separate project',async({page})=>{
  const now=new Date().toISOString();const original={...draftInput,id:randomUUID(),name:'可迁移设备助手',revision:1,createdAt:now,updatedAt:now};
  const imported={...original,id:randomUUID(),name:'可迁移设备助手',revision:1};let currentDrafts=[original];
  const pkg={schemaVersion:1,packageKind:'agent-builder-project',source:{projectId:original.id,revision:1,exportedAt:now},draft:{name:original.name,brief:original.brief},snapshots:[],baselines:[],automation:{jobs:[],candidates:[],artifactDependencies:[]},mockScene:mockScenePackage,connectionRequirements:[],packageDigest:'a'.repeat(64)};
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());const path=url.pathname;let body:unknown={};
    if(path==='/api/auth/session')body={csrfToken:'fixture'};
    else if(path==='/api/environment')body={database:'ready',model:'configured_unverified',runtime:'ready',canRun:true};
    else if(path==='/api/drafts'&&route.request().method()==='GET')body={items:currentDrafts};
    else if(path.endsWith('/snapshots'))body={items:[]};
    else if(path===`/api/drafts/${original.id}/export`)body=pkg;
    else if(path.endsWith('/recovery-package'))body=pkg;
    else if(path==='/api/projects/import'&&route.request().method()==='POST'){
      expect(route.request().postDataJSON()).toEqual(pkg);currentDrafts=[...currentDrafts,imported];
      body={draft:imported,snapshots:[],needsRequirementConfirmation:false,baselinesToReview:[],connectionsToRebind:['equipment-mock@1']};
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('/');await page.getByLabel('选择项目').selectOption(original.id);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出项目'}).click();
  const download=await downloadPromise;expect(download.suggestedFilename()).toBe('agent-builder-可迁移设备助手.json');
  await page.locator('input[type="file"]').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pkg))});
  await expect(page.locator('body')).toContainText('项目已导入');await expect(page.locator('body')).toContainText('1 个连接需重绑');
  await expect(page.getByLabel('选择项目')).toHaveValue(imported.id);
  await page.getByRole('button',{name:'加载恢复材料'}).click();await expect(page.getByText('导入来源恢复材料')).toBeVisible();await expect(page.locator('body')).toContainText('0 个已构建任务');
  await expect(page.locator('body')).toContainText('11 个接口契约');await expect(page.locator('body')).toContainText('2 组确定性数据种子');
});
