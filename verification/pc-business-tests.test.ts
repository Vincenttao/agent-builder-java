import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {businessTestFixture} from './fixtures/business-workbench.js';

test('PC business regression runs once, preserves the pending request on cancel, and shows immutable evidence to both roles',async t=>{
 let release:()=>void=()=>{};
 const gate=new Promise<void>(resolve=>release=resolve);t.after(()=>release());
 const suite={schemaVersion:1,family:'moa',mockConnection:'idou',cases:[{id:'decline',title:'拒绝不写入',steps:[{id:'ask',type:'message',query:'兑换咖啡',assertions:[{source:'task',path:'state',operator:'equals',value:'WAITING_INPUT'}]},{id:'no',type:'reply',answer:'拒绝',assertions:[{source:'delta',path:'writes',operator:'equals',value:0}]}]}]};
 const {wb,project,run,fixture,baseUrl}=await businessTestFixture(t,suite,{beforeMessage:async()=>gate});
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
 const errors:string[]=[],starts:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/business-tests'))starts.push(r.url());});
 await page.goto(baseUrl);await page.getByRole('button',{name:'进入工程',exact:true}).click();
 await page.getByRole('button',{name:'测试',exact:true}).click();await page.getByRole('button',{name:'业务回归',exact:true}).click();
 await page.getByText('拒绝不写入 · 2 个步骤',{exact:true}).waitFor();
 await page.getByLabel('允许本次用例调用独立Mock',{exact:false}).check();
 await page.getByRole('button',{name:'执行保存版本的业务用例',exact:true}).click();
 await page.getByRole('button',{name:'取消后续步骤',exact:true}).waitFor();
 assert.equal(starts.length,1);assert.equal(wb.runs.get(run.id,'application').testing!==undefined,true);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'取消后续步骤',exact:true}).click();
 await page.getByText(/原测试.*取消中/).waitFor();
 assert.equal(await page.getByRole('button',{name:'执行保存版本的业务用例',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'调试运行',exact:true}).click();await page.getByText('原运行正在执行业务回归，当前只读；取消后续步骤仍会等待原请求核对。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'停止原运行',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'发送新需求',exact:true}).count(),0);await page.getByRole('button',{name:'业务回归',exact:true}).click();
 release();await page.locator('.business-report h2').filter({hasText:'已取消'}).waitFor();
 assert.equal(fixture.counters.messages,1);assert.equal(fixture.counters.writes,0);assert.equal(wb.runs.get(run.id,'application').testing,undefined);
 // A separate explicit click is required for a new execution. Observation alone never reruns it.
 await page.getByRole('button',{name:'执行保存版本的业务用例',exact:true}).click();
 await page.locator('.business-report h2').filter({hasText:/^通过/}).waitFor();
 assert.equal(starts.length,2);assert.equal(fixture.counters.messages,2);assert.equal(fixture.counters.writes,0);
 await page.getByText('契约测试通过，不计真实业务验收',{exact:true}).waitFor();
 const report=page.locator('.business-report').first();await report.getByText('版本与引擎依据',{exact:true}).click();
 assert.match(await report.innerText(),new RegExp(project.head));assert.match(await report.innerText(),new RegExp(run.id));
 mkdirSync('test-results/journey-gap-business-pc',{recursive:true});
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`test-results/journey-gap-business-pc/report-${width}.png`,fullPage:true});}
 await page.locator('#identity').selectOption('platform');await page.locator('.project-card').filter({has:page.getByRole('heading',{name:project.name,exact:true})}).getByRole('button',{name:'查看诊断',exact:true}).click();
 await page.getByRole('button',{name:'测试',exact:true}).click();await page.getByRole('button',{name:'业务回归',exact:true}).click();
 await page.getByText('当前身份只读查看应用测试，不能发起或取消测试。',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'执行保存版本的业务用例',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'清理未引用报告',exact:true}).count(),0);
 assert.equal(starts.length,2);assert.deepEqual(errors,[]);
});
