import {navigate} from './pc-navigation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createWorkbench,readTree} from '../workbench-server/app.js';

test('desktop workbench follows prototype shell with persistent real coding dock and independent canvas',async t=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-desktop-'));let generations=0;
 const wb=createWorkbench({root,templateFiles:readTree(resolve('templates/moa')),codingEngine:{async run(){generations++;throw Error('Layout must not generate');}}});
 const release=wb.store.publish('moa-platform','platform','1.0.0');const app=wb.store.createApplication(release.id,'桌面福利应用','application');
 const server=wb.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const browser=await chromium.launch({headless:true});
 t.after(async()=>{await browser.close();await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();rmSync(root,{recursive:true,force:true});});
 const address=server.address();assert.ok(address&&typeof address!=='string');const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+address.port);await page.getByRole('button',{name:'进入工程',exact:true}).click();
 await page.locator('.copilot').waitFor({timeout:3000});
 for(const width of [1280,1440,1920]){
  await page.setViewportSize({width,height:1000});const positions={nav:(await page.locator('.sidebar').boundingBox())!,canvas:(await page.locator('.canvas-main').boundingBox())!,dock:(await page.locator('.copilot').boundingBox())!,identity:(await page.locator('#identity').boundingBox())!,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};
  assert.equal(positions.overflow,false);assert.ok(positions.canvas.width>=650);assert.ok(positions.dock.width>=280);assert.ok(positions.dock.x>=positions.canvas.x+positions.canvas.width-1);assert.ok(positions.dock.y+positions.dock.height<=1001);assert.ok(positions.identity.x>width/2);assert.ok(positions.nav.width<=205);
 }
 await page.setViewportSize({width:1440,height:1000});await page.getByLabel('开发需求',{exact:true}).fill('常驻助手未发送的开发需求');
 await navigate(page,'业务配置');assert.equal(await page.getByLabel('开发需求',{exact:true}).inputValue(),'常驻助手未发送的开发需求');await page.getByLabel('自己负责的业务').fill('桌面配置保存');assert.equal(await page.getByRole('button',{name:'生成修改建议',exact:true}).isDisabled(),true);
 await navigate(page,'文件与指令');await page.getByRole('button',{name:'application.json',exact:true}).click();assert.match(await page.locator('#editor').inputValue(),/桌面配置保存/);await page.getByRole('button',{name:'保存所有修改',exact:true}).click();await page.getByText('已提交工程版本',{exact:true}).waitFor();assert.deepEqual(wb.store.definition(app.id,'application').scope.own,['桌面配置保存']);assert.equal(await page.getByRole('button',{name:'生成修改建议',exact:true}).isEnabled(),true);
 assert.ok((await page.locator('#editor').boundingBox())!.height>=400);await page.screenshot({path:'/tmp/workbench-desktop-application.png',fullPage:true});
 await page.locator('#identity').selectOption('platform');await page.locator('section.panel').filter({has:page.getByRole('heading',{name:'桌面福利应用',exact:true})}).getByRole('button',{name:'查看诊断'}).click();await page.getByText('平台身份只能查看此应用的编码记录',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'生成修改建议',exact:true}).count(),0);assert.equal(generations,0);assert.deepEqual(errors,[]);
});
