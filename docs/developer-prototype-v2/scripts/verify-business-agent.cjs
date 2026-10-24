const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const out=path.resolve(process.env.DEMO_CHECK_OUTPUT||'test-results/prototype-v2-business-agent/checks');
fs.mkdirSync(out,{recursive:true});
const artifact=path.resolve(__dirname,'../开发工作台2.0.html');
const artifactSha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
const key='openjiuwen-workbench-v2-demo-3';
(async()=>{
 const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(5000);
 const checks=[],errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
 const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);
 const click=async(action,attrs='')=>{const s=`[data-action="${action}"]${attrs}`;const m=page.locator(`#dialog[open] ${s}`);await(await m.count()?m:page.locator(s+':visible')).first().click();};
 const section=async id=>{await click('tab','[data-id="develop"]');await click('dev-section','[data-id="orchestration"]');await click('flow-section',`[data-id="${id}"]`);};
 try{
  await page.goto(pathToFileURL(path.resolve(__dirname,'../开发工作台2.0.html')).href);
  await click('create-app');await page.locator('#new-app-name').fill('员工福利助手');await page.locator('#new-app-goal').fill('查询 i豆并办理兑换');await click('create-confirm');
  await section('routes');await expect(page.locator('[aria-label="编排内容"]')).toContainText('业务范围与转交');await expect(page.locator('.canvas-main')).not.toContainText('入口与路由');
  checks.push('应用编排面向下层业务 Agent，空应用没有预置福利职责');
  await click('tab','[data-id="overview"]');await click('suggest','[data-kind="plan"]');await click('apply-proposal');await section('routes');
  await expect(page.locator('#scope-description')).toHaveValue(/员工福利/);await expect(page.locator('.flow-route')).toContainText('自己处理');
  const initial=await state();await click('scope-save');assert.deepEqual((await state()).app,initial.app);
  const preview=async(query,context='new')=>{await section('preview');await page.locator('#flow-context').selectOption(context);await page.locator('#flow-query').fill(query);await click('flow-preview');};
  await preview('查询我的 i豆余额');await expect(page.locator('.flow-preview')).toContainText('自己处理');await expect(page.locator('.flow-preview')).toContainText('加载这份 Skill');
  await preview('确认','confirmation');await expect(page.locator('[data-outcome="continue"]')).toContainText('核对任务、操作与参数版本');
  await preview('数量是1件','information');await expect(page.locator('[data-outcome="continue"]')).toContainText('补充信息任务');
  await preview('确认','new');await expect(page.locator('[data-outcome="clarify"]')).toContainText('需要澄清');
  await preview('先查兑换记录','confirmation');await expect(page.locator('.flow-preview')).toContainText('先由当前业务 Agent 判断');await expect(page.locator('.flow-preview')).toContainText('自己处理');
  await preview('帮我报销差旅费','confirmation');await expect(page.locator('[data-outcome="return"]')).toContainText('不是新发起一次反向 A2A');await expect(page.locator('[data-outcome="return"]')).toContainText('没有自动恢复');
  await preview('查询我的 i豆余额');await page.locator('#flow-context').selectOption('information');await expect(page.locator('.flow-preview')).toContainText('原预演已过期');
  await preview('查询天气');await expect(page.locator('[data-outcome="clarify"]')).toContainText('未命中本地示例不等于超出范围');
  const after=await state();for(const field of ['app','runs','business','report','candidate'])assert.deepEqual(after[field],initial[field]);
  await page.locator('#flow-query').fill('确认');await expect(page.locator('.flow-preview')).toContainText('请重新预演');
  checks.push('首次/后续消息覆盖自行处理、补充、确认、同域变更、范围外返回及澄清；不改变业务、运行、候选');
  await section('routes');await page.locator('#scope-description').fill(initial.app.orchestration.businessScope.description+' 不提供财务报销。');await page.reload();await expect(page.locator('#scope-description')).toHaveValue(/不提供财务报销/);
  await click('identity-switcher');await click('role','[data-role="platform"]');await click('platform-tab','[data-id="capabilities"]');await page.locator('.flow-explanation summary').click();await expect(page.locator('.flow-explanation')).toContainText('上级 MOA');await expect(page.locator('.flow-explanation')).toContainText('待模板适配');await page.screenshot({path:path.join(out,'platform-boundary-1440.png'),fullPage:true});
  await click('identity-switcher');await click('role','[data-role="scene"]');await expect(page.locator('#scope-description')).toHaveValue(/不提供财务报销/);
  await click('view','[data-id="apps"]');await click('create-app');await page.locator('#new-app-name').fill('采购应用');await page.locator('#new-app-goal').fill('企业采购');await click('create-confirm');await section('routes');await expect(page.locator('#scope-description')).toHaveValue('');
  await click('app-switcher');await click('switch-app','[data-id="app-001"]');await section('routes');await expect(page.locator('#scope-description')).toHaveValue(/不提供财务报销/);await click('scope-save');
  assert.equal((await state()).app.rev,initial.app.rev+1);await click('flow-agent');await expect(page.locator('#agent-prompt')).toHaveValue(/业务范围：.*不提供财务报销/);await expect(page.locator('#agent-prompt')).toHaveValue(/Native Skill 衔接缺口/);
  await section('routes');await page.locator('#scope-outside').fill('帮我报销差旅费\n查询我的 i豆余额');await click('scope-save');await preview('查询我的 i豆余额');await expect(page.locator('[data-outcome="conflict"]')).toBeVisible();
  await section('routes');await page.locator('#scope-outside').fill('帮我报销差旅费');await click('scope-save');
  checks.push('业务范围暂存跨刷新/角色/应用保留，显式保存增加修订；范围内外冲突阻止预演自动选择');
  await page.locator('#scope-description').fill('未保存的范围修改');await click('dev-section','[data-id="settings"]');await page.locator('#app-instructions').fill('新的福利助手说明');await click('save-instructions');await section('routes');const current=(await state()).app;await click('scope-save');assert.deepEqual((await state()).app,current);await expect(page.locator('#toast')).toContainText('修订已变化');await click('discard-form','[data-id="boundary"]');
  await click('dev-section','[data-id="files"]');await click('file','[data-id="flow-routes"]');const projection=JSON.parse(await page.locator('#code-editor').inputValue());assert.equal(projection.layer,'business-agent');assert.equal(projection.runnable,false);assert.equal(projection.businessScope.description,current.orchestration.businessScope.description);
  checks.push('范围草稿拒绝跨修订覆盖；文件投影含下层业务对象及范围定义，不冒充原生运行配置');
  await click('dev-section','[data-id="capabilities"]');await click('add-capability');await click('choose-capability','[data-type="remote"]');await page.locator('#capability-name').fill('采购 Agent');await page.locator('#capability-purpose').fill('完成采购申请');await click('save-capability');
  await section('routes');await click('flow-edit');await expect(page.locator('#flow-intent')).toHaveCount(0);await page.locator('#flow-name').fill('采购申请');await page.locator('#flow-target').selectOption('cap-001');await page.locator('#flow-utterances').fill('帮我采购电脑');await page.locator('#flow-keywords').fill('采购');await click('flow-save');
  await preview('帮我采购电脑');await expect(page.locator('[data-outcome="configuration-error"]')).toContainText('服务标识未配置');
  await click('dev-section','[data-id="capabilities"]');await click('select-capability','[data-id="cap-001"]');await click('edit-capability','[data-id="cap-001"]');await page.locator('#capability-target').fill('purchase-agent');await click('save-capability');
  await preview('帮我采购电脑');await expect(page.locator('.flow-preview')).toContainText('委派处理');await expect(page.locator('.flow-preview')).toContainText('purchase-agent');
  await click('dev-section','[data-id="capabilities"]');await click('select-capability','[data-id="cap-001"]');await click('remove-capability','[data-id="cap-001"]');await click('remove-capability-confirm','[data-id="cap-001"]');await preview('帮我采购电脑');await expect(page.locator('[data-outcome="configuration-error"]')).toContainText('目标能力已移除');
  checks.push('挂载 Agent 承接业务；无需手填上级意图；缺服务标识或失效引用报错，不能伪装为向上返回');
  await section('routes');await click('flow-remove','[data-id="route-002"]');await click('flow-remove-confirm','[data-id="route-002"]');
  const legacy=await state();delete legacy.app.orchestration.businessScope;const snapshots={runs:legacy.runs,candidate:legacy.candidate};await page.evaluate(({key,s})=>localStorage.setItem(key,JSON.stringify(s)),{key,s:legacy});await page.reload();await section('routes');await expect(page.locator('.canvas-main')).toContainText('旧版编排');assert.equal((await state()).app.orchestration.businessScope,undefined);await preview('查询我的 i豆余额');await expect(page.locator('[data-outcome="unconfigured"]')).toBeVisible();
  await section('routes');await page.locator('#scope-description').fill('员工福利查询与兑换');await page.locator('#scope-outside').fill('帮我报销差旅费');await click('scope-save');assert.equal((await state()).app.orchestration.routes.length,1);assert.deepEqual((await state()).runs,snapshots.runs);assert.deepEqual((await state()).candidate,snapshots.candidate);
  await click('tab','[data-id="debug"]');await click('test-mode','[data-id="checks"]');await click('test');assert.equal((await state()).report.cases.find(c=>c.id==='orchestration').passed,false);
  checks.push('旧版绑定显式补范围后启用；不改历史快照；自定义范围不能借用固定 Mock 报告通过');
  await preview('帮我报销差旅费','confirmation');
  for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});for(const id of ['routes','process','preview']){await section(id);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>scrollTo(0,0));await expect(page.locator('#toast')).not.toHaveClass(/visible/);await page.screenshot({path:path.join(out,`${id}-${width}.png`)});}
  }
  await page.setViewportSize({width:1440,height:900});await section('routes');await page.locator('#scope-description').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'scope-form-1440.png')});await page.locator('.flow-route').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'business-division-1440.png')});
  await section('preview');await page.locator('.flow-preview').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'return-to-caller-1440.png')});await section('process');await page.locator('[data-operation="redeem_gift"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'operation-rules-1440.png')});
  checks.push('PC 1280/1440/1920 三视图无页面横向溢出，保存浏览器截图供人工核查');

  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:checks.length,checks,errors,requests,simulation:true,artifactSha256},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
 }catch(e){await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.message,checks,errors},null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
