const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const out=path.resolve(process.env.DEMO_CHECK_OUTPUT||'test-results/prototype-v2-assembly/checks');
fs.mkdirSync(out,{recursive:true});
const key='openjiuwen-workbench-v2-demo-3';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DEMO_BROWSER_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(5000);
 const checks=[],errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
 const click=async(action,attrs='')=>{const selector=`[data-action="${action}"]${attrs}`;const modal=page.locator(`#dialog[open] ${selector}`);await (await modal.count()?modal:page.locator(selector+':visible')).first().click();};
 const role=async value=>{await click('identity-switcher');await click('role',`[data-role="${value}"]`);};
 const dev=async id=>{await click('tab','[data-id="develop"]');await click('dev-section',`[data-id="${id}"]`);};
 const create=async name=>{await click('create-app');await page.locator('#new-app-name').fill(name);await page.locator('#new-app-goal').fill('为员工查询 i豆并完成福利兑换');await click('create-confirm');};
 const shot=async name=>{await page.evaluate(()=>scrollTo(0,0));await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.screenshot({path:path.join(out,name+'.png')});};
 try{
  await page.goto(pathToFileURL(path.resolve(__dirname,'../开发工作台2.0.html')).href);
  await create('员工福利助手');await click('tab','[data-id="develop"]');
  await click('add-capability');await expect(page.locator('#dialog [data-action="choose-capability"]')).toHaveCount(3);
  await expect(page.locator('#dialog')).toContainText('Agent／工作流');await expect(page.locator('#dialog')).toContainText('业务 Skill');await expect(page.locator('#dialog')).toContainText('工具');
  await click('choose-capability','[data-type="remote"]');await page.locator('#capability-name').fill('积分查询服务');await page.locator('#capability-method').selectOption('a2a-workflow');await page.locator('#capability-purpose').fill('调用企业已提供的查询工作流');await click('save-capability');
  let s=await state();assert.equal(s.app.capabilityDrafts.length,1);assert.equal(s.app.capabilityDrafts[0].method,'a2a-workflow');assert.equal(s.app.capabilityDrafts[0].runnable,false);assert.equal(s.runs.length,0);
  await click('add-capability');await click('choose-capability','[data-type="skill"]');await page.locator('#capability-name').fill('福利办理');await page.locator('#capability-purpose').fill('组织查询、确认和兑换');await page.locator('#capability-content').fill('# 福利办理\n先查询，再确认，最后兑换。');await click('save-capability');
  await click('add-capability');await click('choose-capability','[data-type="tool"]');await expect(page.locator('#capability-method option')).toHaveText(['HTTP API','MCP 工具','Python 脚本']);await page.locator('#capability-name').fill('兑换条件校验');await click('save-capability');await expect(page.locator('#dialog')).toBeVisible();await page.locator('#capability-purpose').fill('验证输入数量');await page.locator('#capability-target').fill('benefit.validate');await click('save-capability');assert.equal((await state()).app.capabilityDrafts[2].method,'http');await click('edit-capability','[data-id="cap-003"]');await page.locator('#capability-method').selectOption('mcp');await click('save-capability');assert.equal((await state()).app.capabilityDrafts[2].method,'mcp');await click('edit-capability','[data-id="cap-003"]');await page.locator('#capability-method').selectOption('script');await page.locator('#capability-content').fill('def validate(quantity):\n    return quantity > 0');await click('save-capability');
  s=await state();assert.deepEqual(s.app.capabilityDrafts.map(x=>x.type),['remote','skill','tool']);const rev=s.app.rev;
  await expect(page.locator('.assembly-draft')).toHaveCount(3);await expect(page.locator('.canvas-main')).toContainText('待实现');
  await page.reload();assert.equal((await state()).app.capabilityDrafts.length,3);
  checks.push('三类入口可创建草稿，工具方式与能力类型分层；未产生调用或执行成功');
  await click('edit-capability','[data-id="cap-003"]');await page.locator('#capability-name').fill('兑换数量校验');await click('save-capability');assert.equal((await state()).app.rev,rev+1);
  await click('capability-to-agent','[data-id="cap-003"]');await expect(page.locator('#agent-prompt')).toHaveValue(/Python 脚本/);await click('ask-agent');assert.equal((await state()).coding.scene.proposal,null);
  await dev('files');await click('file','[data-id="capabilities"]');await expect(page.locator('#code-editor')).toHaveAttribute('readonly','');await expect(page.locator('#code-editor')).toHaveValue(/兑换数量校验/);
  await click('view','[data-id="apps"]');await create('第二个应用');assert.equal((await state()).app.capabilityDrafts.length,0);await click('app-switcher');await click('switch-app','[data-id="app-001"]');assert.equal((await state()).app.capabilityDrafts.length,3);
  checks.push('编辑、刷新、文件映射和多应用隔离；Coding Agent 不误生成无关业务方案');
  await role('platform');await click('platform-tab','[data-id="capabilities"]');await page.locator('[data-assembly-type="tool"]').uncheck();await click('save-assembly-scope');
  assert.equal((await state()).platform.assemblyTypes.includes('tool'),false);const oldVersion=(await state()).app.template;
  await click('platform-check');await click('platform-tab','[data-id="publish"]');await click('template-preview');await expect(page.locator('#dialog [data-testid="assembly-scope"]')).not.toContainText('工具');await click('close');await click('publish');
  const newVersion=(await state()).platform.templateVersion;assert.notEqual(newVersion,oldVersion);
  await role('scene');assert.equal((await state()).app.template,oldVersion);await dev('assembly');await click('add-capability');await expect(page.locator('#dialog [data-action="choose-capability"]')).toHaveCount(3);await click('close');
  await click('view','[data-id="apps"]');await create('受限模板应用');assert.equal((await state()).app.template,newVersion);await click('tab','[data-id="develop"]');await click('add-capability');await expect(page.locator('#dialog [data-action="choose-capability"]')).toHaveCount(2);await expect(page.locator('#dialog [data-type="tool"]')).toHaveCount(0);await click('close');
  await page.reload();await click('add-capability');await expect(page.locator('#dialog [data-action="choose-capability"]')).toHaveCount(2);await click('close');
  checks.push('平台开放类型随发行固定；新应用只显示已开放入口，旧应用不被改写');
  await click('app-switcher');await click('switch-app','[data-id="app-001"]');await click('tab','[data-id="overview"]');await click('suggest','[data-kind="plan"]');await click('apply-proposal');
  await dev('connections');await page.locator('#connection').selectOption('mock');await click('save-connection');await dev('tools');await click('suggest','[data-kind="mapping"]');await click('apply-proposal');
  await click('tab','[data-id="debug"]');await click('run');assert.equal((await state()).runs.at(-1).status,'succeeded');const oldRun=JSON.stringify((await state()).runs.at(-1));
  await click('test-mode','[data-id="checks"]');await click('test');assert.equal((await state()).report.passed,false);assert.equal((await state()).report.cases.find(x=>x.id==='assembly').passed,false);
  await dev('assembly');
  for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot('assembly-'+width);
   await click('edit-capability','[data-id="cap-003"]');await shot('tool-editor-'+width);await expect(page.locator('#dialog [data-action="save-capability"]')).toBeInViewport();await click('close');
  }
  await page.locator('.assembly-draft').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'assembly-drafts.png')});
  for(const id of ['cap-001','cap-002','cap-003']){await click('remove-capability',`[data-id="${id}"]`);await click('remove-capability-confirm');}
  assert.equal((await state()).app.capabilityDrafts.length,0);assert.equal(JSON.stringify((await state()).runs.at(-1)),oldRun);
  await click('test-mode','[data-id="checks"]');await click('test');assert.equal((await state()).report.passed,true);await click('tab','[data-id="delivery"]');await click('candidate');assert.equal((await state()).candidate.revision,(await state()).app.rev);
  checks.push('待实现能力阻断完整候选检查；移除后原 Mock 可交付，旧运行快照不变');
  await role('platform');await click('platform-tab','[data-id="capabilities"]');await page.setViewportSize({width:1440,height:900});await shot('platform-assembly');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);checks.push('PC 三种窗口、弹窗保存可见；无外部请求或浏览器异常');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:checks.length,checks,errors,requests,simulation:true},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
 }catch(e){await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.message,checks,errors},null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
