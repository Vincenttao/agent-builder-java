const navigateDevelopment=require('./navigate-development.cjs');
const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.DEMO_CHECK_OUTPUT||'test-results/prototype-v2-multiapp/checks');
fs.mkdirSync(out,{recursive:true});
const key='openjiuwen-workbench-v2-demo-3';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DEMO_BROWSER_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(6000);
 const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 const click=async(a,attrs='')=>{if(a==='role')await page.locator('[data-action="identity-switcher"]').click();return page.locator(`[data-action="${a}"]${attrs}`).first().click();};
 const tab=id=>click('tab',`[data-id="${id}"]`),section=id=>navigateDevelopment(click,id);
 const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
 const close=()=>page.locator('#dialog [data-action="close"]').first().click();
 const create=async(name)=>{await click('create-app');await expect(page.locator('#dialog')).toContainText('MOA 开发模板');await page.locator('#new-app-name').fill(name);await page.locator('#new-app-goal').fill('为员工查询 i豆余额，提交兑换并核对结果');await click('create-confirm');await click('suggest','[data-kind="plan"]');await click('apply-proposal');return (await state()).activeAppId;};
 const switchApp=async(id)=>{await click('app-switcher');await click('switch-app',`[data-id="${id}"]`);};
 const bind=async()=>{await tab('develop');await section('connections');await page.locator('#connection').selectOption('mock');await click('save-connection');};
 try{
  await page.goto(pathToFileURL(path.join(root,'开发工作台2.0.html')).href);
  assert.equal((await state()).view,'apps','新用户应进入应用列表');await expect(page.locator('.sidebar nav')).toHaveText('应用');await expect(page.locator('.app-card')).toHaveCount(0);await expect(page.locator('.app-tabs')).toHaveCount(0);await expect(page.locator('#root')).not.toContainText('i豆');
  const a=await create('员工福利助手');await expect(page.locator('.sidebar [data-action="tab"]')).toHaveCount(0);await expect(page.locator('.app-tabs')).toContainText('概览开发测试运行记录版本与发布');
  const boxes=await page.locator('.app-tabs button').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})));assert.equal(new Set(boxes.map(b=>b.y)).size,1);assert.ok(boxes[1].x>boxes[0].x);
  await tab('develop');await expect(page.locator('.development-tabs')).toContainText('应用设置能力文件');await section('tools');await expect(page.locator('.capability-row')).toHaveCount(4);await section('skills');await expect(page.locator('.canvas-main')).toContainText('兑换前资格校验');
  checks.push('全局列表与应用横向导航分离，开发对象有明确名称及职责');
  await bind();await section('files');await click('file','[data-id="mapping"]');const original=await page.locator('#code-editor').inputValue();await page.locator('#code-editor').fill(original+'\n# 尚未完成');await page.locator('#agent-prompt').fill('下次继续适配余额接口');
  await click('view','[data-id="apps"]');await expect(page.locator('.copilot')).toHaveCount(0);const b=await create('另一团队福利助手');assert.notEqual(a,b);assert.equal(Object.keys((await state()).applications).length,2);
  await switchApp(a);await expect(page.locator('#code-editor')).toHaveValue(original+'\n# 尚未完成');await expect(page.locator('#agent-prompt')).toHaveValue('下次继续适配余额接口');await page.reload();await expect(page.locator('#code-editor')).toHaveValue(original+'\n# 尚未完成');await click('restore-code');
  await section('instructions');await page.locator('#app-instructions').fill('回答先给结论，说明当前查询结果');await page.reload();await expect(page.locator('#app-instructions')).toHaveValue('回答先给结论，说明当前查询结果');await click('save-instructions');const savedInstructions=(await state()).app.instructions;
  await section('skills');await page.locator('#max-quantity').selectOption('2');await switchApp(b);assert.equal((await state()).app.maxQuantity,1);await switchApp(a);await expect(page.locator('#max-quantity')).toHaveValue('2');await page.reload();assert.equal((await state()).app.maxQuantity,1);await click('save-rules');assert.equal((await state()).app.maxQuantity,2);
  await section('files');await click('file','[data-id="instructions"]');await expect(page.locator('#code-editor')).toHaveValue(savedInstructions);await switchApp(b);assert.notEqual((await state()).app.instructions,savedInstructions);
  checks.push('多应用创建不覆盖；代码与指令暂存、文件位置、Coding Agent 上下文分别恢复');
  await bind();await tab('debug');await click('run');assert.equal((await state()).business.balance,1280);const bRun=JSON.stringify((await state()).runs);
  await switchApp(a);await tab('debug');await click('preset-query','[data-query="redeem"]');await click('run');assert.ok((await state()).approval);await switchApp(b);assert.equal((await state()).approval,null);assert.equal((await state()).business.orders.length,0);
  await switchApp(a);await click('confirm');assert.equal((await state()).business.orders.length,1);assert.equal((await state()).business.balance,1080);await switchApp(b);assert.equal((await state()).business.balance,1280);assert.equal(JSON.stringify((await state()).runs),bRun);
  checks.push('待确认任务、运行、余额与订单按应用隔离，切换后续接原测试');
  await switchApp(a);await click('suggest','[data-kind="mapping"]');await click('apply-proposal');await click('test-mode','[data-id="checks"]');await click('test');await tab('delivery');await expect(page.locator('[data-action="test"]')).toHaveCount(0);await click('candidate');await click('ci');const aCandidate=JSON.stringify((await state()).candidate);
  await switchApp(b);assert.equal((await state()).report,null);assert.equal((await state()).candidate,null);assert.equal((await state()).delivery,null);await tab('delivery');await expect(page.locator('[data-action="ci"]')).toBeDisabled();await switchApp(a);assert.equal(JSON.stringify((await state()).candidate),aCandidate);
  await click('package');const event=page.waitForEvent('download');await click('download');const download=await event;await download.saveAs(path.join(out,'application-a-handoff.json'));assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(out,'application-a-handoff.json'))).candidate),aCandidate);await close();
  checks.push('检查在测试页，发布引用当前应用报告；候选、交接和下载不串应用');
  await click('role','[data-role="platform"]');await click('platform-tab','[data-id="diagnostics"]');await expect(page.locator('.canvas-main')).toContainText('员工福利助手');await expect(page.locator('.canvas-main')).toContainText('另一团队福利助手');
  await page.locator('#diagnostic-app').selectOption(b);await expect(page.locator('tbody')).not.toContainText('员工福利助手');await expect(page.locator('tbody')).toContainText('另一团队福利助手');const before=JSON.stringify(await state());await click('trace');await expect(page.locator('#dialog')).toContainText('另一团队福利助手');await click('replay-next');await close();assert.equal(JSON.stringify(await state()),before);
  await click('role','[data-role="scene"]');assert.equal((await state()).activeAppId,a);await expect(page.locator('.page-head h1')).toHaveText('员工福利助手');
  checks.push('平台跨应用诊断有来源与筛选，只读回放不切换或改写应用');
  await click('app-switcher');await page.locator('#app-search').fill('另一团队');await expect(page.locator('#dialog [data-action="switch-app"]:visible')).toHaveCount(1);await close();
  await page.setViewportSize({width:390,height:844});for(const id of ['overview','develop','debug','runs','delivery']){await tab(id);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,id);}
  await tab('develop');for(const id of ['instructions','skills','tools','connections','files']){await section(id);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,id);}
  await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});await click('view','[data-id="apps"]');await expect(page.locator('.app-card')).toHaveCount(2);await expect(page.locator('.app-tabs')).toHaveCount(0);await page.screenshot({path:path.join(out,'apps.png'),fullPage:true});
  checks.push('应用选择器可搜索，列表不带应用内导航，桌面与手机无溢出');
  // Compatibility fixture: strip the new registry from a populated schema-3 record.
  // Historical execution and delivery bytes must survive the single-app migration.
  const saved=await state(),legacy=structuredClone(saved);delete legacy.applications;delete legacy.activeAppId;delete legacy.applicationSequence;delete legacy.developSection;delete legacy.app.instructions;legacy.view='workspace';legacy.tab='extensions';legacy.file='mapping';
  legacy.editDrafts.scene={file:'mapping',value:legacy.app.script+'\n# 旧版未保存编辑',baseRevision:legacy.app.rev};
  const legacyRuns=JSON.stringify(legacy.runs),legacyCandidate=JSON.stringify(legacy.candidate),template=legacy.app.template;
  await page.evaluate(({key,s})=>localStorage.setItem(key,JSON.stringify(s)),{key,s:legacy});await page.reload();await expect(page.locator('.app-card')).toHaveCount(1);await click('resume-app');await expect(page.locator('#code-editor')).toHaveValue(legacy.editDrafts.scene.value);assert.equal((await state()).developSection,'files');assert.equal((await state()).app.template,template);assert.equal(JSON.stringify((await state()).runs),legacyRuns);assert.equal(JSON.stringify((await state()).candidate),legacyCandidate);
  checks.push('旧单应用数据迁入应用列表，未保存文件、运行和候选原样保留，不自动升级模板');
  await page.evaluate(({key,s})=>localStorage.setItem(key,JSON.stringify(s)),{key,s:saved});await page.reload();const firstTwo=JSON.stringify((await state()).applications);
  for(let n=3;n<=10;n++){await click('create-app');await page.locator('#new-app-name').fill(`容量检查 ${n}`);await page.locator('#new-app-goal').fill('暂存一个独立应用目标');await click('create-confirm');await click('view','[data-id="apps"]');}
  await expect(page.locator('.app-card')).toHaveCount(10);const full=JSON.stringify(await state());await click('create-app');await expect(page.locator('#toast')).toContainText('最多保留 10 个应用');await expect(page.locator('#dialog')).not.toBeVisible();assert.equal(JSON.stringify(await state()),full);const contexts=(await state()).applications;assert.equal(JSON.stringify({[a]:contexts[a],[b]:contexts[b]}),firstTwo);
  assert.deepEqual(errors,[]);checks.push('达到 10 个应用时明确阻止创建，不覆盖已有草稿或历史；无脚本异常');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({kind:'simulated-multiapp-navigation-check',checks,passed:checks.length,businessE2E:false},null,2));console.log(JSON.stringify({passed:checks.length,checks,output:out},null,2));
 }catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
