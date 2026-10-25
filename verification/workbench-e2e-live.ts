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
assert.equal(process.env.WORKBENCH_E2E_LIVE, '1', 'Explicit opt-in required');
const repository = process.cwd(), config = settings(repository);
assert.equal(new URL(config.baseUrl).hostname, 'api.deepseek.com');
assert.ok(config.apiKey);
const parent = resolve('.workbench/verification');
mkdirSync(parent, { recursive: true });
const prior = process.env.WORKBENCH_E2E_PRIOR_REPORT ? JSON.parse(readFileSync(resolve(process.env.WORKBENCH_E2E_PRIOR_REPORT), 'utf8')) : null;
if (!prior)
    assert.ok(readdirSync(parent).filter(n => n.startsWith('workbench-e2e-')).length < 2, 'Review existing owned E2E workspaces first');
const stamp = new Date().toISOString().replace(/[:.]/g, '-'), root = prior ? resolve(prior.root) : join(parent, 'workbench-e2e-' + stamp), out = resolve('test-results/workbench-e2e-20261025', (prior ? 'resume-' : '') + stamp);
assert.ok(root.startsWith(parent + '/workbench-e2e-'));
mkdirSync(out, { recursive: true });
const safe = (v: unknown) => (JSON.stringify(v, null, 2) ?? 'null').split(config.apiKey).join('[REDACTED]').replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED]') + '\n';
const report: any = { ...(prior ?? {}), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), root, out, mode: 'real OpenCode + local Java + deepseek-flash + isolated Mock', startedAt: new Date().toISOString(), cases: prior?.cases ?? [], jobs: prior?.jobs ?? [], runs: prior?.runs ?? [], screens: prior?.screens ?? [], pageErrors: prior?.pageErrors ?? [], networkErrors: prior?.networkErrors ?? [], mutations: prior?.mutations ?? [], repairs: prior?.repairs ?? [] };
if (prior) {
    assert.equal(prior.sourceHead, report.sourceHead);
    report.priorReport = process.env.WORKBENCH_E2E_PRIOR_REPORT;
    report.priorFailure = prior.error;
    report.status = 'resuming';
    delete report.error;
}
report.runnerSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
report.workingDiffSha256 = createHash('sha256').update(execFileSync('git', ['diff', '--', 'workbench-server', 'workbench-ui'])).digest('hex');
const save = () => writeFileSync(join(out, 'report.json'), safe(report));
function progress(stage: string) { report.stage = stage; save(); console.log(safe({ stage, root, out })); }
function passed(id: string, evidence: unknown) { const item = { id, status: id === 'E2E-02' && report.repairs.length ? 'passed_after_fix' : 'passed', evidence }; const index = report.cases.findIndex((c: any) => c.id === id); if (index < 0)
    report.cases.push(item);
else
    report.cases[index] = item; save(); }
const native = new LocalJavaEngine(repository);
const reused = new Set<string>();
const runEngine = { kind: native.kind, async build(input: Parameters<LocalJavaEngine['build']>[0]) { for (const candidate of prior?.runs ?? []) {
        if (!candidate.artifact || reused.has(candidate.id))
            continue;
        const source = JSON.parse(readFileSync(join(root, 'runs', candidate.id, 'source.json'), 'utf8'));
        const currentFiles = readTree(input.directory), copiedFiles = Object.keys(currentFiles);
        if (JSON.stringify(copiedFiles.sort()) !== JSON.stringify(Object.keys(source.files).sort()) || !copiedFiles.every(name => createHash('sha256').update(currentFiles[name]).digest('hex') === source.files[name]))
            continue;
        const original = join(root, 'runs', candidate.id, candidate.artifact.path);
        assert.equal(createHash('sha256').update(readFileSync(original)).digest('hex'), candidate.artifact.sha256);
        const target = join(input.directory, 'target');
        mkdirSync(target, { recursive: true });
        const jar = join(target, 'application.jar');
        copyFileSync(original, jar);
        assert.equal(createHash('sha256').update(readFileSync(jar)).digest('hex'), candidate.artifact.sha256);
        reused.add(candidate.id);
        report.reusedBuilds ??= [];
        report.reusedBuilds.push({ sourceRunId: candidate.id, head: source.head, sha256: candidate.artifact.sha256, allInputsVerified: copiedFiles.length });
        save();
        input.onLog('Reused verified Maven output; every saved input and JAR digest matches source run ' + candidate.id);
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
async function tab(id: string) { if (['configuration', 'capabilities', 'flow', 'files', 'coding'].includes(id))
    await page.locator('.app-tabs [data-tab=configuration]').click(); if (['checks', 'runs'].includes(id))
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
    return existing; await page.getByRole('button',{name:'测试',exact:true}).click(); await page.getByRole('button',{name:'检查保存版本',exact:true}).click(); await page.getByText('结构检查通过；业务未验证',{exact:false}).waitFor(); await page.locator('.app-tabs [data-tab=release]').click(); await page.getByLabel('版本号', { exact: true }).fill(version); const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/releases')); await page.getByRole('button', { name: '发行模板', exact: true }).click(); const r = await response; assert.equal(r.status(), 201); return (await r.json()).release; }
async function create(releaseId: string, name: string) { const existing = (await api('/projects')).projects.find((p: any) => p.name === name); if (existing) {
    assert.equal(existing.sourceReleaseId, releaseId);
    await open(existing.id, 'application');
    return existing;
} await role('application'); await home(); await page.getByLabel('应用名称', { exact: true }).fill(name); await page.getByLabel('模板版本', { exact: true }).selectOption(releaseId); const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/projects'); await page.getByRole('button', { name: '创建应用', exact: true }).click(); const value = await (await response).json(); await page.getByRole('heading', { name, exact: true }).waitFor(); return (await api('/projects/' + value.project.id)).project; }
async function coding(projectId: string, actor: string, prompt: string, label: string) {
    const earlier = prior?.jobs?.find((j: any) => j.label === label && j.id);
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
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/projects/' + projectId + '/jobs'));
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
    const apply = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/jobs/' + job.id + '/apply'));
    await page.getByRole('button', { name: '应用全部差异', exact: true }).click();
    assert.equal((await apply).status(), 200);
    const after = await api('/projects/' + projectId, actor);
    for (const [name, text] of Object.entries(job.changes))
        assert.equal(after.files[name] ?? null, text);
    return { job, before, after, finalChanges: job.changes };
}
async function startRun(projectId: string) { await tab('runs'); const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/projects/' + projectId + '/runs')); await page.getByRole('button', { name: '构建并启动保存版本', exact: true }).click(); const r = await response; assert.equal(r.status(), 202); const id = (await r.json()).run.id; let run: any; for (let n = 0; n < 240; n++) {
    run = (await api('/runs/' + id)).run;
    if (run.status === 'running' || run.status === 'failed')
        break;
    if (n % 10 === 0) {
        report.activeRun = { id, status: run.status, logs: run.logs.slice(-5) };
        save();
    }
    await delay(1000);
} report.runs.push(run); save(); assert.equal(run.status, 'running', safe(run.error)); assert.equal(run.engine, 'local-java'); await page.getByRole('heading', { name: '运行中', exact: true }).waitFor(); return run; }
async function message(runId: string, text: string) { await page.getByLabel('新需求或澄清补充', { exact: true }).fill(text); const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/runs/' + runId + '/messages')); await page.getByRole('button', { name: '发送新需求', exact: true }).click(); const r = await response; const body = await r.json(); assert.equal(r.status(), 200, safe(body)); writeFileSync(join(out, 'view-' + runId + '-' + body.events.length + '.json'), safe(body)); return body; }
async function stopRun() { const dialog = page.waitForEvent('dialog'); const response = page.waitForResponse(r => r.request().method() === 'POST' && /\/runs\/[^/]+\/stop$/.test(new URL(r.url()).pathname)); const clicked = page.getByRole('button', { name: '停止原运行', exact: true }).click(); const confirmation = await dialog; assert.equal(confirmation.type(), 'confirm'); assert.match(confirmation.message(), /停止原运行/); await confirmation.accept(); await clicked; assert.equal((await response).status(), 200); await page.getByRole('heading', { name: '已停止', exact: true }).waitFor({ timeout: 60000 }); }
async function exportRun(projectId: string, run: any) { await tab('delivery'); await page.getByLabel('交付来源运行', { exact: true }).selectOption(run.id); const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/projects/' + projectId + '/exports')); await page.getByRole('button', { name: '导出所选运行', exact: true }).click(); const r = await response; assert.ok([200, 201].includes(r.status())); const record = (await r.json()).export; assert.equal(record.head, run.head); for (const kind of ['application', 'source']) {
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
    passed('E2E-14', { jobId: moa.job.id, head: moa.after.project.head, files: Object.keys(moa.job.changes) });
    const moaRun = await startRun(moaApp.id);
    const balance = await message(moaRun.id, '查询我的i豆余额');
    assert.equal(balance.tasks.at(-1).state, 'COMPLETED', safe(balance));
    assert.ok(safe(balance).includes('1280'));
    const ledger = await (await fetch(mockBase + '/__mock/state')).json() as any;
    assert.equal(ledger.writes, 0);
    assert.ok(ledger.calls.some((x: any) => x.operation === 'balance'));
    passed('E2E-15', { runId: moaRun.id, view: balance, mock: ledger });
    await capture('moa-balance-result');
    await stopRun();
    await page.getByRole('heading', { name: '已停止', exact: true }).waitFor();
    passed('E2E-16', { widths: [1280, 1440, 1920], screens: report.screens.length, notes: 'Screens require visual review; no document/panel overflow asserted' });
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.networkErrors, []);
    report.status = 'passed-live-flow';
    progress('Live end-to-end flow completed');
}
try {
    if (process.env.WORKBENCH_E2E_CONTINUE_DELIVERY === '1') {
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
            const saved = await api('/projects/deepagent-platform', 'platform'), latest = deepAgentTemplateFiles(), changes = Object.fromEntries(Object.entries(latest).filter(([name, text]) => name.startsWith('src/') && saved.files[name] !== text));
            if (Object.keys(changes).length) {
                const patched = await api('/projects/deepagent-platform/files', 'platform', 'PUT', { baseHead: saved.project.head, changes });
                report.repairs.push({ kind: 'platform-runtime-fix', fromHead: saved.project.head, toHead: patched.project.head, files: Object.keys(changes), reason: 'per-turn Skill authorization recovery, nonthrowing list tool and failed-turn state; original generated apps retained' });
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
        let developed = await coding(deepApp.id, 'application', '请先用skill工具读取deepagent-application-development，遵循继承的E2E_DOCUMENT_ACCEPTANCE指导。从当前空业务应用开发“会议行动项助手”：将用户会议材料整理成中文Markdown的决定、行动项、负责人/截止时间、待确认事项，缺失信息明确标待确认，不能编造事实。后续用户局部修改时先读取brief.md，只改要求部分并保留其他事实。创建业务Skill meeting-actions，在application.json里配置业务范围和Skill/operations，工具选用当前已接通的CORE read_file/write_file/list_files，不新增Agent/A2A或脚本。System Prompt说明每轮先skill_tool加载业务指导，写后读回，确实完成后输出<promise>ARTIFACTS_READY</promise>。请实际开发相应Skill和配置、更新README.md，并在tests/meeting-actions-cases.json记录首轮和局部修改的测试输入/预期。首次测试材料：登录功能已完成；支付接口偶发超时，小王负责，周五前排查。第二轮仅将支付排查截止时间改为下周一。保留现有应用名称。固定Java/POM、template.json、开发Skill和CORE执行器不可修改；不照抄外部预制应用。无需澄清，真实编辑并说明文件清单，Bash禁止，未运行检查如实注明。', repairRuntime ? 'deep-app-coding-runtime-fixed' : 'deep-app-coding');
        assert.ok(developed.after.definition.skills.some((s: any) => s.id === 'meeting-actions'));
        assert.ok(developed.after.files['tests/meeting-actions-cases.json']);
        assert.equal(developed.after.definition.capabilities.length, 0);
        for (const s of developed.after.definition.skills)
            assert.ok(s.operations.every((n: string) => ['read_file', 'write_file', 'list_files'].includes(n)));
        passed('E2E-04', { jobId: developed.job.id, files: Object.keys(developed.job.changes) });
        passed('E2E-05', { baseHead: developed.before.project.head, appliedHead: developed.after.project.head });
        await tab('capabilities');
        await page.locator('[data-cap-filter=skill]').click();
        await page.locator('[data-cap-select=meeting-actions]').waitFor();
        await capture('deep-capabilities');
        await tab('flow');
        await page.locator('[data-deep-skill=meeting-actions]').click();
        await capture('deep-flow');
        await tab('checks');
        const checkResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/checks'));
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
            const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/checks'));
            await page.getByRole('button', { name: '检查保存版本', exact: true }).click();
            checked = (await (await response).json()).report;
        }
        assert.equal(checked.passed, true, safe(checked));
        const candidateResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/candidates'));
        await page.getByRole('button', { name: '保存源码技术候选', exact: true }).click();
        const candidate = (await (await candidateResponse).json()).candidate;
        assert.equal(candidate.head, developed.after.project.head);
        passed('E2E-06', { checkId: checked.id, candidate });
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
        const second = await message(deepRun.id, '只把支付排查截止时间改为下周一，其他事项保持不变。');
        assert.equal(second.conversationId, first.conversationId);
        assert.equal(second.tasks.at(-1).state, 'COMPLETED', safe(second.tasks.at(-1)));
        text = second.artifacts[0].content;
        for (const term of ['登录', '支付', '小王', '下周一'])
            assert.ok(text.includes(term), term);
        assert.equal(text.includes('周五'), false);
        assert.equal(text, first.artifacts[0].content.replace('周五前', '下周一'), 'Only the requested deadline may change');
        assert.equal(second.events.filter((e: any) => e.type === 'skill_loaded').length, 2);
        passed('E2E-09', { runId: deepRun.id, artifact: second.artifacts, events: second.events });
        await capture('deep-second-output');
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
        const exported = await exportRun(deepApp.id, deepRun);
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
        const stopped = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/runs/' + deepRun.id + '/stop'));
        await stopRun();
        await stopped;
        await page.getByRole('heading', { name: '已停止', exact: true }).waitFor();
        await moaFlow(moaRelease);
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
