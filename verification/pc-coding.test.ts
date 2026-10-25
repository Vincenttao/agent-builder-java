import {navigate} from './pc-navigation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createWorkbench,readTree} from '../workbench-server/app.js';
import type {CodingEngine} from '../workbench-server/coding.js';

test('PC Coding reviews fixture changes, protects drafts/stale heads, answers original question and cancels',async t=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-pc-coding-'));
 let progress:()=>void=()=>{};let calls=0,answerCalls=0,answer:((answers:string[][])=>void)|undefined;
 const skills:string[]=[];
 const engine:CodingEngine={kind:'contract-fixture',async run(input){
  calls++;skills.push(input.skill);
  if(input.prompt==='修改福利业务指令'){const file=join(input.directory,'application.json');const definition=JSON.parse(readFileSync(file,'utf8'));definition.description='测试引擎联合修订';writeFileSync(file,JSON.stringify(definition,null,2));}
  if(input.prompt==='需要澄清'){
   progress=()=>input.onEvent({type:'tool',tool:'skill',status:'completed',input:{name:input.skill}});
   input.onEvent({type:'question',id:'question-one',questions:[{question:'是否保留当前范围？',options:[{label:'保留',description:'保留原范围'}]}]});
   const answers=await new Promise<string[][]>((r,j)=>{answer=r;input.signal.addEventListener('abort',()=>j(Error('aborted')),{once:true});});
   assert.deepEqual(answers,[['保留']]);input.onEvent({type:'question_answered'});
  }
  if(input.prompt==='等待取消')await new Promise((_,reject)=>input.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  writeFileSync(join(input.directory,'instructions.md'),'浏览器契约测试建议 '+calls);
  return {sessionId:'pc-contract-fixture-'+calls,model:'contract-fixture',summary:'测试引擎差异，非真实模型生成。',evidence:[{tool:'skill',status:'completed',input:{name:input.skill}}]};
 },async answer(_directory,id,answers){answerCalls++;assert.equal(id,'question-one');assert.ok(answer);answer(answers);}};
 const wb=createWorkbench({root,templateFiles:readTree(resolve('templates/moa')),codingEngine:engine});
 const release=wb.store.publish('moa-platform','platform','1.0.0');const app=wb.store.createApplication(release.id,'编码测试应用','application');
 const original=wb.store.files(app.id,'application')['instructions.md'];
 const server=wb.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const browser=await chromium.launch({headless:true});
 t.after(async()=>{await browser.close();await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();rmSync(root,{recursive:true,force:true});});
 const address=server.address();assert.ok(address&&typeof address!=='string');const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(5000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${address.port}`);await page.getByRole('button',{name:'进入工程'}).click();
 await navigate(page,'Coding 助手');
 await page.getByLabel('开发需求').fill('修改福利业务指令');await page.getByRole('button',{name:'生成修改建议',exact:true}).click();
 await page.getByRole('button',{name:'应用全部差异',exact:true}).waitFor();
 assert.equal(wb.store.get(app.id,'application').head,app.head);assert.equal(wb.store.files(app.id,'application')['instructions.md'],original);
 await page.getByLabel('选择差异文件').selectOption('instructions.md');
 assert.equal(await page.getByLabel('原版本内容').inputValue(),original);assert.equal(await page.getByLabel('建议内容').inputValue(),'浏览器契约测试建议 1');
 for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Coding overflow at ${width}`);}
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/tmp/workbench-pc-coding.png',fullPage:true});
 await page.getByRole('button',{name:'拒绝建议',exact:true}).click();await page.getByText('建议已拒绝，工程保持原状',{exact:true}).waitFor();
 assert.equal(wb.store.get(app.id,'application').head,app.head);
 await page.getByLabel('开发需求').fill('第二次修改');await page.getByRole('button',{name:'生成修改建议',exact:true}).click();await page.getByRole('button',{name:'应用全部差异',exact:true}).waitFor();
 await navigate(page,'文件与指令');await page.locator('#editor').fill('人工未保存草稿');
 await navigate(page,'Coding 助手');assert.equal(await page.getByRole('button',{name:'应用全部差异',exact:true}).isDisabled(),true);
 assert.equal(wb.store.files(app.id,'application')['instructions.md'],original);
 await page.getByRole('button',{name:'保存所有修改'}).click();await page.getByText('已提交工程版本',{exact:true}).waitFor();
 await page.getByRole('button',{name:'重新核对建议',exact:true}).click();await page.getByText('建议已过期，请保留人工修改并重新发起',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'应用全部差异',exact:true}).isDisabled(),true);
 assert.equal(await page.getByLabel('原版本内容').inputValue(),original);
 await page.getByRole('button',{name:'拒绝建议',exact:true}).click();
 await page.getByLabel('开发需求').fill('需要澄清');await page.getByRole('button',{name:'生成修改建议',exact:true}).click();
 await page.getByText('是否保留当前范围？',{exact:true}).waitFor();
 await page.getByLabel('补充回答 1',{exact:true}).fill('问题草稿不会被轮询覆盖');progress();
 await page.getByText('已记录开发 Skill 工具读取：',{exact:false}).waitFor();
 assert.equal(await page.getByLabel('补充回答 1',{exact:true}).inputValue(),'问题草稿不会被轮询覆盖');
 assert.equal(await page.getByLabel('补充回答 1',{exact:true}).evaluate(e=>e===document.activeElement),true);
 await page.reload();await page.getByLabel('补充回答 1',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('补充回答 1',{exact:true}).inputValue(),'问题草稿不会被轮询覆盖');
 assert.equal(calls,3);assert.equal(answerCalls,0); // Refresh observes the original question; it cannot generate or answer.
 await page.getByLabel('补充回答 1',{exact:true}).fill('');
 await page.getByLabel('保留 · 保留原范围',{exact:true}).check();
 await page.reload();await page.getByRole('button',{name:'回答原问题',exact:true}).waitFor();
 assert.equal(await page.getByLabel('保留 · 保留原范围',{exact:true}).isChecked(),true);assert.equal(answerCalls,0);
 await page.getByRole('button',{name:'回答原问题',exact:true}).click();await page.getByRole('button',{name:'应用全部差异',exact:true}).waitFor();
 await page.getByRole('button',{name:'应用全部差异',exact:true}).click();await page.getByText('建议已应用并提交工程版本',{exact:true}).waitFor();
 assert.equal(wb.store.files(app.id,'application')['instructions.md'],'浏览器契约测试建议 3');
 await page.getByLabel('开发需求').fill('等待取消');await page.getByRole('button',{name:'生成修改建议',exact:true}).click();
 await page.getByRole('button',{name:'取消原任务',exact:true}).click();await page.getByText('已取消',{exact:true}).waitFor();assert.equal(calls,4);assert.equal(answerCalls,1);
 await page.locator('#identity').selectOption('platform');await page.getByRole('button',{name:'查看诊断'}).click();await navigate(page,'Coding 助手');
 await page.getByText('平台身份只能查看此应用的编码记录',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'生成修改建议',exact:true}).count(),0);
 assert.ok(skills.every(s=>s==='moa-application-development'));
 await page.getByRole('button',{name:'开发模板与应用诊断',exact:true}).click();await page.getByRole('button',{name:'进入工程',exact:true}).click();
 await navigate(page,'Coding 助手');await page.getByLabel('开发需求').fill('维护范式说明');await page.getByRole('button',{name:'生成修改建议',exact:true}).click();
 await page.getByRole('button',{name:'应用全部差异',exact:true}).waitFor();assert.equal(skills[4],'moa-platform-development');
 await page.getByRole('button',{name:'拒绝建议',exact:true}).click();
 assert.equal(wb.store.files(app.id,'application')['instructions.md'],'浏览器契约测试建议 3');
 assert.deepEqual(errors,[]);
});
