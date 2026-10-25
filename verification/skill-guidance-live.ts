/** Opt-in Skill evaluation: paired Deep guidance, terse business goals, no automatic repair. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkbench } from '../workbench-server/app.js';
import { createBusinessMock } from '../mock-business/server.js';
import { moaTemplateFiles } from '../workbench-server/template.js';
import { settings } from '../workbench-server/settings.js';
assert.equal(process.env.SKILL_GUIDANCE_LIVE, '1', 'Paid model evaluation requires opt-in');
const config = settings(process.cwd());
assert.ok(config.apiKey);
assert.equal(new URL(config.baseUrl).hostname, 'api.deepseek.com');
const refresh = process.env.SKILL_GUIDANCE_MOA_REFRESH ? JSON.parse(readFileSync(resolve(process.env.SKILL_GUIDANCE_MOA_REFRESH), 'utf8')) : null;
const followup = refresh ?? (process.env.SKILL_GUIDANCE_BUSINESS_ONLY ? JSON.parse(readFileSync(resolve(process.env.SKILL_GUIDANCE_BUSINESS_ONLY), 'utf8')) : null);
const retry = followup ?? (process.env.SKILL_GUIDANCE_REFINEMENT ? JSON.parse(readFileSync(resolve(process.env.SKILL_GUIDANCE_REFINEMENT), 'utf8')) : null);
const retryGoal = retry?.jobs.find((j: any) => j.label.startsWith('moa-'))?.prompt;
const retryDeepGoal = retry?.jobs.find((j: any) => j.label.startsWith('deep-'))?.prompt;
const retryMock = retryGoal?.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
if (retry) {
    assert.ok(retryMock, 'Original Mock address required');
    assert.ok(retryDeepGoal, 'Original Deep business goal required');
}
const parent = resolve('.workbench/verification');
mkdirSync(parent, { recursive: true });
if (!followup)
    assert.ok(readdirSync(parent).filter(n => n.startsWith('skill-guidance-')).length < 2, 'Review owned workspaces; never delete historical evidence automatically');
const stamp = new Date().toISOString().replace(/[:.]/g, '-'), root = followup ? resolve(followup.root) : join(parent, 'skill-guidance-' + stamp), out = resolve('test-results/skill-guidance-20261025', stamp);
assert.ok(root.startsWith(parent + '/skill-guidance-'));
mkdirSync(out, { recursive: true });
const report: any = { startedAt: new Date().toISOString(), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), root, out, model: config.model, mode: 'real OpenCode; same runtime; no automatic repair', cases: [], jobs: [] };
const safe = (v: unknown) => JSON.stringify(v, null, 2).split(config.apiKey).join('[REDACTED]');
const save = () => writeFileSync(join(out, 'report.json'), safe(report));
const wb = createWorkbench({ root }), server = wb.app.listen(0, '127.0.0.1'), mock = createBusinessMock().listen(retryMock ? Number(new URL(retryMock).port) : 0, '127.0.0.1');
await Promise.all([new Promise<void>(r => server.once('listening', r)), new Promise<void>(r => mock.once('listening', r))]);
const address = server.address(), mockAddress = mock.address();
assert.ok(address && typeof address !== 'string' && mockAddress && typeof mockAddress !== 'string');
const base = 'http://127.0.0.1:' + address.port, mockBase = 'http://127.0.0.1:' + mockAddress.port;
async function api(path: string, role = 'application', method = 'GET', body?: unknown): Promise<any> { const response = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', 'x-workbench-role': role }, body: body === undefined ? undefined : JSON.stringify(body) }); const value = await response.json(); assert.ok(response.ok, JSON.stringify({ path, status: response.status, error: value.error })); return value; }
async function develop(id: string, role: string, prompt: string, label: string) {
    report.stage = label;
    save();
    console.log(label + ' started');
    const before = await api('/projects/' + id, role);
    const { job: started } = await api('/projects/' + id + '/jobs', role, 'POST', { prompt });
    report.jobs.push({ id: started.id, label, prompt, baseHead: before.project.head });
    save();
    let job: any;
    for (let n = 0; n < 600; n++) {
        job = (await api('/jobs/' + started.id, role)).job;
        if (!['running'].includes(job.status))
            break;
        await delay(1000);
    }
    const result: any = { label, jobId: job.id, status: job.status, baseHead: before.project.head, repairCount: 0 };
    if (job.status === 'awaiting_input') {
        result.question = job.pendingQuestion;
        await api('/jobs/' + job.id + '/cancel', role, 'POST');
    }
    if (job.status === 'awaiting_review') {
        assert.equal(job.engineKind, 'opencode');
        const expected = (before.project.family ?? 'moa') + '-' + (role === 'platform' ? 'platform' : 'application') + '-development';
        assert.ok(job.evidence.some((e: any) => e.tool === 'skill' && e.status === 'completed' && e.input?.name === expected));
        assert.equal((await api('/projects/' + id, role)).project.head, before.project.head);
        result.files = Object.keys(job.changes);
        result.evidence = job.evidence;
        await api('/jobs/' + job.id + '/apply', role, 'POST');
        const after = await api('/projects/' + id, role);
        result.head = after.project.head;
        result.projectId = id;
        if (role === 'application') {
            result.check = (await api('/projects/' + id + '/checks', role, 'POST')).report;
            result.passed = result.check.passed && after.definition.skills.length > 0 && after.definition.scope.own.length > 0;
            result.skills = after.definition.skills;
            for (const skill of after.definition.skills) {
                const text = after.files[skill.file];
                result.passed &&= /^---\r?\n/.test(text) && new RegExp('\\nname:\\s*' + skill.id + '\\s*\\r?\\n').test(text) && /\ndescription:[^\n]+\n/.test(text);
            }
        }
        else {
            assert.deepEqual(result.files.sort(), ['.opencode/skills/deepagent-application-development/SKILL.md', 'README.md']);
            assert.deepEqual(after.definition.skills, []);
            assert.deepEqual(after.definition.scope.own, []);
            result.passed = true;
        }
    }
    else {
        result.error = job.error;
        result.passed = false;
    }
    report.cases.push(result);
    save();
    console.log(label + ' result: ' + result.status + ', first-pass=' + result.passed);
    return result;
}
async function execute(projectId: string, label: string, queries: string[]) {
    const project = (await api('/projects/' + projectId)).project;
    const { run: started } = await api('/projects/' + projectId + '/runs', 'application', 'POST', { baseHead: project.head });
    let run: any;
    for (let n = 0; n < 240; n++) {
        run = (await api('/runs/' + started.id)).run;
        if (['running', 'failed'].includes(run.status))
            break;
        await delay(1000);
    }
    assert.equal(run.status, 'running', safe(run.error ?? {}));
    const result: any = { label, runId: run.id, head: run.head, artifact: run.artifact, views: [] };
    report.business ??= [];
    report.business.push(result);
    save();
    let conversationId: string | undefined;
    for (const query of queries) {
        const view = await api('/runs/' + run.id + '/messages', 'application', 'POST', { query, conversationId });
        conversationId = view.conversationId;
        result.views.push(view);
        save();
        assert.equal(view.tasks.at(-1).state, 'COMPLETED');
    }
    if (label.startsWith('deep-')) {
        const first = result.views[0], second = result.views[1];
        assert.equal(second.artifacts[0].content, first.artifacts[0].content.replaceAll('周五前', '下周一'));
        for (const term of ['登录', '支付', '小王', '周五'])
            assert.ok(first.artifacts[0].content.includes(term));
        assert.equal(second.events.filter((e: any) => e.type === 'skill_loaded').length, 2);
    }
    else {
        const ledger = await (await fetch(mockBase + '/__mock/state')).json() as any;
        result.mock = ledger;
        assert.equal(ledger.writes, 0);
        assert.ok(ledger.calls.some((c: any) => c.operation === 'balance'));
        assert.ok(safe(result.views[0]).includes('1280'));
    }
    result.passed = true;
    await api('/runs/' + run.id + '/stop', 'application', 'POST');
    save();
}
try {
    if (refresh) {
        report.priorReport = process.env.SKILL_GUIDANCE_MOA_REFRESH;
        report.reason = 'Fresh MOA application after documenting native tool invocation; prior generation and execution failures retained';
        const template = await api('/projects/moa-platform', 'platform');
        const changes = Object.fromEntries(Object.entries(moaTemplateFiles()).filter(([name, text]) => name.startsWith('.opencode/skills/') && template.files[name] !== text));
        await api('/projects/moa-platform/files', 'platform', 'PUT', { baseHead: template.project.head, changes });
        assert.equal((await api('/projects/moa-platform/checks','platform','POST',{})).report.passed,true);
        const release = (await api('/templates/moa-platform/releases', 'platform', 'POST', { version: '1.1.0' })).release;
        const app = (await api('/projects', 'application', 'POST', { releaseId: release.id, name: 'i豆余额助手' })).project;
        const generated = await develop(app.id, 'application', retryGoal, 'moa-invocation-refined');
        if (generated.passed)
            await execute(app.id, 'moa-invocation-refined', ['查询我的i豆余额']);
        report.status = generated.passed && report.business?.[0]?.passed ? 'passed-moa-business-only' : 'needs-followup';
        report.fullAcceptance = 'needs-followup-deep-strict-edit';
        if (report.status === 'needs-followup')
            process.exitCode = 1;
        save();
    }
    else if (followup) {
        report.priorReport = process.env.SKILL_GUIDANCE_BUSINESS_ONLY;
        report.reason = 'Complete independent MOA business without regenerating applications or repeating Deep calls; prior Deep strict-edit failure retained';
        const moa = followup.cases.find((c: any) => c.label === 'moa-guidance-revised');
        assert.ok(moa?.passed);
        assert.equal((await api('/projects/' + moa.projectId)).project.head, moa.head);
        await execute(moa.projectId, 'moa-business-followup', ['查询我的i豆余额']);
        report.status = 'passed-moa-business-only';
        report.fullAcceptance = 'needs-followup-deep-strict-edit';
        save();
    }
    else if (retry) {
        report.priorReport = process.env.SKILL_GUIDANCE_REFINEMENT;
        report.reason = 'Fresh applications after routing-schema and minimal-edit guidance refinement; original failures retained';
        save();
        assert.equal((await api('/projects/deepagent-platform/checks','platform','POST',{})).report.passed,true);
        const deepRelease = (await api('/templates/deepagent-platform/releases', 'platform', 'POST', { version: '1.0.0' })).release;
        const deepApp = (await api('/projects', 'application', 'POST', { releaseId: deepRelease.id, name: '会议行动项助手' })).project;
        const deepResult = await develop(deepApp.id, 'application', retryDeepGoal, 'deep-guidance-revised');
        assert.equal((await api('/projects/moa-platform/checks','platform','POST',{})).report.passed,true);
        const release = (await api('/templates/moa-platform/releases', 'platform', 'POST', { version: '1.0.0' })).release;
        const app = (await api('/projects', 'application', 'POST', { releaseId: release.id, name: 'i豆余额助手' })).project;
        const result = await develop(app.id, 'application', retryGoal, 'moa-guidance-revised');
        if (deepResult.passed)
            await execute(deepApp.id, 'deep-guidance-revised', ['整理本周会议：登录功能已完成；支付接口偶发超时，小王负责，周五前排查。', '只把支付排查截止时间改为下周一，其他事项保持不变。']);
        if (result.passed)
            await execute(app.id, 'moa-guidance-revised', ['查询我的i豆余额']);
        report.status = result.passed && deepResult.passed && report.business?.length === 2 && report.business.every((b: any) => b.passed) ? 'passed' : 'needs-followup';
        if (report.status !== 'passed')
            process.exitCode = 1;
        save();
    }
    else {
        const deep = (await api('/projects/deepagent-platform', 'platform'));
        const currentFiles = deep.files;
        const guide = '.opencode/skills/deepagent-application-development/SKILL.md';
        const reference = '.opencode/skills/deepagent-application-development/references/assembly-contract.md';
        const old = execFileSync('git', ['show', '1a94e19:templates/deepagent/' + guide], { encoding: 'utf8' });
        report.control = { oldSkillSource: '1a94e19', runtimeSource: report.sourceHead, changedPaths: [guide, reference], runtimeUnchanged: true };
        await api('/projects/deepagent-platform/files', 'platform', 'PUT', { baseHead: deep.project.head, changes: { [guide]: old, [reference]: null } });
        assert.equal((await api('/projects/deepagent-platform/checks','platform','POST',{})).report.passed,true);
        const oldRelease = (await api('/templates/deepagent-platform/releases', 'platform', 'POST', { version: '1.0.0' })).release;
        const baseline = (await api('/projects', 'application', 'POST', { releaseId: oldRelease.id, name: '会议行动项助手' })).project;
        const oldTemplate = await api('/projects/deepagent-platform', 'platform');
        await api('/projects/deepagent-platform/files', 'platform', 'PUT', { baseHead: oldTemplate.project.head, changes: { [guide]: currentFiles[guide], [reference]: currentFiles[reference] } });
        assert.equal((await api('/projects/deepagent-platform/checks','platform','POST',{})).report.passed,true);
        const release = (await api('/templates/deepagent-platform/releases', 'platform', 'POST', { version: '1.1.0' })).release;
        const treatment = (await api('/projects', 'application', 'POST', { releaseId: release.id, name: '会议行动项助手' })).project;
        const b = (await api('/projects/' + baseline.id)).files, t = (await api('/projects/' + treatment.id)).files;
        for (const name of new Set([...Object.keys(b), ...Object.keys(t)]))
            if (![guide, reference].includes(name))
                assert.equal(b[name], t[name], name);
        report.control.baseRelease = oldRelease;
        report.control.newRelease = release;
        report.control.skillHashes = { old: createHash('sha256').update(old).digest('hex'), new: createHash('sha256').update(currentFiles[guide]).digest('hex') };
        save();
        const goal = '帮我开发一个会议行动项助手：把会议材料整理为决定、行动项（负责人和期限）、待确认事项。缺失信息不要编造。同一会话支持只修改指定内容并保留其余事实。请直接完成工程开发，并附首次整理和局部修改的验收样例。';
        await develop(baseline.id, 'application', goal, 'deep-old');
        const improved = await develop(treatment.id, 'application', goal, 'deep-new');
        assert.equal((await api('/projects/moa-platform/checks','platform','POST',{})).report.passed,true);
        const moaRelease = (await api('/templates/moa-platform/releases', 'platform', 'POST', { version: '1.0.0' })).release;
        const moa = (await api('/projects', 'application', 'POST', { releaseId: moaRelease.id, name: 'i豆余额助手' })).project;
        const moaResult = await develop(moa.id, 'application', '帮我开发一个只读i豆余额助手，只查询员工demo的可用积分。业务服务地址是' + mockBase + '。不允许兑换、转账或购买；请完成工程开发并写明查询验收样例。', 'moa-new');
        await develop('deepagent-platform', 'platform', '请完善模板的应用开发指导和README，明确：交付文档类应用时，增量修改必须保留未涉及的原始事实，验收应覆盖首次交付和局部修改。保持模板通用，不加入具体业务，不修改运行代码。请直接完成修改。', 'platform-new');
        if (improved.passed)
            await execute(treatment.id, 'deep-new', ['整理本周会议：登录功能已完成；支付接口偶发超时，小王负责，周五前排查。', '只把支付排查截止时间改为下周一，其他事项保持不变。']);
        if (moaResult.passed)
            await execute(moa.id, 'moa-new', ['查询我的i豆余额']);
        report.status = report.cases.filter((c: any) => c.label !== 'deep-old').every((c: any) => c.passed) && report.business?.length === 2 ? 'passed' : 'needs-followup';
        if (report.status !== 'passed')
            process.exitCode = 1;
        save();
    }
}
catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
    save();
    throw error;
}
finally {
    report.finishedAt = new Date().toISOString();
    save();
    await wb.close();
    await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => mock.close(() => r()))]);
    wb.store.close();
    console.log(safe({ status: report.status, out, root }));
}
