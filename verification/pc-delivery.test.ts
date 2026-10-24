import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkbench,readTree} from '../workbench-server/app.js';
import {pcRunFixture} from './fixtures/pc-run-engine.js';

test('PC delivery exports and downloads immutable technical packages without claiming business or publication',async t=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-pc-delivery-')),fixture=pcRunFixture();
 const wb=createWorkbench({root,runEngine:fixture.engine,templateFiles:{...readTree(resolve('templates/moa')),'pom.xml':'<project/>','src/main/java/com/openjiuwen/workbench/BusinessApplication.java':'contract fixture'}});
 const release=wb.store.publish('moa-platform','platform','1.0.0'),project=wb.store.createApplication(release.id,'交付测试应用','application');const run=await wb.runs.start(project.id,'application',project.head);
 for(let n=0;n<100&&wb.runs.get(run.id,'application').status!=='running';n++)await new Promise(r=>setTimeout(r,10));
 const server=wb.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const browser=await chromium.launch({headless:true});
 t.after(async()=>{await browser.close();await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();rmSync(root,{recursive:true,force:true});});
 const address=server.address();assert.ok(address&&typeof address!=='string');const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(5000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${address.port}`);await page.getByRole('button',{name:'进入工程'}).click();await page.getByRole('button',{name:'版本与导出',exact:true}).click();
 await page.getByRole('button',{name:'导出所选运行',exact:true}).click();await page.getByRole('link',{name:'下载应用包',exact:true}).waitFor();
 const record=wb.exports.list(project.id,'application')[0];assert.equal(record.head,project.head);assert.equal(record.verification.business,'not-verified');
 await page.getByText('独立运行未验证 · 业务未验证 · 未发布',{exact:true}).waitFor();
 for(const kind of ['application','source'] as const){const pending=page.waitForEvent('download');await page.getByRole('link',{name:kind==='application'?'下载应用包':'下载源码包',exact:true}).click();const download=await pending;const path=await download.path();assert.ok(path);assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),record.artifacts[kind].sha256);}
 await page.getByRole('button',{name:'查看交付清单',exact:true}).click();await page.locator('#delivery-manifest').waitFor();assert.match(await page.locator('#delivery-manifest').innerText(),/technical-export/);
 await page.getByRole('button',{name:'文件与指令',exact:true}).click();await page.locator('#editor').fill('导出后的新指令');await page.getByRole('button',{name:'保存所有修改'}).click();await page.getByText('已提交工程版本',{exact:true}).waitFor();
 await page.getByRole('button',{name:'版本与导出',exact:true}).click();await page.getByText('所选运行是旧版本；导出不会包含当前工程的新修改。',{exact:true}).waitFor();await page.getByRole('button',{name:'导出所选运行',exact:true}).click();await page.getByText('复用同一运行的固定交付包',{exact:true}).waitFor();assert.equal(wb.exports.list(project.id,'application').length,1);
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`delivery overflow at ${width}`);}
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/workbench-pc-delivery.png',fullPage:true});
 await page.locator('#identity').selectOption('platform');await page.getByRole('button',{name:'查看诊断'}).click();await page.getByRole('button',{name:'版本与导出',exact:true}).click();await page.getByRole('link',{name:'下载应用包',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'导出所选运行',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'清理交付包',exact:true}).count(),0);
 assert.equal(fixture.counters.builds,1);assert.equal(fixture.counters.messages,0);assert.deepEqual(errors,[]);
});
