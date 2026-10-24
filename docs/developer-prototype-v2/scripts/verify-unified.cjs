const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const out=path.resolve(process.env.DEMO_CHECK_OUTPUT||'test-results/prototype-v2-unified/checks');
fs.mkdirSync(out,{recursive:true});
const key='openjiuwen-workbench-v2-demo-3';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DEMO_BROWSER_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(5000);
 const checks=[],errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
 const click=async(action,attrs='')=>{const sel=`[data-action="${action}"]${attrs}`;const modal=page.locator(`#dialog[open] ${sel}`);await(await modal.count()?modal:page.locator(sel+':visible')).first().click();};
 const dev=async id=>{await click('tab','[data-id="develop"]');await click('dev-section',`[data-id="${id}"]`);};
 const choose=async id=>{await click('capability-filter','[data-id="all"]');await click('select-capability',`[data-id="${id}"]`);};
 const create=async name=>{await click('create-app');await page.locator('#new-app-name').fill(name);await page.locator('#new-app-goal').fill('为员工查询 i豆并完成福利兑换');await click('create-confirm');};
 const shot=async name=>{await page.evaluate(()=>scrollTo(0,0));await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.screenshot({path:path.join(out,name+'.png')});};
 try{
  await page.goto(pathToFileURL(path.resolve(__dirname,'../开发工作台2.0.html')).href);await create('员工福利助手');await dev('capabilities');
  await expect(page.locator('[aria-label="开发内容"] button')).toHaveText(['应用设置','能力','编排','文件']);
  await expect(page.locator('.capability-row')).toHaveCount(0);
  await click('tab','[data-id="overview"]');await click('suggest','[data-kind="plan"]');await click('apply-proposal');await dev('capabilities');
  await expect(page.locator('.capability-row')).toHaveCount(5);await choose('builtin-skill');await expect(page.locator('.capability-detail')).toContainText('查询本人可用 i豆');
  await click('edit-business-skill');const original=await page.locator('#code-editor').inputValue();await page.locator('#code-editor').fill(original+'\n优先解释可兑换范围。\n');await click('save-code');await dev('capabilities');await choose('builtin-skill');await expect(page.locator('.capability-detail')).toContainText('优先解释可兑换范围');
  checks.push('开发有四个入口；预置 Skill 与四个工具在同一列表，编辑文件后详情同步');
  await click('add-capability');await click('choose-capability','[data-type="skill"]');await page.locator('#capability-name').fill('采购协同');await page.locator('#capability-purpose').fill('整理采购需求');await page.locator('#capability-content').fill('# 采购协同\n先明确预算。');await click('save-capability');
  await expect(page.locator('.capability-row')).toHaveCount(6);await expect(page.locator('.capability-detail')).toContainText('先明确预算');
  await click('capability-file','[data-id="cap-001"]');await page.locator('#code-editor').fill('# 采购协同\n先核对预算，再提交。');await click('save-code');await dev('capabilities');await choose('cap-001');await expect(page.locator('.capability-detail')).toContainText('先核对预算，再提交');
  await click('edit-capability','[data-id="cap-001"]');await expect(page.locator('#capability-content')).toHaveValue(/先核对预算，再提交/);await page.locator('#capability-content').fill('# 采购协同\n预算不足时返回原因。');await click('save-capability');await click('capability-file','[data-id="cap-001"]');await expect(page.locator('#code-editor')).toHaveValue(/预算不足时返回原因/);
  await dev('capabilities');await click('capability-filter','[data-id="skill"]');await expect(page.locator('.capability-row')).toHaveCount(2);
  await page.reload();await expect(page.locator('.capability-row')).toHaveCount(2);assert.equal((await state()).app.capabilityDrafts.length,1);
  checks.push('新增与预置能力统一筛选；草稿详情和文件双向同步，刷新保持选择与内容');
  await dev('settings');await expect(page.locator('.canvas-main')).toContainText('System Prompt');await page.locator('#app-instructions').fill('你是企业福利助手，先解释结果，再建议下一步。');await click('save-instructions');await click('instruction-file');await expect(page.locator('#code-editor')).toHaveValue('你是企业福利助手，先解释结果，再建议下一步。');
  await dev('settings');await page.locator('#connection').selectOption('mock');await click('save-connection');await dev('capabilities');await choose('query_balance');await expect(page.locator('.capability-detail')).toContainText('本地 Mock');
  checks.push('System Prompt 表单与文件一致；连接在应用设置中维护，工具详情引用同一连接');
  await click('add-capability');await click('choose-capability','[data-type="remote"]');await page.locator('#capability-name').fill('采购审批 Agent');await page.locator('#capability-purpose').fill('委派下游处理审批');await click('save-capability');
  const before=await state();await click('a2a-example');await expect(page.locator('[data-testid="a2a-state"]')).toHaveText('等待下游执行');await expect(page.locator('#dialog [data-action="a2a-step"][data-id="confirm"]')).toHaveCount(0);
  await click('a2a-step','[data-id="input"]');await expect(page.locator('[data-testid="a2a-state"]')).toHaveText('等待用户确认');await click('a2a-step','[data-id="confirm"]');await expect(page.locator('[data-testid="a2a-state"]')).toHaveText('等待下游执行');await expect(page.locator('#dialog')).toContainText('task-demo-B-001');await click('a2a-step','[data-id="complete"]');await expect(page.locator('[data-testid="a2a-state"]')).toHaveText('已完成');await shot('a2a-complete');await click('close');
  await click('a2a-example');await click('a2a-step','[data-id="failed"]');await expect(page.locator('[data-testid="a2a-state"]')).toHaveText('失败');await click('close');
  const after=await state();for(const field of ['app','runs','business','report','candidate'])assert.deepEqual(after[field],before[field]);
  checks.push('A2A 示例区分下游等待与用户确认，同任务续接；完成和失败均不生成真实运行或改变业务');
  await click('view','[data-id="apps"]');await create('另一个应用');await dev('capabilities');await expect(page.locator('.capability-row')).toHaveCount(0);await click('app-switcher');await click('switch-app','[data-id="app-001"]');await dev('capabilities');await choose('cap-001');await expect(page.locator('.capability-detail')).toContainText('预算不足时返回原因');
  const saved=await state(),legacy=structuredClone(saved);legacy.developSection='skills';const oldRuns=JSON.stringify(legacy.runs);await page.evaluate(({key,s})=>localStorage.setItem(key,JSON.stringify(s)),{key,s:legacy});await page.reload();await expect(page.locator('[aria-label="开发内容"] .active')).toHaveText('能力');await expect(page.locator('.capability-detail')).toContainText('优先解释可兑换范围');assert.equal(JSON.stringify((await state()).runs),oldRuns);
  checks.push('多应用相互隔离；旧六页签位置迁入新结构，保留历史快照');
  for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});await dev('capabilities');await choose('query_balance');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot('capabilities-'+width);
   await dev('settings');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot('settings-'+width);
  }
  await click('identity-switcher');await click('role','[data-role="platform"]');await click('platform-tab','[data-id="capabilities"]');await expect(page.locator('.canvas-main')).toContainText('模板开放的装配类型');await page.setViewportSize({width:1440,height:900});await shot('platform');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);checks.push('双角色 PC 布局检查；无横向溢出、外部请求或浏览器异常');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:checks.length,checks,errors,requests,simulation:true},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
 }catch(e){await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.message,checks,errors},null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
