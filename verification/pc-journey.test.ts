import {checkedRelease} from './fixtures/checked-release.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkbench} from '../workbench-server/app.js';

test('desktop journey explains fixed templates, carries goals to Coding and presents honest states for both paradigms',async t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-journey-'));let generated=0;
 const wb=createWorkbench({root,codingEngine:{async run(){generated++;throw Error('This review must not generate');}}});
 checkedRelease(wb.store,'moa-platform','platform','1.0.0');const deep=checkedRelease(wb.store,'deepagent-platform','platform','1.1.1');
 const server=wb.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');
 const browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();rmSync(root,{recursive:true,force:true});});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+addr.port);await page.locator('.template-choice').first().waitFor();assert.equal(await page.locator('.template-choice').count(),2);
 await page.locator('[data-template-release="'+deep.id+'"]').click();assert.equal(await page.locator('#release').inputValue(),deep.id);assert.match(await page.locator('#template-preview').innerText(),/独立业务/);
 await page.getByLabel('应用名称',{exact:true}).fill('我的独立业务');await page.getByLabel('业务目标',{exact:true}).fill('整理会议材料，保留未修改的事实');await page.getByRole('button',{name:'创建应用',exact:true}).click();
 await page.getByRole('heading',{name:'我的独立业务',exact:true}).waitFor();await page.locator('[data-stage=NEW]').waitFor();assert.equal(wb.store.definition(wb.store.list('application')[0].id,'application').skills.length,0);
 await page.locator('.template-source summary').click();assert.match(await page.locator('.template-source').innerText(),/1.1.1/);assert.match(await page.locator('.template-source').innerText(),/deepagent-application-development/);
 await page.locator('[data-journey-next="coding"]').click();assert.match(await page.getByLabel('开发需求',{exact:true}).inputValue(),/整理会议材料/);assert.equal(generated,0);
 await page.getByRole('button',{name:'开发',exact:true}).click();await page.getByRole('button',{name:'应用设置',exact:true}).click();await page.getByRole('heading',{name:'模型与运行环境',exact:true}).waitFor();
 await page.getByLabel('自己负责的业务',{exact:true}).fill('整理会议材料');await page.locator('[data-stage=DIRTY]').waitFor();await page.locator('[data-journey-next="save"]').click();await page.getByText('已提交工程版本',{exact:true}).waitFor();await page.locator('[data-stage=NEEDS_CHECK]').waitFor();
 await page.getByRole('button',{name:'概览',exact:true}).click();assert.match(await page.locator('#journey-progress').innerText(),/结构检查：未检查/);
 mkdirSync('test-results/journey-gap-batch-a',{recursive:true});
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok((await page.locator('.copilot').boundingBox())!.width>=280);await page.screenshot({path:`test-results/journey-gap-batch-a/deep-overview-${width}.png`,fullPage:true});}
 await page.locator('#identity').selectOption('platform');await page.locator('.project-card').filter({hasText:'我的独立业务'}).getByRole('button',{name:'查看诊断',exact:true}).click();await page.locator('.journey-status strong').filter({hasText:'应用诊断 · 只读'}).waitFor();assert.equal(await page.getByRole('button',{name:'保存所有修改',exact:true}).count(),0);
 await page.getByRole('button',{name:'查看运行与轨迹 →',exact:true}).click();await page.getByText('运行记录只读；需要执行时请进入测试 / 调试运行。',{exact:true}).waitFor();
 assert.equal(generated,0);assert.deepEqual(errors,[]);
});
