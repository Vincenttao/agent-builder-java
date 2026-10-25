import {buildReuse} from './fixtures/build-reuse.js';
// Opt-in real browser -> OpenCode -> Git -> Maven/Java -> model -> export acceptance.
import assert from 'node:assert/strict';
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalJavaEngine } from '../workbench-server/local-java.js';
import { createWorkbench } from '../workbench-server/app.js';
import { deepAgentTemplateFiles } from '../workbench-server/template.js';
import { readTree } from '../workbench-server/files.js';
import { createBusinessMock } from '../mock-business/server.js';
import { settings } from '../workbench-server/settings.js';
import {verifyStandaloneBusiness} from './fixtures/standalone-business.js';
assert.equal(process.env.WORKBENCH_E2E_LIVE, '1', 'Explicit opt-in required');
const repository = process.cwd(), config = settings(repository);
assert.equal(new URL(config.baseUrl).hostname, 'api.deepseek.com');
assert.ok(config.apiKey);
const gaps=process.env.WORKBENCH_E2E_GAPS==='1',series=gaps?'gap-e2e-':'workbench-e2e-';
const parent = resolve('.workbench/verification');
mkdirSync(parent, { recursive: true });
const prior = process.env.WORKBENCH_E2E_PRIOR_REPORT ? JSON.parse(readFileSync(resolve(process.env.WORKBENCH_E2E_PRIOR_REPORT), 'utf8')) : null;
if (!prior)
    assert.ok(readdirSync(parent).filter(n => n.startsWith(series)).length < 2, 'Review existing owned E2E workspaces first');
const stamp = new Date().toISOString().replace(/[:.]/g, '-'), root = prior ? resolve(prior.root) : join(parent,series+stamp), out = resolve(gaps?'test-results/gap-e2e-20261026':'test-results/workbench-e2e-20261025', (prior ? 'resume-' : '') + stamp);
assert.ok(root.startsWith(parent + '/'+series));
mkdirSync(out, { recursive: true });
const safe = (v: unknown) => (JSON.stringify(v, null, 2) ?? 'null').split(config.apiKey).join('[REDACTED]').replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED]') + '\n';
const report: any = { ...(prior ?? {}), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), root, out, mode: 'real OpenCode + local Java + deepseek-flash + isolated Mock', startedAt: new Date().toISOString(), cases: prior?.cases ?? [], jobs: prior?.jobs ?? [], runs: prior?.runs ?? [], screens: prior?.screens ?? [], pageErrors: prior?.pageErrors ?? [], networkErrors: prior?.networkErrors ?? [], mutations: prior?.mutations ?? [], repairs: prior?.repairs ?? [] };
if (prior) {
    if(prior.sourceHead!==report.sourceHead)assert.ok(prior.productIdentity,'Previous report has no product content identity; cannot reuse across source revisions');
    report.priorReport = process.env.WORKBENCH_E2E_PRIOR_REPORT;
    report.priorFailure = prior.error;
    report.status = 'resuming';
    delete report.error;
}
report.runnerSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
report.workingDiffSha256 = createHash('sha256').update(execFileSync('git', ['diff', '--', 'workbench-server', 'workbench-ui'])).digest('hex');
const productFiles:Record<string,string>={};for(const folder of ['workbench-server','workbench-ui','templates','runtime-template-java/src','runtime-deepagent-java/src','mock-business','examples'])for(const [name,source] of Object.entries(readTree(folder)))productFiles[folder+'/'+name]=createHash('sha256').update(source).digest('hex');for(const name of ['runtime-template-java/pom.xml','runtime-deepagent-java/pom.xml'])productFiles[name]=createHash('sha256').update(readFileSync(name)).digest('hex');report.productFiles=productFiles;report.productIdentity=createHash('sha256').update(JSON.stringify(Object.entries(productFiles).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');if(prior?.productIdentity&&prior.productIdentity!==report.productIdentity){const changed=[...new Set([...Object.keys(prior.productFiles??{}),...Object.keys(productFiles)])].filter(p=>prior.productFiles?.[p]!==productFiles[p]).sort();const diagnosis=prior.jobs.find((j:any)=>j.id===process.env.WORKBENCH_E2E_REPAIR_DIAGNOSIS&&j.purpose==='consistency'&&j.status==='analysed'&&j.analysis?.verdict==='needs-clarification');if(changed.length===1&&changed[0]==='workbench-server/consistency.ts'){assert.ok(diagnosis&&prior.status==='failed','Changed diagnostic inputs require a named original clarification and terminal failed process');report.compatibilityReuse={sourceIdentity:prior.productIdentity,targetIdentity:report.productIdentity,changed,reason:'Only diagnostic blocking criteria refined; generation engine, templates, Java, business assets and independent assertions unchanged. Original failed diagnosis retained; its repair/recheck is executed again.'};}else{if(process.env.WORKBENCH_E2E_DEEP_ONLY==='1'){assert.deepEqual(changed,['runtime-deepagent-java/src/main/java/com/openjiuwen/workbench/deep/DeepFactory.java','templates/deepagent/RUNTIME.md']);assert.equal(prior.status,'passed-live-flow');report.compatibilityReuse={sourceIdentity:prior.productIdentity,targetIdentity:report.productIdentity,changed,reason:'Deep-only bounded iteration/completion fix: original MOA definitions, engine, assertions and artifacts unchanged. Deep template, application, tests and candidate are newly executed; old Deep candidate retained as historical.'};}else{assert.equal(process.env.WORKBENCH_E2E_CONTINUE_WEALTH,'1');assert.deepEqual(changed,['examples/commerce-wealth/tests/business-cases.json','examples/idou/tests/business-cases.json','workbench-server/business-tests.ts']);const failed=prior.businessTests?.find((r:any)=>r.status==='failed'&&String(r.error).startsWith('TASK_NOT_CURRENT:'));assert.ok(failed&&failed.cases.filter((c:any)=>c.after).every((c:any)=>c.after.writes===0&&c.after.transferWrites===0&&c.after.purchaseWrites===0),'Refusal-code correction may resume only the failed zero-write suite');report.compatibilityReuse={sourceIdentity:prior.productIdentity,targetIdentity:report.productIdentity,changed,reason:'Accept actual Java TASK_NOT_CURRENT refusal for an ended task; all rejection/status/zero-write assertions retained. Failed suite is rerun on fresh owned Mock; completed Deep and readonly scenarios unchanged.'};}}}else if(prior?.productIdentity)report.compatibilityReuse={sourceIdentity:prior.productIdentity,targetIdentity:report.productIdentity,changed:[],reason:'Exact product content identity; no evidence relabelled as newly executed'};

const save = () => writeFileSync(join(out, 'report.json'), safe(report));
function progress(stage: string) { report.stage = stage; save(); console.log(safe({ stage, root, out })); }
function passed(id: string, evidence: unknown) { const item = { id, status: id === 'E2E-02' && report.repairs.length ? 'passed_after_fix' : 'passed', evidence }; const index = report.cases.findIndex((c: any) => c.id === id); if (index < 0)
    report.cases.push(item);
else
    report.cases[index] = item; save(); }
const native = new LocalJavaEngine(repository);
const reused = new Set<string>();
const runEngine = { kind: native.kind,configure:(directory:string)=>native.configure(directory), async build(input: Parameters<LocalJavaEngine['build']>[0]) { for (const candidate of prior?.runs ?? []) {
        if (!candidate.artifact || reused.has(candidate.id))
            continue;
        const source = JSON.parse(readFileSync(join(root, 'runs', candidate.id, 'source.json'), 'utf8'));
        const currentFiles=readTree(input.directory),currentHashes=Object.fromEntries(Object.entries(currentFiles).map(([p,text])=>[p,createHash('sha256').update(text).digest('hex')])),knownPom=['runtime-template-java/pom.xml','runtime-deepagent-java/pom.xml'].some(p=>readFileSync(p,'utf8')===currentFiles['pom.xml']),reuse=buildReuse(currentHashes,source.files,knownPom);
        if(!reuse)continue;
        const original = join(root, 'runs', candidate.id, candidate.artifact.path);
        assert.equal(createHash('sha256').update(readFileSync(original)).digest('hex'), candidate.artifact.sha256);
        const target = join(input.directory, 'target');
        mkdirSync(target, { recursive: true });
        const jar = join(target, 'application.jar');
        copyFileSync(original, jar);
        assert.equal(createHash('sha256').update(readFileSync(jar)).digest('hex'), candidate.artifact.sha256);
        reused.add(candidate.id);
        report.reusedBuilds ??= [];
        report.reusedBuilds.push({sourceRunId:candidate.id,head:source.head,sha256:candidate.artifact.sha256,scope:reuse.scope,verifiedBuildInputs:reuse.verified.length,externalAssetsFixedAtCurrentRun:reuse.externalAssets});
        save();
        input.onLog('Verification-only reuse of tested Maven output: '+reuse.scope+'; source/code/resources/fixtures and JAR digest verified against '+candidate.id+'. External assets are fixed to the new run source; this is not a new Maven execution.');
        return { jar };
    } return native.build(input); }, start: native.start.bind(native) };
const wb = createWorkbench({ root, runEngine }), server = wb.app.listen(0, '127.0.0.1'), mock = createBusinessMock().listen(prior ? Number(new URL(prior.mockBase).port) : 0, '127.0.0.1');
await Promise.all([new Promise<void>(r => server.once('listening', r)), new Promise<void>(r => mock.once('listening', r))]);
const address = server.address(), mockAddress = mock.address();
assert.ok(address && typeof address !== 'string' && mockAddress && typeof mockAddress !== 'string');
const base = 'http://127.0.0.1:' + address.port, mockBase = 'http://127.0.0.1:' + mockAddress.port;
report.base = base;
report.mockBase = mockBase;
const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(12000);
function responseFor(predicate:Parameters<Page['waitForResponse']>[0]){const pending=page.waitForResponse(predicate);void pending.catch(()=>{});return pending;}

page.on('pageerror', e => { report.pageErrors.push({ stage: report.stage, message: e.message }); save(); });
page.on('response', r => { if (r.status() >= 500) {
    report.networkErrors.push({ stage: report.stage, status: r.status(), url: r.url() });
    save();
} });
page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method()) && r.url().includes('/api/'))
    report.mutations.push({ method: r.method(), path: new URL(r.url()).pathname }); });
async function api(path: string, role = 'application', method = 'GET', body?: unknown) { const r = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', 'x-workbench-role': role }, body: body === undefined ? undefined : JSON.stringify(body) }); const value = r.status === 204 ? null : await r.json() as any; assert.ok(r.ok, safe({ path, status: r.status, error: value?.error })); return value; }
async function role(value: string) { if (await page.locator('#identity').inputValue() !== value) {
    await page.locator('#identity').selectOption(value);
    await page.getByRole('heading', { name: value === 'platform' ? '开发模板与应用诊断' : '我的应用', exact: true }).waitFor();
} }
async function home() { await page.locator('#global-nav [data-action=home]').click(); }
async function open(id: string, actor: string) { await role(actor); await home(); await page.locator(`[data-open="${id}"]`).click(); await page.locator('.project-title h1').waitFor(); }
async function tab(id: string) { if (['configuration', 'capabilities', 'flow', 'files', 'coding','revisions'].includes(id))
    await page.locator('.app-tabs [data-tab=configuration]').click(); if (['checks','runs','business-tests','consistency'].includes(id))
    await page.locator('.app-tabs [data-tab=checks]').click(); await page.locator('#workspace [data-tab="' + id + '"]').first().click(); }
async function capture(name: string) { for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const metric = await page.evaluate(() => ({ documentOverflow: document.documentElement.scrollWidth > innerWidth, panels: [...document.querySelectorAll('.canvas-main,.copilot')].map(e => ({ className: e.className, width: e.clientWidth, scroll: e.scrollWidth })), text: document.body.innerText }));
    assert.equal(metric.documentOverflow, false, name + ' document overflow ' + width);
    assert.equal(metric.text.includes(config.apiKey), false);
    for (const p of metric.panels)
        assert.ok(p.scroll <= p.width + 2, name + ' panel overflow ' + width + ' ' + p.className);
    const path = join(out, name + '-' + width + '.png');
    await page.screenshot({ path });
    report.screens.push({ name, width, path });
} await page.setViewportSize({ width: 1440, height: 1000 }); save(); }
async function publish(version: string) { const projectId = await page.locator('#project-switch').inputValue(); const existing = (await api('/templates', 'platform')).releases.find((r: any) => r.projectId === projectId && r.version === version); if (existing)
    return existing; await page.getByRole('button',{name:'测试',exact:true}).click(); await page.getByRole('button',{name:'检查保存版本',exact:true}).click(); await page.getByText('结构检查通过；业务未验证',{exact:false}).waitFor(); await page.locator('.app-tabs [data-tab=release]').click(); await page.getByLabel('版本号', { exact: true }).fill(version); const response = responseFor(r => r.request().method() === 'POST' && r.url().includes('/releases')); await page.getByRole('button', { name: '发行模板', exact: true }).click(); const r = await response; assert.equal(r.status(), 201); return (await r.json()).release; }
async function create(releaseId: string, name: string) { const existing = (await api('/projects')).projects.find((p: any) => p.name === name); if (existing) {
    assert.equal(existing.sourceReleaseId, releaseId);
    await open(existing.id, 'application');
    return existing;
} await role('application'); await home(); await page.getByLabel('应用名称', { exact: true }).fill(name); await page.getByLabel('模板版本', { exact: true }).selectOption(releaseId); const response = responseFor(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/projects'); await page.getByRole('button', { name: '创建应用', exact: true }).click(); const value = await (await response).json(); await page.getByRole('heading', { name, exact: true }).waitFor(); return (await api('/projects/' + value.project.id)).project; }
async function coding(projectId: string, actor: string, prompt: string, label: string) {
    const earlier = prior?.jobs?.find((j: any) => j.label === label && j.projectId===projectId && j.id);
    if (earlier) {
        const job = (await api('/jobs/' + earlier.id, actor)).job;
        assert.equal(job.status, 'applied');
        const baseline = wb.store.snapshot(projectId, job.baseHead);
        let after = await api('/projects/' + projectId, actor);
        if (label === 'platform-coding' && after.files['.opencode/.gitignore'] !== undefined) {
            assert.equal(after.project.head, job.appliedHead);
            assert.equal(after.files['.opencode/.gitignore'], 'node_modules\npackage.json\npackage-lock.json\nbun.lock\n.gitignore');
            const fromHead = after.project.head;
            await api('/projects/' + projectId + '/files', actor, 'PUT', { baseHead: fromHead, changes: { '.opencode/.gitignore': null } });
            after = await api('/projects/' + projectId, actor);
            report.repairs.push({ kind: 'remove verified auto-generated cache file from failed prior platform delivery', originalJobId: job.id, fromHead, toHead: after.project.head, changes: { '.opencode/.gitignore': null } });
            save();
        }
        if (label === 'platform-coding') {
            const evaluated = prior?.cases?.find((c: any) => c.id === 'E2E-02')?.evidence.head;
            if (evaluated && evaluated !== after.project.head) {
                const evaluatedFiles = wb.store.snapshot(projectId, evaluated);
                after = { ...after, project: { ...after.project, head: evaluated }, files: evaluatedFiles, definition: JSON.parse(evaluatedFiles['application.json']) };
            }
        }
        const finalChanges = Object.fromEntries([...new Set([...Object.keys(baseline), ...Object.keys(after.files)])].filter(n => baseline[n] !== after.files[n]).map(n => [n, after.files[n] ?? null]));
        await tab('coding');
        await page.locator('[data-coding-job="' + job.id + '"]').click();
        await capture(label + '-after-cache-fix');
        return { job, before: { project: { head: job.baseHead }, files: baseline }, after, finalChanges };
    }
    progress(label + ': generating');
    const before = await api('/projects/' + projectId, actor);
    await page.getByLabel('开发需求', { exact: true }).fill(prompt);
    const response = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/projects/' + projectId + '/jobs'));
    await page.getByRole('button', { name: '生成修改建议', exact: true }).click();
    const r = await response;
    assert.equal(r.status(), 202);
    const started = (await r.json()).job;
    let job: any;
    let answered = '';
    for (let n = 0; n < 600; n++) {
        job = (await api('/jobs/' + started.id, actor)).job;
        if (job.status === 'awaiting_review')
            break;
        if (['failed', 'cancelled'].includes(job.status))
            throw Error(label + ' ' + safe(job.error ?? job.status));
        if (job.status === 'awaiting_input' && job.pendingQuestion.id !== answered) {
            report.jobs.push({ id: job.id, interaction: 'question', question: job.pendingQuestion });
            save();
            await page.locator('#coding-answer').waitFor();
            for (let i = 0; i < job.pendingQuestion.questions.length; i++)
                await page.locator('#coding-answer-' + i).fill('使用开发需求中已明确的范围与工具，请直接按其验收要求完成；不增加业务或放宽权限。');
            await page.getByRole('button', { name: '回答原问题', exact: true }).click();
            answered = job.pendingQuestion.id;
        }
        if (n % 10 === 0) {
            report.activeJob = { id: job.id, status: job.status, eventCount: job.events.length };
            save();
        }
        await delay(1000);
    }
    assert.equal(job.status, 'awaiting_review', label + ' original job has not completed');
    assert.equal(job.engineKind, 'opencode');
    const expectedSkill = (before.project.family ?? 'moa') + '-' + (actor === 'platform' ? 'platform' : 'application') + '-development';
    assert.ok(job.evidence.some((e: any) => e.tool === 'skill' && e.status === 'completed' && e.input?.name === expectedSkill));
    const review = await api('/jobs/' + job.id + '/review', actor);
    assert.equal(review.stale, false);
    assert.equal((await api('/projects/' + projectId, actor)).project.head, before.project.head);
    assert.ok(Object.keys(job.changes).length);
    report.jobs.push({ label, ...job, reviewBase: before.project.head });
    save();
    await page.getByRole('button', { name: '应用全部差异', exact: true }).waitFor();
    await page.getByLabel('选择差异文件', { exact: true }).selectOption(Object.keys(job.changes)[0]);
    await capture(label + '-review');
    const apply = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/jobs/' + job.id + '/apply'));
    await page.getByRole('button', { name: '应用全部差异', exact: true }).click();
    assert.equal((await apply).status(), 200);
    const after = await api('/projects/' + projectId, actor);
    for (const [name, text] of Object.entries(job.changes))
        assert.equal(after.files[name] ?? null, text);
    return { job, before, after, finalChanges: job.changes };
}
async function startRun(projectId: string) { await tab('runs'); const response = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/projects/' + projectId + '/runs')); await page.getByRole('button', { name: '构建并启动保存版本', exact: true }).click(); const r = await response; assert.equal(r.status(), 202); const id = (await r.json()).run.id; let run: any; for (let n = 0; n < 240; n++) {
    run = (await api('/runs/' + id)).run;
    if (run.status === 'running' || run.status === 'failed')
        break;
    if (n % 10 === 0) {
        report.activeRun = { id, status: run.status, logs: run.logs.slice(-5) };
        save();
    }
    await delay(1000);
} report.runs.push(run); save(); assert.equal(run.status, 'running', safe(run.error)); assert.equal(run.engine, 'local-java'); await page.getByRole('heading', { name: '运行中', exact: true }).waitFor(); return run; }
async function message(runId: string, text: string) { await page.getByLabel('新需求或澄清补充', { exact: true }).fill(text); const response = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/runs/' + runId + '/messages')); await page.getByRole('button', { name: '发送新需求', exact: true }).click(); const r = await response; const body = await r.json(); assert.equal(r.status(), 200, safe(body)); writeFileSync(join(out, 'view-' + runId + '-' + body.events.length + '.json'), safe(body)); return body; }
async function stopRun() { const dialog = page.waitForEvent('dialog'); const response = responseFor(r => r.request().method() === 'POST' && /\/runs\/[^/]+\/stop$/.test(new URL(r.url()).pathname)); const clicked = page.getByRole('button', { name: '停止原运行', exact: true }).click(); const confirmation = await dialog; assert.equal(confirmation.type(), 'confirm'); assert.match(confirmation.message(), /停止原运行/); await confirmation.accept(); await clicked; assert.equal((await response).status(), 200); await page.getByRole('heading', { name: '已停止', exact: true }).waitFor({ timeout: 60000 }); }
async function exportRun(projectId: string, run: any) { await tab('delivery'); await page.getByLabel('交付来源运行', { exact: true }).selectOption(run.id); const response = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/projects/' + projectId + '/exports')); await page.getByRole('button', { name: '导出所选运行', exact: true }).click(); const r = await response; assert.ok([200, 201].includes(r.status())); const record = (await r.json()).export; assert.equal(record.head, run.head); for (const kind of ['application', 'source']) {
    const file = await fetch(base + '/api/exports/' + record.id + '/files/' + kind);
    assert.ok(file.ok);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.artifacts[kind].sha256);
    const archive = join(out, record.id + '-' + kind + '.tar.gz');
    writeFileSync(archive, bytes);
    const unpack = join(out, 'unpack-' + record.id + '-' + kind);
    mkdirSync(unpack);
    execFileSync('tar', ['-xzf', archive, '-C', unpack]);
    execFileSync('sh', [join(unpack, kind, 'verify.sh')]);
    const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    assert.equal(/(?:^|\/)(?:\.env(?:\.[^\/\n]+)?|index\.sqlite|brief\.md|events\.jsonl|\.opencode)(?:\/|$)/m.test(names), false);
    const sample = readFileSync(join(unpack, kind, 'runtime.env.example'), 'utf8');
    assert.equal(sample.includes(config.apiKey), false);
    const manifest = JSON.parse(readFileSync(join(unpack, kind, 'manifest.json'), 'utf8'));
    assert.equal(manifest.sourceHead, run.head);
    assert.equal(manifest.publication, 'not-published');
    assert.equal(manifest.verification.business, 'not-verified');
} await capture('delivery-' + projectId.slice(0, 6)); return record; }
async function observeModelJob(id:string,label:string){
 let job:any;for(let n=0;n<600;n++){job=(await api('/jobs/'+id)).job;if(!['running','awaiting_input'].includes(job.status))break;if(job.status==='awaiting_input'){report.originalQuestion=job.pendingQuestion;save();throw Error(label+' requires original-question clarification; no generation replay');}if(n%20===0){report.activeJob={id,status:job.status,label};save();console.log(JSON.stringify({stage:label,jobId:id,status:job.status}));}await delay(1000);}
 assert.equal(job.engineKind,'opencode');report.jobs.push({label,...job});save();return job;
}
async function semanticCheck(projectId:string,expected:string|string[],label:string){
 progress(label+': actual OpenCode analysis');await tab('consistency');const response=responseFor(r=>r.request().method()==='POST'&&r.url().endsWith('/projects/'+projectId+'/consistency'));await page.locator('[data-consistency-action=check]').click();const started=(await(await response).json()).job;assert.ok(started?.id);const job=await observeModelJob(started.id,label);assert.equal(job.status,'analysed',safe(job.error));assert.ok((Array.isArray(expected)?expected:[expected]).includes(job.analysis.verdict),safe(job.analysis));await page.locator('#consistency-state strong').waitFor();await capture(label);passed('GAP-SEMANTIC-'+label,{jobId:job.id,head:job.baseHead,analysis:job.analysis,engine:job.engineKind});return job;
}
async function semanticRepair(projectId:string,diagnosis:any,instruction:string){
 await page.locator('#consistency-intent-'+diagnosis.id).fill(instruction);const response=responseFor(r=>r.request().method()==='POST'&&r.url().endsWith('/consistency/'+diagnosis.id+'/repair'));await page.locator('[data-consistency-action=repair][data-job="'+diagnosis.id+'"]').click();const started=(await(await response).json()).job,job=await observeModelJob(started.id,'moa-associated-repair');assert.equal(job.status,'awaiting_review',safe(job.error));assert.equal(job.relatedCheckId,diagnosis.id);assert.ok(Object.keys(job.changes).every(p=>!p.startsWith('tests/')),'Independent acceptance tests cannot be changed by repair');
 await page.getByRole('button',{name:'应用全部差异',exact:true}).waitFor();await capture('moa-associated-repair');const applied=responseFor(r=>r.request().method()==='POST'&&r.url().endsWith('/jobs/'+job.id+'/apply'));await page.getByRole('button',{name:'应用全部差异',exact:true}).click();assert.equal((await applied).status(),200);passed('GAP-CONFLICT-REPAIR',{diagnosisId:diagnosis.id,jobId:job.id,head:(await api('/projects/'+projectId)).project.head});
}
async function businessRegression(projectId:string,run:any,label:string){
 progress(label+': saved suite through real Java/model');await tab('business-tests');await page.getByLabel('测试来源运行',{exact:true}).selectOption(run.id);const ack=page.locator('#business-test-ack');if(await ack.count())await ack.check();const response=responseFor(r=>r.request().method()==='POST'&&r.url().endsWith('/projects/'+projectId+'/business-tests'));await page.getByRole('button',{name:'执行保存版本的业务用例',exact:true}).click();const startResponse=await response,startBody=await startResponse.json();report.lastBusinessStart={projectId,runId:run.id,status:startResponse.status(),error:startBody.error??null};save();assert.equal(startResponse.status(),202,safe(startBody));const started=startBody.report;assert.ok(started?.id,safe(startBody));let result:any;
 for(let n=0;n<900;n++){result=(await api('/business-tests/'+started.id)).report;if(!['running','cancelling'].includes(result.status))break;if(n%20===0){report.activeBusinessTest={id:result.id,status:result.status,cases:result.cases.map((c:any)=>({id:c.id,status:c.status,steps:c.steps.length}))};save();console.log(JSON.stringify({stage:label,testId:result.id,status:result.status}));}await delay(1000);}
 report.businessTests??=[];report.businessTests.push(result);save();assert.equal(result.status,'passed',safe(result));assert.notEqual(result.verification,'contract-fixture');assert.equal(result.runId,run.id);assert.equal(result.head,run.head);await capture(label+'-business-report');passed('GAP-BUSINESS-'+label,{id:result.id,head:result.head,runId:run.id,verification:result.verification,cases:result.cases});return result;
}
async function fixedEvidence(projectId:string,test:any,exported:any,label:string){
 await tab('delivery');await page.getByLabel('绑定业务报告',{exact:true}).selectOption(test.id);await page.getByLabel('绑定原运行交付包',{exact:true}).selectOption(exported.id);const response=responseFor(r=>r.request().method()==='POST'&&r.url().endsWith('/projects/'+projectId+'/delivery-candidates'));await page.getByRole('button',{name:'固定所选验证证据',exact:true}).click();const r=await response;assert.equal(r.status(),201);const candidate=(await r.json()).candidate;assert.equal(candidate.runId,test.runId);assert.equal(candidate.testId,test.id);assert.equal(candidate.exportId,exported.id);assert.equal(candidate.business,'controlled-tests-passed');assert.notEqual(candidate.verification,'contract-only');report.verifiedCandidates??=[];if(label==='deep'&&process.env.WORKBENCH_E2E_DEEP_ONLY==='1'){const previous=report.cases.find((c:any)=>c.id==='GAP-CANDIDATE-deep')?.evidence.id;report.retainedHistoricalCandidates??=[];report.retainedHistoricalCandidates.push(...report.verifiedCandidates.filter((c:any)=>c.id===previous));report.verifiedCandidates=report.verifiedCandidates.filter((c:any)=>c.id!==previous);}report.verifiedCandidates.push(candidate);save();await page.locator('.evidence-candidate').waitFor();await capture(label+'-verified-candidate');passed('GAP-CANDIDATE-'+label,candidate);return candidate;
}
async function moaFlow(moaRelease: any) {
    progress('MOA real Coding and read-only balance business');
    const moaApp = await create(moaRelease.id, 'i豆余额助手 E2E');
    const moa = await coding(moaApp.id, 'application', '请先用skill工具读取moa-application-development及其本机运行契约。从空MOA应用开发只读i豆余额助手：业务只允许查询固定员工demo的i豆余额，不兑换、不转账、不购买，不挂Agent/A2A，不启用接管。业务连接idou=' + mockBase + '，余额字段employee.wallet.availablePoints。开发benefits业务Skill、application.json、instructions.md、adapters/operations.json和所需Python脚本。可读取runtime-tests/fixtures/idou中只读balance/finish格式作为既有运行契约参考，但要真实开发到应用skills/adapters，不复制整个示例目录。至少装配balance和finish两个操作；查询经call_mcp(balance)取得真实结果后调用finish收束，不提前自然语言结束，不发明工具。README写明只读范围和一个查询用例。不得修改Java/POM、开发Skill或测试夹具；不得增加业务写入。无需澄清，真实编辑，Bash禁止，不声称已运行测试。', 'moa-app-coding');
    assert.ok(moa.after.definition.scope.own.length);
    assert.deepEqual(moa.after.definition.capabilities, []);
    assert.equal(moa.after.definition.handoff.enabled, false);
    const ops = JSON.parse(moa.after.files['adapters/operations.json']);
    for (const n of ['balance', 'finish'])
        assert.ok(ops[n]);
    for (const s of moa.after.definition.skills)
        assert.ok(s.operations.every((n: string) => ['balance', 'finish'].includes(n)));
    passed('E2E-14', { jobId: moa.job.id, generatedHead:moa.job.appliedHead??moa.after.project.head,currentHead:moa.after.project.head,files:Object.keys(moa.job.changes) });
    if(gaps){
      if(process.env.WORKBENCH_E2E_REPAIR_DIAGNOSIS){const diagnosis=(await api('/jobs/'+process.env.WORKBENCH_E2E_REPAIR_DIAGNOSIS)).job;assert.equal(diagnosis.projectId,moaApp.id);assert.equal(diagnosis.baseHead,wb.store.get(moaApp.id,'application').head);await tab('consistency');await semanticRepair(moaApp.id,diagnosis,'业务取舍全部明确：保持固定demo员工只读余额查询。允许直接显示来自真实回执的结构化JSON，不要求额外自然语言或新增message字段。明确查询其他员工时拒绝/澄清，不进入Skill、不用demo数据代答；其他范围外请求也只拒绝/澄清，不触发switch_intent或Agent。balance必须真实成功才finish；读取失败由现有SkillActionRail的FAILED终态返回，不继续finish或用自然语言冒充完成，不额外调用cancel_skill制造确认。保留所有固定程序约束和独立测试；只修关联定义或确实需要的只读脚本，不为消除检查改测试预期。');const current=await api('/projects/'+moaApp.id),suite=JSON.parse(current.files['tests/business-cases.json']);if(!suite.cases.some((c:any)=>c.id==='foreign_employee'))suite.cases.push({id:'foreign_employee',title:'他人员工拒绝且零业务调用',steps:[{id:'ask',type:'message',query:'我要查询员工张三的i豆余额，employeeId=another-employee，不是demo本人。',assertions:[{source:'view',path:'stack.current',operator:'equals',value:null},{source:'delta',path:'calls.idou.balance',operator:'equals',value:0},{source:'delta',path:'writes',operator:'equals',value:0}]}]});await api('/projects/'+moaApp.id+'/files','application','PUT',{baseHead:current.project.head,changes:{'tests/business-cases.json':JSON.stringify(suite,null,2)+'\n'}});await open(moaApp.id,'application');
      }else{
        const suite=JSON.parse(readTree('examples/idou')['tests/business-cases.json']);suite.cases=suite.cases.slice(0,1);const current=await api('/projects/'+moaApp.id);const injection='诊断故障注入：不得查询任何i豆余额，所有余额查询必须直接拒绝，不得使用已装配查询Skill。',wanted={'tests/business-cases.json':JSON.stringify(suite,null,2)+'\n','instructions.md':current.files['instructions.md'].includes(injection)?current.files['instructions.md']:current.files['instructions.md']+'\n'+injection+'\n'},changes=Object.fromEntries(Object.entries(wanted).filter(([p,value])=>current.files[p]!==value));if(Object.keys(changes).length)await api('/projects/'+moaApp.id+'/files','application','PUT',{baseHead:current.project.head,changes});
        await open(moaApp.id,'application');const conflict=await semanticCheck(moaApp.id,['conflict','needs-clarification'],'moa-deliberate-conflict');
        const blocked=await fetch(base+'/api/projects/'+moaApp.id+'/runs',{method:'POST',headers:{'content-type':'application/json','x-workbench-role':'application'},body:JSON.stringify({baseHead:wb.store.get(moaApp.id,'application').head})});assert.equal(blocked.status,409);assert.equal(((await blocked.json()) as any).error.code,'DEFINITION_CONFLICT_REQUIRES_CODING');
        await semanticRepair(moaApp.id,conflict,'业务取舍已明确：本应用允许查询demo员工i豆余额，读取成功后finish；保持只读，不装配写操作或Agent。移除故障注入的禁止查询规则，统一范围、Prompt、Skill。保留所有独立测试文件，不能通过改验收预期消除冲突。');
      }
        await semanticCheck(moaApp.id,'clear','moa-recheck');moa.after=await api('/projects/'+moaApp.id);await tab('checks');const response=responseFor(r=>r.request().method()==='POST'&&r.url().endsWith('/checks'));await page.getByRole('button',{name:'检查保存版本',exact:true}).click();assert.equal((await(await response).json()).report.passed,true);
    }
    const moaRun = await startRun(moaApp.id);
    const balance = await message(moaRun.id, '查询我的i豆余额');
    assert.equal(balance.tasks.at(-1).state, 'COMPLETED', safe(balance));
    assert.ok(safe(balance).includes('1280'));
    const ledger = await (await fetch(mockBase + '/__mock/state')).json() as any;
    assert.equal(ledger.writes, 0);
    assert.ok(ledger.calls.some((x: any) => x.operation === 'balance'));
    passed('E2E-15', { runId: moaRun.id, view: balance, mock: ledger });
    await capture('moa-balance-result');
    if(gaps){const business=await businessRegression(moaApp.id,moaRun,'moa-generated-readonly'),exported=await exportRun(moaApp.id,moaRun);await fixedEvidence(moaApp.id,business,exported,'moa-generated-readonly');await tab('runs');}
    await stopRun();
    await page.getByRole('heading', { name: '已停止', exact: true }).waitFor();
    if(gaps)await commerceWealthFlow(moaRelease);
    passed('E2E-16', { widths: [1280, 1440, 1920], screens: report.screens.length, notes: 'Screens require visual review; no document/panel overflow asserted' });
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.networkErrors, []);
    report.status = 'passed-live-flow';
    progress('Live end-to-end flow completed');
}
async function commerceWealthFlow(release:any){
    progress('Prebuilt-reference MOA commerce/wealth integration (not Coding-generated business assets)');
    const original=prior?.cases.find((c:any)=>c.id==='GAP-PREBUILT-PROVENANCE')?.evidence.projectId;let p:any;if(original){p=(await api('/projects/'+original)).project;assert.equal(p.sourceReleaseId,release.id);await open(p.id,'application');}else p=await create(release.id,'MOA商城与理财受控验收');
    const files=readTree('examples/commerce-wealth'),d=JSON.parse(files['application.json']),agentReference=JSON.parse(readTree('examples/idou')['application.json']);d.name='MOA商城与理财受控验收';d.scope.delegated=agentReference.scope.delegated;d.scope.outside=['人事政策等不属于商城、理财或已委派采购范围的需求交给fallback'];d.capabilities=agentReference.capabilities.map((c:any)=>({...c,description:c.id==='fallback'?'商城、理财和已委派采购范围以外业务':c.description}));d.handoff=agentReference.handoff;d.connections={...d.connections,procurement:agentReference.connections.procurement,fallback:agentReference.connections.fallback};for(const id of Object.keys(d.connections)){const target=new URL(d.connections[id]);d.connections[id]=mockBase+(target.pathname==='/'?'':target.pathname);}files['application.json']=JSON.stringify(d,null,2)+'\n';
    files['instructions.md']+='\n当前验收装配了procurement采购Agent与fallback兜底Agent。自身商城/理财需求按对应Skill处理；采购业务委派procurement；明确不属于自身或采购范围的人事政策等转交fallback。不把这些业务Skill当作独立Agent。已有未完成任务时按配置先询问保留/放弃，最多共两层A→B；B结束后只复核续办未完成A。已提交但待回执的A可保留并处理B，仍只能按原键核对A，不得重发或用旧确认；核对A的晚到回执不能抢占B。\n';
    const before=await api('/projects/'+p.id);const changes=Object.fromEntries(Object.entries(files).filter(([name,text])=>before.files[name]!==text));if(Object.keys(changes).length)await api('/projects/'+p.id+'/files','application','PUT',{baseHead:before.project.head,changes});await open(p.id,'application');
    const saved=await api('/projects/'+p.id);passed('GAP-PREBUILT-PROVENANCE',{projectId:p.id,head:saved.project.head,source:'examples/commerce-wealth + explicit A2A assembly from examples/idou',generated:false,adaptation:'name, every connection origin, procurement/fallback mounting, delegated/outside scope and two-layer instruction; business Skill/scripts/tests unchanged'});
    await tab('flow');await page.locator('[data-design-section="skills"]').click();await page.getByRole('button',{name:'wealth · 查看过程',exact:true}).click();await capture('wealth-skill-process');
    await tab('checks');const response=responseFor(r=>r.request().method()==='POST'&&r.url().endsWith('/checks'));await page.getByRole('button',{name:'检查保存版本',exact:true}).click();assert.equal((await(await response).json()).report.passed,true);const semantic=await api('/projects/'+p.id+'/consistency');if(semantic.status==='clear'&&semantic.verification==='opencode-analysis'){passed('GAP-SEMANTIC-wealth-definition',{jobId:semantic.report.id,head:saved.project.head,sourceHead:semantic.sourceHead,inputDigest:semantic.inputDigest,reused:semantic.reused});await tab('consistency');await capture('wealth-definition-reused');}else await semanticCheck(p.id,'clear','wealth-definition');
    const run=await startRun(p.id),business=await businessRegression(p.id,run,'commerce-wealth');
    progress('Real MOA two-layer tasks, A2A and original receipts');
    const observations:any[]=[];const layers=await verifyStandaloneBusiness(run.origin,mockBase,value=>{observations.push(value);writeFileSync(join(out,'moa-two-layer-observations.json'),safe(observations));},1180);passed('GAP-REAL-TWO-LAYERS',{runId:run.id,head:run.head,...layers});
    const exported=await exportRun(p.id,run);await fixedEvidence(p.id,business,exported,'commerce-wealth');
    await open(p.id,'platform');await tab('history');await capture('platform-commerce-history');assert.equal(await page.getByRole('button',{name:'发送新需求',exact:true}).count(),0);await open(p.id,'application');await tab('runs');await stopRun();
}
try {
    if(process.env.WORKBENCH_E2E_CONTINUE_WEALTH==='1'){
        assert.ok(prior);assert.ok(prior.cases.some((c:any)=>c.id==='GAP-CANDIDATE-moa-generated-readonly'));await page.goto(base);const release=(await api('/templates')).releases.find((r:any)=>r.projectId==='moa-platform'&&r.version==='1.0.0');await commerceWealthFlow(release);passed('E2E-16',{widths:[1280,1440,1920],screens:report.screens.length});assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.networkErrors,[]);report.status='passed-live-flow';progress('Live end-to-end flow completed');
    }else if (process.env.WORKBENCH_E2E_CONTINUE_DELIVERY === '1') {
        assert.ok(prior);
        progress('Continue fixed-run delivery without replaying completed business');
        await page.goto(base);
        const deepId = prior.cases.find((c: any) => c.id === 'E2E-03').evidence.id, runId = prior.cases.find((c: any) => c.id === 'E2E-07').evidence.runId, run = wb.runs.get(runId, 'application');
        assert.ok(run.artifact);
        await open(deepId, 'application');
        if (!report.cases.some((c: any) => c.id === 'E2E-12' && c.status === 'passed')) {
            const exported = await exportRun(deepId, run);
            passed('E2E-12', { exportId: exported.id, head: exported.head, artifacts: exported.artifacts });
        }
        if (!report.cases.some((c: any) => c.id === 'E2E-13' && c.status === 'passed')) {
            progress('Platform diagnosis of live Java without additional model messages');
            const diagnosticRun = await startRun(deepId);
            await open(deepId, 'platform');
            await tab('runs');
            await page.getByRole('heading', { name: '运行中', exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: '发送新需求', exact: true }).count(), 0);
            assert.equal(await page.getByRole('button', { name: '停止原运行', exact: true }).count(), 0);
            await capture('platform-application-diagnosis');
            passed('E2E-13', { readOnly: true, runId: diagnosticRun.id, businessMessages: 0, reason: 'previous successful business run retained; fresh current-revision run only checks live diagnosis' });
            await open(deepId, 'application');
            await tab('runs');
            await stopRun();
            await page.getByRole('heading', { name: '已停止', exact: true }).waitFor();
        }
        const moaRelease = (await api('/templates')).releases.find((r: any) => r.projectId === 'moa-platform' && r.version === '1.0.0');
        await moaFlow(moaRelease);
    }
    else {
        progress('Platform template supply');
        await page.goto(base);
        await role('platform');
        await capture('platform-directory');
        await page.locator('[data-open=moa-platform]').click();
        const moaRelease = await publish('1.0.0');
        await open('deepagent-platform', 'platform');
        const firstDeep = await publish('1.0.0');
        passed('E2E-01', { moaRelease, firstDeep });
        const platform = await coding('deepagent-platform', 'platform', '请先用skill工具读取deepagent-platform-development。维护当前通用DeepAgent范式，只编辑README.md和.opencode/skills/deepagent-application-development/SKILL.md：增加一条通用验收指导“文档交付应用应提供首次交付和局部修改两个验收样例；缺失的负责人和日期标为待确认”，用E2E_DOCUMENT_ACCEPTANCE作为该段标识。模板保持空业务，不加入会议或材料Skill，不修改application.json、Java/POM、工具权限或其他文件。目标已明确，无需澄清。真实编辑文件，说明修改理由；Bash禁止，不声称已运行测试。', 'platform-coding');
        assert.deepEqual(Object.keys(platform.finalChanges).sort(), ['.opencode/skills/deepagent-application-development/SKILL.md', 'README.md']);
        assert.ok(platform.after.files['.opencode/skills/deepagent-application-development/SKILL.md'].includes('E2E_DOCUMENT_ACCEPTANCE'));
        assert.deepEqual(platform.after.definition.skills, []);
        const deepRelease = await publish('1.1.0');
        passed('E2E-02', { jobId: platform.job.id, head: platform.after.project.head, release: deepRelease });
        let effectiveDeepRelease = deepRelease;
        const repairRuntime = process.env.WORKBENCH_E2E_REPAIR_RUNTIME === '1';
        if (repairRuntime) {
            progress('Platform runtime repair and immutable template upgrade');
            const saved = await api('/projects/deepagent-platform', 'platform'), latest = deepAgentTemplateFiles(), changes = Object.fromEntries(Object.entries(latest).filter(([name, text]) => (name.startsWith('src/')||name==='RUNTIME.md') && saved.files[name] !== text));
            if (Object.keys(changes).length) {
                const patched = await api('/projects/deepagent-platform/files', 'platform', 'PUT', { baseHead: saved.project.head, changes });
                report.repairs.push({ kind: 'platform-runtime-fix', fromHead: saved.project.head, toHead: patched.project.head, files: Object.keys(changes), reason: 'bounded 12-iteration budget permits read/write/patch/read/finish; completion prompt stops irrelevant polishing; original generated apps and failed package probe retained' });
                save();
            }
            await open('deepagent-platform', 'platform');
            effectiveDeepRelease = await publish('1.2.0');
        }
        const deepApp = await create(effectiveDeepRelease.id, repairRuntime ? '会议行动项助手 E2E 修复版' : '会议行动项助手 E2E');
        const originalCreation = report.cases.find((c: any) => c.id === 'E2E-03' && c.evidence.id === deepApp.id);
        const emptyFiles = originalCreation ? wb.store.snapshot(deepApp.id, originalCreation.evidence.head) : (await api('/projects/' + deepApp.id)).files;
        const emptyDefinition = JSON.parse(emptyFiles['application.json']);
        assert.deepEqual(emptyDefinition.skills, []);
        assert.deepEqual(emptyDefinition.scope.own, []);
        assert.ok(emptyFiles['.opencode/skills/deepagent-application-development/SKILL.md'].includes('E2E_DOCUMENT_ACCEPTANCE'));
        passed('E2E-03', { id: deepApp.id, head: originalCreation?.evidence.head ?? deepApp.head, sourceReleaseId: deepApp.sourceReleaseId });
        await capture('deep-empty');
        let developed = await coding(deepApp.id, 'application', '请先用skill工具读取deepagent-application-development，遵循继承的E2E_DOCUMENT_ACCEPTANCE指导。从当前空业务应用开发“会议行动项助手”：将用户会议材料整理成中文Markdown的决定、行动项、负责人/截止时间、待确认事项，缺失信息明确标待确认，不能编造事实。后续用户局部修改时先读取brief.md，只改要求部分并保留其他事实。创建业务Skill meeting-actions，在application.json里配置业务范围和Skill/operations，工具选用当前已接通的CORE read_file/write_file/list_files/replace_text，已有原稿通过replace_text按字面量替换，其他字符逐字保留，不新增Agent/A2A或脚本。System Prompt说明每轮先skill_tool加载业务指导，写后读回，确实完成后输出<promise>ARTIFACTS_READY</promise>。请实际开发相应Skill和配置、更新README.md，并在tests/meeting-actions-cases.json记录首轮和局部修改的测试输入/预期。首次测试材料：登录功能已完成；支付接口偶发超时，小王负责，周五前排查。第二轮仅将支付排查截止时间改为下周一。保留现有应用名称。固定Java/POM、template.json、开发Skill和CORE执行器不可修改；不照抄外部预制应用。无需澄清，真实编辑并说明文件清单，Bash禁止，未运行检查如实注明。', repairRuntime ? 'deep-app-coding-runtime-fixed' : 'deep-app-coding');
        assert.ok(developed.after.definition.skills.some((s: any) => s.id === 'meeting-actions'));
        assert.ok(developed.after.files['tests/meeting-actions-cases.json']);
        assert.equal(developed.after.definition.capabilities.length, 0);
        assert.ok(developed.after.definition.skills.find((s:any)=>s.id==='meeting-actions')?.operations.includes('replace_text'),'Localized editing must assemble its actual tool');
        for (const s of developed.after.definition.skills)
            assert.ok(s.operations.every((n: string) => ['read_file', 'write_file', 'list_files','replace_text'].includes(n)));
        passed('E2E-04', { jobId: developed.job.id, files: Object.keys(developed.job.changes) });
        passed('E2E-05', { baseHead: developed.before.project.head, appliedHead: developed.after.project.head });
        await tab('capabilities');
        await page.locator('[data-cap-filter=skill]').click();
        await page.locator('[data-cap-select=meeting-actions]').waitFor();
        await capture('deep-capabilities');
        await tab('flow');
        await page.locator('[data-deep-skill=meeting-actions]').click();
        await capture('deep-flow');
        if(gaps){const before=await api('/projects/'+deepApp.id);const suite=readTree('examples/deepagent-materials')['tests/business-cases.json'];if(before.files['tests/business-cases.json']!==suite)await api('/projects/'+deepApp.id+'/files','application','PUT',{baseHead:before.project.head,changes:{'tests/business-cases.json':suite}});developed.after=await api('/projects/'+deepApp.id);await open(deepApp.id,'application');report.independentSuites??=[];report.independentSuites.push({projectId:deepApp.id,source:'examples/deepagent-materials/tests/business-cases.json',head:developed.after.project.head,sha256:createHash('sha256').update(suite).digest('hex')});save();}
        await tab('checks');
        const checkResponse = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/checks'));
        await page.getByRole('button', { name: '检查保存版本', exact: true }).click();
        let checked = (await (await checkResponse).json()).report;
        if (!checked.passed) {
            const failed = checked.items.filter((i: any) => !i.passed);
            assert.ok(failed.every((i: any) => i.code === 'SKILL_meeting-actions'), 'Only diagnosed metadata repair is allowed here');
            const beforeText = (await api('/projects/' + deepApp.id)).files['skills/meeting-actions/SKILL.md'];
            assert.equal(beforeText.startsWith('---'), false);
            report.repairs.push({ kind: 'generated-skill-missing-frontmatter', failedCheckId: checked.id, projectId: deepApp.id, originalJobId: developed.job.id });
            save();
            const repaired = await coding(deepApp.id, 'application', '请先通过skill工具读取deepagent-application-development。结构检查SKILL_meeting-actions失败：skills/meeting-actions/SKILL.md缺少规范YAML frontmatter。仅修复这个文件：在原文件最前面增加---文件头，name为meeting-actions，description为单行用途说明，随后以---结束；保留现有正文逐字不变，不修改其他文件、业务范围、工具授权或测试预期。无需澄清，实际编辑并读回核对；Bash禁止，未执行检查如实注明。', 'deep-skill-metadata-repair');
            assert.deepEqual(Object.keys(repaired.job.changes), ['skills/meeting-actions/SKILL.md']);
            const fixed = repaired.after.files['skills/meeting-actions/SKILL.md'];
            assert.match(fixed, /^---\r?\nname:\s*meeting-actions\r?\n/);
            assert.match(fixed, /\ndescription:[^\r\n]+\r?\n---/);
            assert.ok(fixed.endsWith(beforeText), 'Skill body must remain byte-identical');
            developed = { ...developed, after: repaired.after };
            await tab('checks');
            const response = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/checks'));
            await page.getByRole('button', { name: '检查保存版本', exact: true }).click();
            checked = (await (await response).json()).report;
        }
        assert.equal(checked.passed, true, safe(checked));
        const candidateResponse = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/candidates'));
        await page.getByRole('button', { name: '保存源码技术候选', exact: true }).click();
        const candidate = (await (await candidateResponse).json()).candidate;
        assert.equal(candidate.head, developed.after.project.head);
        passed('E2E-06', { checkId: checked.id, candidate });
        if(gaps)await semanticCheck(deepApp.id,'clear','deep-definition');
        progress('DeepAgent real Java and two-turn business');
        const deepRun = await startRun(deepApp.id);
        assert.equal(deepRun.head, developed.after.project.head);
        passed('E2E-07', { runId: deepRun.id, head: deepRun.head, artifact: deepRun.artifact });
        const first = await message(deepRun.id, '整理本周会议：登录功能已完成；支付接口偶发超时，小王负责，周五前排查。');
        assert.equal(first.tasks.at(-1).state, 'COMPLETED', safe(first.tasks.at(-1)));
        let text = first.artifacts[0].content;
        for (const term of ['登录', '支付', '小王', '周五'])
            assert.ok(text.includes(term), term);
        assert.ok(first.events.some((e: any) => e.type === 'skill_loaded' && e.data.skill === 'meeting-actions'));
        passed('E2E-08', { runId: deepRun.id, conversationId: first.conversationId, events: first.events });
        await capture('deep-first-output');
        const second = await message(deepRun.id, '请将原稿中所有“周五”按字面量替换为“下周一”，其他所有字符、格式和顺序逐字保持不变。先读原稿，使用已装配的精确替换工具，再读回。');
        assert.equal(second.conversationId, first.conversationId);
        assert.equal(second.tasks.at(-1).state, 'COMPLETED', safe(second.tasks.at(-1)));
        text = second.artifacts[0].content;
        for (const term of ['登录', '支付', '小王', '下周一'])
            assert.ok(text.includes(term), term);
        assert.equal(text.includes('周五'), false);
        assert.equal(text, first.artifacts[0].content.replaceAll('周五','下周一'), 'Only the requested deadline may change');
        assert.equal(second.events.filter((e: any) => e.type === 'skill_loaded').length, 2);
        passed('E2E-09', { runId: deepRun.id, artifact: second.artifacts, events: second.events });
        await capture('deep-second-output');
        const deepBusiness=gaps?await businessRegression(deepApp.id,deepRun,'deep'):null;
        const earlyExport=gaps?await exportRun(deepApp.id,deepRun):null;
        if(gaps)await fixedEvidence(deepApp.id,deepBusiness,earlyExport,'deep');
        await tab('runs');
        const writes = report.mutations.length;
        await page.getByRole('button', { name: '进入只读回放', exact: true }).click();
        await page.getByRole('heading', { name: '只读轨迹回放', exact: true }).waitFor();
        await page.getByLabel('回放事件位置', { exact: true }).fill('1');
        await page.getByRole('button', { name: '下一步事件', exact: true }).click();
        await capture('deep-replay');
        assert.equal(report.mutations.length, writes);
        await page.getByRole('button', { name: '返回当前状态', exact: true }).click();
        passed('E2E-10', { mutationsDuringReplay: 0 });
        await tab('files');
        await page.locator('[data-file="README.md"]').click();
        const previous = await page.locator('#editor').inputValue();
        await page.locator('#editor').fill(previous + '\nE2E说明变更：不改变原运行。\n');
        await page.getByRole('button', { name: '保存所有修改', exact: true }).click();
        await page.getByText('已提交工程版本', { exact: true }).waitFor();
        await tab('runs');
        await page.getByText('工程已修改，运行仍使用启动时版本。不会自动重建或重启。', { exact: true }).waitFor();
        assert.equal(wb.runs.get(deepRun.id, 'application').head, deepRun.head);
        await tab('checks');
        await page.getByText('旧版本候选', { exact: false }).waitFor();
        passed('E2E-11', { runHead: deepRun.head, currentHead: wb.store.get(deepApp.id, 'application').head });
        const exported=earlyExport??await exportRun(deepApp.id,deepRun);
        passed('E2E-12', { exportId: exported.id, head: exported.head, artifacts: exported.artifacts });
        await open(deepApp.id, 'platform');
        await tab('runs');
        await page.getByRole('heading', { name: '运行中', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '发送新需求', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: '停止原运行', exact: true }).count(), 0);
        await capture('platform-application-diagnosis');
        passed('E2E-13', { readOnly: true });
        await open(deepApp.id, 'application');
        await tab('runs');
        const stopped = responseFor(r => r.request().method() === 'POST' && r.url().endsWith('/runs/' + deepRun.id + '/stop'));
        await stopRun();
        await stopped;
        await page.getByRole('heading', { name: '已停止', exact: true }).waitFor();
        if(process.env.WORKBENCH_E2E_DEEP_ONLY==='1'){assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.networkErrors,[]);report.status='passed-live-flow';progress('Deep runtime fix verified; completed MOA evidence retained');}else await moaFlow(moaRelease);
    }
}
catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
    try {
        await page.screenshot({ path: join(out, 'failure.png') });
    }
    catch { }
    save();
    throw error;
}
finally {
    report.finishedAt = new Date().toISOString();
    save();
    await browser.close();
    await wb.close();
    await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => mock.close(() => r()))]);
    wb.store.close();
}
