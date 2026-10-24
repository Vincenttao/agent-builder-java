const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const out=path.resolve(process.env.DEMO_CHECK_OUTPUT||'test-results/prototype-v2-orchestration/checks');
fs.mkdirSync(out,{recursive:true});
const key='openjiuwen-workbench-v2-demo-3';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.DEMO_BROWSER_PATH||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(5000);
 const checks=[],errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
 const click=async(action,attrs='')=>{const sel=`[data-action="${action}"]${attrs}`;const modal=page.locator(`#dialog[open] ${sel}`);await(await modal.count()?modal:page.locator(sel+':visible')).first().click();};
 const dev=async id=>{await click('tab','[data-id="develop"]');await click('dev-section',`[data-id="${id}"]`);};
 const section=async id=>{await dev('orchestration');await click('flow-section',`[data-id="${id}"]`);};
 try{
  await page.goto(pathToFileURL(path.resolve(__dirname,'../开发工作台2.0.html')).href);
  await click('create-app');await page.locator('#new-app-name').fill('员工福利助手');await page.locator('#new-app-goal').fill('为员工查询 i豆并完成福利兑换');await click('create-confirm');await dev('orchestration');
  await expect(page.locator('[aria-label="开发内容"] button')).toHaveText(['应用设置','能力','编排','文件']);
  await expect(page.locator('.flow-route')).toHaveCount(0);await expect(page.locator('.canvas-main')).not.toContainText('i豆服务');
  await click('tab','[data-id="overview"]');await click('suggest','[data-kind="plan"]');await click('apply-proposal');await section('routes');
  await expect(page.locator('.flow-route')).toHaveCount(1);
  checks.push('新应用从空编排开始；应用福利方案后才出现路由和 Skill 绑定');
  // Further assertions exercise the shared saved definition, not an alternate test-only model.
  await section('preview');await page.locator('#flow-query').fill('查询我的 i豆余额');const before=await state();await click('flow-preview');
  await expect(page.locator('.flow-preview')).toContainText('业务 Skill');await expect(page.locator('.flow-preview')).toContainText('提交兑换');
  const after=await state();for(const field of ['app','runs','business','report','candidate'])assert.deepEqual(after[field],before[field]);
  checks.push('请求预演读取同一编排定义；无模型、业务写入或运行记录副作用');
  await dev('settings');await page.locator('#connection').selectOption('mock');await click('save-connection');
  await click('suggest','[data-kind="mapping"]');await click('apply-proposal');
  await click('tab','[data-id="debug"]');await click('preset-query','[data-query="balance"]');await click('run');await click('test-mode','[data-id="checks"]');await click('test');
  assert.equal((await state()).report.passed,true);await click('tab','[data-id="delivery"]');await click('candidate');const baseline=await state();assert.ok(baseline.candidate);
  await section('routes');await click('flow-edit','[data-id="route-001"]');await click('flow-save');await section('process');await click('flow-save-process');assert.deepEqual((await state()).app,baseline.app);
  await section('preview');await click('flow-preview');await section('routes');await click('flow-edit','[data-id="route-001"]');
  await page.locator('#flow-name').fill('员工福利咨询');await page.locator('#flow-utterances').fill('查询我的 i豆余额\n查看福利权益');await click('flow-save');
  await section('preview');await expect(page.locator('.flow-preview')).toContainText('原预演已过期');await click('flow-preview');await expect(page.locator('.flow-preview')).toContainText('员工福利咨询');
  await section('process');const original=await page.locator('#flow-content').inputValue();await page.locator('#flow-content').fill(original+'\n只查询时以余额结果结束；兑换后以回执结果结束。');
  await expect(page.locator('[data-operation="redeem_gift"] [data-flow-confirm]')).toBeDisabled();await expect(page.locator('[data-operation="redeem_gift"] [data-flow-confirm]')).toBeChecked();
  await page.locator('[data-flow-allow="list_gifts"]').uncheck();await page.locator('[data-operation="redeem_gift"] [data-flow-condition]').fill('先核对库存和数量，再确认本次兑换参数');
  const revision=(await state()).app.rev;await page.locator('[data-operation="redeem_gift"] [data-flow-limit]').fill('0');await click('flow-save-process');assert.equal((await state()).app.rev,revision);
  await page.locator('[data-operation="redeem_gift"] [data-flow-limit]').fill('3');await click('flow-save-process');
  const saved=(await state()).app;assert.equal(saved.orchestration.skills['builtin-skill'].operations.length,3);assert.match(saved.businessSkill,/只查询时以余额结果结束/);
  await dev('files');await click('file','[data-id="flow-skills"]');await expect(page.locator('#code-editor')).toHaveAttribute('readonly','');assert.equal(JSON.parse(await page.locator('#code-editor').inputValue()).skills['builtin-skill'].operations.find(o=>o.capabilityId==='redeem_gift').maxCalls,3);
  await click('file','[data-id="business-skill"]');await expect(page.locator('#code-editor')).toHaveValue(/只查询时以余额结果结束/);
  await page.locator('#code-editor').fill(saved.businessSkill+'\n先说明业务范围。');await click('save-code');await section('process');await expect(page.locator('#flow-content')).toHaveValue(/先说明业务范围/);
  checks.push('路由和操作约束保存到同一修订；Skill 文件双向同步；模板固定确认不可关闭，非法调用上限不保存');
  await click('tab','[data-id="debug"]');await click('test-mode','[data-id="checks"]');await click('test');const changed=await state();assert.equal(changed.report.passed,false);assert.equal(changed.report.cases.find(c=>c.id==='orchestration').passed,false);assert.deepEqual(changed.candidate,baseline.candidate);assert.deepEqual(changed.runs,baseline.runs);
  await click('tab','[data-id="delivery"]');await expect(page.locator('[data-action="candidate"]')).toBeDisabled();await click('tab','[data-id="debug"]');await click('test-mode','[data-id="interactive"]');await expect(page.locator('.canvas-main')).toContainText('不验证新入口');
  checks.push('自定义编排使旧检查过期并阻止沿用 Mock 发布；旧候选与业务运行快照保持不变');
  await dev('capabilities');await click('add-capability');await click('choose-capability','[data-type="remote"]');await page.locator('#capability-name').fill('采购审批 Agent');await page.locator('#capability-purpose').fill('负责采购业务与审批');await click('save-capability');
  await section('routes');await click('flow-edit');await page.locator('#flow-name').fill('采购申请');await page.locator('#flow-intent').fill('purchase_request');await page.locator('#flow-target').selectOption('cap-001');await page.locator('#flow-keywords').fill('采购');await click('flow-save');
  await section('preview');await page.locator('#flow-query').fill('我要采购办公用品');await click('flow-preview');await expect(page.locator('.flow-preview')).toContainText('将完整任务委派给已绑定 A2A 服务');
  await page.locator('#flow-query').fill('查询天气');await click('flow-preview');await expect(page.locator('.flow-preview')).toContainText('没有匹配的入口');
  await page.locator('#flow-query').fill('采购 i豆礼品');await click('flow-preview');await expect(page.locator('.flow-preview')).toContainText('匹配到多个入口');await click('flow-choose','[data-id="route-002"]');await expect(page.locator('.flow-preview')).toContainText('采购审批 Agent');
  checks.push('A2A 与 Skill 路径区别可见；未匹配和多候选不伪造自动路由结果');
  await section('process');await page.locator('#flow-content').fill(saved.businessSkill+'\n尚未保存的业务说明。');await page.reload();await expect(page.locator('#flow-content')).toHaveValue(/尚未保存/);
  await click('identity-switcher');await click('role','[data-role="platform"]');await click('platform-tab','[data-id="capabilities"]');await page.locator('.flow-explanation summary').click();await expect(page.locator('.flow-responsibility')).toContainText('Rail');
  await click('identity-switcher');await click('role','[data-role="scene"]');await expect(page.locator('#flow-content')).toHaveValue(/尚未保存/);
  await click('view','[data-id="apps"]');await click('create-app');await page.locator('#new-app-name').fill('独立采购应用');await page.locator('#new-app-goal').fill('处理采购申请');await click('create-confirm');await section('routes');await expect(page.locator('.flow-route')).toHaveCount(0);
  await click('app-switcher');await click('switch-app','[data-id="app-001"]');await section('process');await expect(page.locator('#flow-content')).toHaveValue(/尚未保存/);
  await dev('settings');await page.locator('#app-instructions').fill('新的应用角色说明');await click('save-instructions');await section('process');const current=(await state()).app;await click('flow-save-process');assert.deepEqual((await state()).app,current);await expect(page.locator('#toast')).toContainText('配置暂存所基于的修订已变化');await click('discard-form','[data-id="flow"]');
  checks.push('未保存过程跨刷新、角色和应用切换保留；旧修订暂存不能覆盖新内容');
  await dev('capabilities');await click('select-capability','[data-id="cap-001"]');await click('remove-capability','[data-id="cap-001"]');await click('remove-capability-confirm','[data-id="cap-001"]');
  await section('preview');await page.locator('#flow-query').fill('采购办公用品');await click('flow-preview');await expect(page.locator('.flow-preview')).toContainText('目标能力已移除');await section('routes');await click('flow-edit','[data-id="route-002"]');await page.locator('#flow-target').selectOption('builtin-skill');await click('flow-save');
  await section('preview');await page.locator('#flow-query').fill('采购办公用品');await click('flow-preview');await expect(page.locator('.flow-preview')).toContainText('加载这份 Skill');
  await section('routes');await click('flow-remove','[data-id="route-002"]');await click('flow-remove-confirm','[data-id="route-002"]');await section('preview');await page.locator('#flow-query').fill('查询我的 i豆余额');await click('flow-preview');
  const contextual=(await state()).app;await click('flow-agent');await expect(page.locator('#agent-prompt')).toHaveValue(/编排设计需求/);await click('ask-agent');assert.deepEqual((await state()).app,contextual);
  checks.push('移除能力保留失效引用并要求修复；编排需求传给 Coding Agent，不伪造自由生成或修改');
  await section('process');await page.locator('[data-operation="redeem_gift"]').scrollIntoViewIfNeeded();await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.screenshot({path:path.join(out,'operation-constraints-1440.png')});
  await section('preview');await page.locator('.flow-choices').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'preview-path-1440.png')});
  for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});
   for(const id of ['routes','process','preview']){await section(id);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>scrollTo(0,0));await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.screenshot({path:path.join(out,`${id}-${width}.png`)});}
  }
  await page.setViewportSize({width:1280,height:800});await section('routes');await click('flow-edit','[data-id="route-001"]');const bounds=await page.locator('#dialog [data-action="flow-save"]').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=800);await page.screenshot({path:path.join(out,'route-dialog-1280.png')});await click('close');
  checks.push('PC 三种宽度无横向溢出；入口弹窗保存按钮可见');
  // A schema-3 application from before this feature has no definition; migration must be explicit.
  const legacy=await state();delete legacy.app.orchestration;const oldCandidate=structuredClone(legacy.candidate),oldRuns=structuredClone(legacy.runs);
  await page.evaluate(({key,s})=>localStorage.setItem(key,JSON.stringify(s)),{key,s:legacy});await page.reload();await section('routes');await expect(page.locator('.flow-route')).toHaveCount(0);assert.equal((await state()).app.orchestration,undefined);
  await click('suggest','[data-kind="orchestration"]');await click('review-proposal');await expect(page.locator('#dialog')).toContainText('employee_benefits');await click('apply-proposal');await expect(page.locator('.flow-route')).toHaveCount(1);assert.deepEqual((await state()).candidate,oldCandidate);assert.deepEqual((await state()).runs,oldRuns);
  checks.push('旧应用不静默迁入编排；审阅建议后显式补齐，历史候选和运行不变');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:checks.length,checks,errors,requests,simulation:true},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
 }catch(e){await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.message,checks,errors},null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
