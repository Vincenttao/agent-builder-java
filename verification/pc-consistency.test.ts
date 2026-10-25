import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';
import {chromium} from '@playwright/test';import {createWorkbench,readTree} from '../workbench-server/app.js';import {definitionInputs,consistencyPath} from '../workbench-server/consistency-contract.js';import {checkedRelease} from './fixtures/checked-release.js';

test('PC diagnoses traceable sources, reviews an associated repair, rechecks and keeps platform diagnosis readonly',async t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-consistency-'));let verdict='conflict',calls=0;
 const wb=createWorkbench({root,codingEngine:{kind:'contract-fixture',async run(input){calls++;const files=readTree(input.directory);delete files['.git'];const source=definitionInputs(files);
  if(input.purpose==='consistency'){mkdirSync(dirname(join(input.directory,consistencyPath)),{recursive:true});writeFileSync(join(input.directory,consistencyPath),JSON.stringify({inputDigest:source.digest,verdict,issues:verdict==='clear'?[]:[{paths:['application.json','instructions.md'],description:'查询范围与指令相互冲突',impact:'余额查询可能被拒绝',suggestion:'统一指令并保留确认约束'}]}));}
  else writeFileSync(join(input.directory,'instructions.md'),'查询业务可以执行，写操作必须原确认。');
  return {sessionId:'fixture',model:'fixture',summary:'契约诊断或修订',evidence:[{tool:'skill',status:'completed',input:{name:input.skill}},...source.required.map(filePath=>({tool:'read',status:'completed',input:{filePath:join(input.directory,filePath)}}))]};
 }}});const release=checkedRelease(wb.store,'moa-platform','platform','1.0.0'),p=wb.store.createApplication(release.id,'一致性演示','application');
 const server=wb.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');const browser=await chromium.launch({headless:true});t.after(async()=>{await browser.close();await wb.close();await new Promise<void>(r=>server.close(()=>r()));wb.store.close();rmSync(root,{recursive:true,force:true});});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+address.port);await page.getByRole('button',{name:'进入工程',exact:true}).click();await page.getByRole('button',{name:'测试',exact:true}).click();await page.getByRole('button',{name:'一致性检查',exact:true}).click();
 await page.getByRole('button',{name:'检查当前保存版本',exact:true}).click();await page.getByRole('heading',{name:'查询范围与指令相互冲突',exact:true}).waitFor();assert.equal(calls,1);assert.equal(wb.store.get(p.id,'application').head,p.head);
 await page.getByLabel('修订意图（可选）',{exact:true}).fill('允许查询，保留写操作确认');await page.getByRole('button',{name:'交给Coding生成关联修订',exact:true}).click();
 await page.getByRole('button',{name:'应用全部差异',exact:true}).waitFor();assert.equal(calls,2);await page.getByText(/关联诊断/).waitFor();
 assert.equal(await page.locator('#coding-after').inputValue(),'查询业务可以执行，写操作必须原确认。');await page.getByRole('button',{name:'应用全部差异',exact:true}).click();await page.getByText('建议已应用并提交工程版本',{exact:true}).waitFor();
 await page.getByRole('button',{name:'测试',exact:true}).click();await page.getByRole('button',{name:'一致性检查',exact:true}).click();await page.getByText('定义已修订，等待复核',{exact:true}).waitFor();
 verdict='clear';await page.getByRole('button',{name:'检查当前保存版本',exact:true}).click();await page.locator('#consistency-state strong').filter({hasText:'定义一致，业务仍需验证'}).waitFor();assert.equal(calls,3);
 await page.getByText('本次没有发现定义冲突；实际路由、确认、写入和内容保留仍须业务测试验证。',{exact:true}).waitFor();
 mkdirSync('test-results/journey-gap-consistency-pc',{recursive:true});for(const width of [1280,1440,1920]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`test-results/journey-gap-consistency-pc/clear-${width}.png`,fullPage:true});}
 await page.locator('#identity').selectOption('platform');await page.locator('.project-card').filter({hasText:'一致性演示'}).getByRole('button',{name:'查看诊断',exact:true}).click();await page.getByRole('button',{name:'测试',exact:true}).click();await page.getByRole('button',{name:'一致性检查',exact:true}).click();await page.getByText('当前身份只能查看诊断，不能发起分析或修订。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'复核当前保存版本',exact:true}).count(),0);assert.equal(calls,3);assert.deepEqual(errors,[]);
});
