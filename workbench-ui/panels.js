'use strict';
window.WorkbenchPanels = (() => {
    let host, token = 0;
    const cache = new Map(), esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), json = v => JSON.stringify(v, null, 2) + '\n';
    const c = () => host.context(), state = () => { const key = c().role + '|' + c().project.id; if (!cache.has(key))
        cache.set(key, { reports: [], candidates: [], events: [], filter: 'all', selected: null }); return cache.get(key); };
    function assets() { const files = c().effectiveFiles, d = JSON.parse(files['application.json']); let ops = {}; try {
        ops = JSON.parse(files['adapters/operations.json'] ?? '{}');
    }
    catch { } return [...d.skills.map(x => ({ ...x, type: 'skill', title: x.id, source: x.file, description: files[x.file], status: '工程定义' })), ...d.capabilities.map(x => ({ ...x, title: x.id, source: 'application.json', status: x.type === 'agent' ? '已挂载 · 需联调' : '待接线草稿' })), ...Object.entries(ops).map(([id, x]) => ({ ...x, id, title: x.title ?? id, type: 'operation', execution: x.type, source: 'adapters/operations.json', status: ['SCRIPT', 'A2A', 'CORE'].includes(x.type) ? '已有执行定义 · 未验证' : '待实现' }))]; }
    function capabilities() { const s = state(), items = assets(), shown = items.filter(x => s.filter === 'all' || x.type === s.filter), selected = shown.find(x => x.id === s.selected) ?? shown[0]; return `<div class="section-title"><div><h2>${c().project.kind === 'template' ? '公共能力' : '能力装配'}</h2><p class="muted">Skill 定义业务指导；Agent 承接委派；工具执行具体操作。编排引用这里的能力。</p></div><button data-tab="flow">进入编排</button></div><nav class="flow-nav" aria-label="能力类型">${[['all', '全部'], ['skill', '业务 Skills'], ['agent', 'Agent / A2A'], ['operation', '工具操作'], ['tool', '待接线']].map(([id, label]) => `<button data-cap-filter="${id}" class="${s.filter === id ? 'active' : ''}">${label}</button>`).join('')}</nav><div class="capability-layout"><section class="panel capability-list">${shown.map(x => `<button data-cap-select="${esc(x.id)}" class="${selected?.id === x.id ? 'active' : ''}"><strong>${esc(x.title)}</strong><small>${esc(x.type)} · ${esc(x.execution ?? '')} · ${esc(x.status)}</small></button>`).join('') || '<p>此类型尚无能力。</p>'}</section><section class="panel capability-detail">${selected ? `<div class="section-title"><h2>${esc(selected.title)}</h2><span class="badge">${esc(selected.status)}</span></div><dl><dt>维护者</dt><dd>${c().project.kind === 'template' ? '平台开发者 · 模板默认能力' : '应用开发者 · 当前工程定义'}</dd><dt>来源</dt><dd><code>${esc(selected.source)}</code> · ${esc(c().project.head.slice(0, 8))}${c().dirty ? ' · 含未保存草稿' : ''}</dd><dt>用途</dt><dd><pre class="skill-description">${esc(selected.description ?? '具体执行约束见下方定义')}</pre></dd></dl>${selected.type === 'operation' ? `<div class="operation-tags"><span>${selected.confirmationRequired ? '写操作 · 必须确认' : '无需确认'}</span><span>${selected.maxCalls===undefined?'调用上限：当前范式未声明':'单任务最多 '+esc(selected.maxCalls)+' 次'}</span><span>${selected.terminal ? '可结束任务' : '不自动结束任务'}</span></div><h3>输入与输出契约</h3><pre>${esc(json({ input: selected.inputSchema ?? selected.input, output: selected.outputSchema ?? selected.output, execution: selected.execution, script: selected.script }))}</pre><p>凭据仅由运行环境提供；本页不保存密钥。确认规则与输入校验仍由执行端校验。</p>` : ''}${selected.operations ? `<h3>允许操作</h3><p>${esc(selected.operations.join('、') || '尚未选择')}</p>` : ''}<button data-open-file="${esc(selected.source)}">查看 / 简单修改代码与契约</button><button data-tab="flow">配置调用条件与流程</button>` : '<p>先装配能力，再配置调用条件。</p>'}</section></div>${c().editable ? `<section class="panel"><h2>添加能力</h2><p>${c().project.family==='deepagent'?'当前DeepAgent可装配业务Skill与CORE文件工具；Agent/A2A尚未接通。':'业务 Skill 和 A2A Agent 可在现有执行方式中配置。'}HTTP、MCP 和新增脚本先保存接入草稿；未实现适配器前不能作为可运行候选。</p><button data-config-section="skill-settings">添加业务 Skill</button>${c().project.family==='deepagent'?'<button disabled title="当前模板执行器未接通">Agent / A2A · 未接通</button>':'<button data-config-section="agent-settings">挂载 Agent / A2A</button>'}<form id="capability-draft"><label>接入标识<input name="id" required pattern="[a-z][a-z0-9-]{0,63}"></label><label>接入方式<select name="execution"><option>HTTP</option><option>MCP</option><option>SCRIPT</option></select></label><label>用途及契约说明<textarea name="description" required></textarea></label><button>保存待接线草稿</button></form></section>` : ''}`; }
    function reports() { const s = state(), current = s.reports.find(x => x.head === c().project.head); return `<section class="panel"><div class="section-title"><div><h2>结构检查与技术候选</h2><p class="muted">检查已保存文件、引用、Python 语法和确认约束；不调用模型，不证明业务验收通过。</p></div>${c().editable ? `<button data-panel-action="check" class="primary" ${c().dirty ? 'disabled' : ''}>检查保存版本</button>` : ''}</div>${c().dirty ? '<p class="warning">有未保存草稿，请保存后再检查。</p>' : ''}<p>当前版本：<code>${esc(c().project.head.slice(0, 12))}</code> · ${current ? current.passed ? '结构检查通过；业务未验证' : '结构检查未通过' : '尚无检查报告'}</p><div class="check-reports">${s.reports.map(r => `<details ${r.id === current?.id ? 'open' : ''}><summary>${r.passed ? '结构通过' : '结构未通过'} · ${esc(r.head.slice(0, 12))} ${r.stale ? '· 旧版本' : ''} · ${esc(r.createdAt)}</summary><ul>${r.items.map(x => `<li class="${x.passed ? '' : 'warning'}">${x.passed ? '✓' : '×'} ${esc(x.code)} · ${esc(x.name + "：" + x.detail)}</li>`).join('')}</ul><small>报告 ${esc(r.id)} · 业务未验证</small></details>`).join('') || '<p>尚无检查记录。</p>'}</div>${c().editable && c().project.kind === 'application' ? `<button data-panel-action="candidate" ${!current?.passed || c().dirty ? 'disabled' : ''}>保存源码技术候选</button>` : ''}<h3>固定候选</h3>${s.candidates.map(x => `<article class="candidate-card"><strong>${esc(x.id)}</strong><p>源码 ${esc(x.head.slice(0, 12))} · ${x.stale ? '旧版本候选' : '当前版本候选'} · 结构检查通过 · 业务未验证 · 未发布</p><small>检查报告 ${esc(x.checkId)}</small></article>`).join('') || '<p>尚无技术候选。候选固定源码与检查报告，不等于构建制品。</p>'}<button data-tab="runs">进入真实调试与 Trace</button>${c().project.kind === 'application' ? '<button data-tab="delivery">版本与发布 / 制品导出</button>' : ''}</section><section class="panel"><h2>预期路由示例</h2><p>用于编排图的精确示例匹配，不是意图分类器；真实语义需运行验证。</p><pre>${esc(c().effectiveFiles['tests/routing-examples.json'] ?? '尚无示例')}</pre>${c().editable ? `<form id="routing-example"><label>用户请求<input name="query" required></label><label>预期去向<select name="action"><option>SKILL</option><option>DELEGATE</option><option>HANDOFF</option><option>CLARIFY</option><option>CONTINUE</option></select></label><label>目标 Skill / Agent 标识<input name="target"></label><button>添加预期示例到草稿</button></form>` : ''}<button data-tab="flow">查看路径预演</button></section>`; }
    function guidance() { const paths = Object.keys(c().effectiveFiles).filter(x => x.startsWith('.opencode/skills/') && x.endsWith('/SKILL.md')); return `<section class="panel"><h2>范式开发 Skill</h2><p>这些文件将当前模板的开发范式、开放边界和关联修改规则提供给 OpenCode。应用业务 Skill 是运行时指导，两者不是同一个对象。</p>${paths.map(path => `<article><h3>${esc(path.split('/').at(-2))}</h3><pre class="skill-description">${esc(c().effectiveFiles[path])}</pre><button data-open-file="${esc(path)}">查看与修改开发指导</button></article>`).join('') || '<p>当前工程尚无开发 Skill。</p>'}<button data-tab="coding">根据范式指导编排</button><h3>开放范围</h3><p>应用可修改 application.json、instructions.md、skills、adapters、tests；核心 Java 和模板开发 Skill 由平台角色维护。实际可修改路径以服务端授权为准。</p></section>`; }
    function activity() { const s = state(); return `<section class="panel"><div class="section-title"><h2>工程活动</h2><button data-panel-action="refresh">刷新记录</button></div><p class="muted">来自真实 Git 提交与结构检查记录。Coding 任务及运行记录分别保留，不合成为虚构活动。</p>${s.events.map(x => `<article class="candidate-card"><strong>${esc(x.title ?? x.type)}</strong><p>${esc(x.head?.slice(0, 12) ?? '')} · ${esc(x.createdAt ?? '')}</p></article>`).join('') || '<p>正在读取工程记录…</p>'}<button data-tab="coding">Coding 任务与差异审阅</button><button data-tab="history">运行与只读回放</button></section>`; }
    function reportBody(){const html=reports();return c().project.family==='deepagent'?html.split('<section class="panel"><h2>预期路由示例</h2>')[0]+'<section class="panel"><h2>业务验收样例</h2><p>按当前业务范围与装配Skill准备测试输入；核对每轮先加载Skill、只调用允许工具，以及交付物与原始事实一致。增量修改还需核对未涉及内容保留。</p><p>结构检查不执行模型；DeepAgent首版不进行MOA意图路由预演。</p><button data-open-file="README.md">查看示例与边界</button></section>':html;}
    function render(view) { return `<div id="panels-host" data-panel-view="${view}">${view === 'capabilities' ? capabilities() : view === 'checks' ? reportBody() : view === 'guidance' ? guidance() : activity()}</div>`; }
    async function refresh() { const now = c(); if (!now)
        return; const n = ++token, id = now.project.id; const values = await Promise.all([host.api('/projects/' + id + '/checks'), host.api('/projects/' + id + '/candidates'), host.api('/projects/' + id + '/activity')]); if (n !== token || c()?.project.id !== id || c()?.role !== now.role || c()?.project.head !== now.project.head)
        return; Object.assign(state(), { reports: values[0].reports, candidates: values[1].candidates, events: values[2].events }); const el = document.getElementById('panels-host'); if (el && ['checks', 'activity'].includes(el.dataset.panelView))
        el.innerHTML = el.dataset.panelView === 'checks' ? reportBody() : activity(); if(['checks','activity'].includes(el?.dataset.panelView))WorkbenchJourney.mount(); }
    function mount(view) { if (['checks', 'activity'].includes(view))
        refresh().catch(e => host.notify(e.message)); }
    function init(callbacks) { host = callbacks; document.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !c())
        return; if (b.dataset.capFilter) {
        state().filter = b.dataset.capFilter;
        host.render();
    }
    else if (b.dataset.capSelect) {
        state().selected = b.dataset.capSelect;
        host.render();
    }
    else if (b.dataset.panelAction)
        host.action(async () => { const id = c().project.id; if (b.dataset.panelAction === 'check') {
            if (c().dirty)
                throw Error('请先保存草稿');
            await host.api('/projects/' + id + '/checks', 'POST', {});
        } if (b.dataset.panelAction === 'candidate') {
            const r = state().reports.find(x => x.head === c().project.head && x.passed);
            if (!r)
                throw Error('请先检查当前保存版本');
            await host.api('/projects/' + id + '/candidates', 'POST', { checkId: r.id });
        } await refresh(); }); }); document.addEventListener('submit', e => { const id = e.target.id; if (!['capability-draft', 'routing-example'].includes(id))
        return; e.preventDefault(); host.action(async () => { if (!c().editable)
        throw Error('当前工程只读'); const v = Object.fromEntries(new FormData(e.target)); if (id === 'capability-draft') {
        const d = JSON.parse(c().effectiveFiles['application.json']);
        if (assets().some(x => x.id === v.id))
            throw Error('标识已存在');
        d.capabilities.push({ ...v, type: 'tool', status: 'draft' });
        host.patch({ 'application.json': json(d) });
    }
    else {
        let t;
        try {
            t = JSON.parse(c().effectiveFiles['tests/routing-examples.json'] ?? '{"cases":[]}');
        }
        catch {
            throw Error('请先修复示例JSON');
        }
        if (t.cases.some(x => x.query.trim() === v.query.trim()))
            throw Error('该请求已有预期示例，请在文件中修改');
        t.cases.push(v);
        host.patch({ 'tests/routing-examples.json': json(t) });
    } host.render(); host.notify('已加入草稿，请保存后检查'); }); }); }
    return { init, render: (view, context) => { try {
            return render(view, context);
        }
        catch {
            return '<section class="warning">业务定义无法解析。<button data-open-file="application.json">打开定义文件</button></section>';
        } }, mount };
})();
