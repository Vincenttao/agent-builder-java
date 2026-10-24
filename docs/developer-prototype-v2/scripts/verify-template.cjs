const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const out=path.resolve(root,'../../test-results/prototype-v2-moa-template');
fs.mkdirSync(out,{recursive:true});
const key='openjiuwen-workbench-v2-demo-3';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DEMO_BROWSER_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const click=(action)=>page.locator(`[data-action="${action}"]`).first().click();
 const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
 try{
  await page.goto(pathToFileURL(path.join(root,'开发工作台2.0.html')).href);
  await expect(page.locator('.template-hero h2')).toHaveText('MOA 开发模板',{timeout:1500});
  await expect(page.locator('.template-hero')).not.toContainText('企业福利');
  await page.screenshot({path:path.join(out,'moa-template.png'),fullPage:true});
  await click('create-app');await expect(page.locator('#new-app-name')).toHaveValue('');await page.screenshot({path:path.join(out,'create-scenario.png')});
  await page.locator('#new-app-name').fill('采购协同助手');await page.locator('#new-app-goal').fill('查询采购申请状态，协调审批人与采购系统。');await click('create-confirm');
  let s=await state();assert.equal(s.app.templateId,'moa');assert.equal(s.app.templateName,'MOA 开发模板');assert.equal(s.app.businessProfile,null);assert.equal(s.app.businessSkill,'');assert.equal(s.app.script,'');assert.equal(s.app.goal,'查询采购申请状态，协调审批人与采购系统。');assert.equal(s.business.balance,null);
  await expect(page.locator('.page-head h1')).toHaveText('采购协同助手');await expect(page.locator('.canvas-main')).not.toContainText('查询 i豆');await expect(page.locator('.flow-node')).toHaveCount(0);
  await page.locator('[data-action="tab"][data-id="debug"]').click();await expect(page.locator('[data-action="run"]')).toHaveCount(0);await page.screenshot({path:path.join(out,'custom-scenario.png'),fullPage:true});
  await page.reload();assert.equal((await state()).app.businessProfile,null);await click('create-app');await click('fill-ideabean');await expect(page.locator('#new-app-name')).toHaveValue('i豆服务助手');await click('create-confirm');
  s=await state();assert.equal(s.app.templateId,'moa');assert.equal(s.app.businessProfile,'ideabean');assert.match(s.app.goal,/i豆/);assert.equal(s.business.balance,1280);await expect(page.locator('.flow-node')).toHaveCount(5);
  await click('goto-debug');await click('run');s=await state();assert.equal(s.runs.at(-1).snapshot.application.templateId,'moa');assert.equal(s.runs.at(-1).status,'succeeded');const originalRun=JSON.stringify(s.runs[0]);
  // Old drafts lack these new fields: migration may annotate the active draft, but must preserve evidence.
  await page.evaluate(k=>{const s=JSON.parse(localStorage.getItem(k));delete s.app.templateId;delete s.app.templateName;delete s.app.businessProfile;delete s.app.goal;localStorage.setItem(k,JSON.stringify(s));},key);
  await page.reload();s=await state();assert.equal(s.app.businessProfile,'ideabean');assert.equal(s.app.templateId,'moa');assert.equal(JSON.stringify(s.runs[0]),originalRun);
  await page.locator('[data-action="role"][data-role="platform"]').click();await page.locator('.sidebar [data-action="platform-tab"][data-id="publish"]').click();await expect(page.locator('.canvas-main h2').filter({hasText:'MOA 开发模板'})).toHaveCount(1);await expect(page.locator('.canvas-main')).not.toContainText('i豆服务模板');
  await page.setViewportSize({width:390,height:844});await click('handoff');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await click('create-app');assert.equal(await page.evaluate(()=>document.querySelector('#dialog').scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  const checks=['MOA 模板与业务示例分离','自定义名称/目标创建空场景，无 i豆业务或假运行','显式选用 i豆示例并保留 MOA 来源与运行快照','旧草稿兼容、历史不变、平台发行与手机表单'];
  fs.writeFileSync(path.join(out,'template-result.json'),JSON.stringify({kind:'simulated-ui-check',checks,passed:checks.length,businessE2E:false},null,2));console.log(JSON.stringify({passed:checks.length,checks,output:out},null,2));
 }catch(e){await page.screenshot({path:path.join(out,'template-failure.png'),fullPage:true});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
