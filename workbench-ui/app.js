'use strict';
const $ = s => document.querySelector(s), esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let role = 'application', projects = [], releases = [], current = null, tab = 'overview', file = 'instructions.md', epoch = 0, busy = false;
const drafts = new Map();
const buildKey = 'openjiuwen-workbench-live-ui-build';
let build = null;
function stale() { return build !== null && localStorage.getItem(buildKey) !== build; }
window.addEventListener('storage', e => { if (e.key === buildKey && stale())
    notify('页面版本已更新。请保留未保存内容，刷新后再操作。'); });
function notify(message) { $('#notice').textContent = message; $('#notice').style.display = 'block'; clearTimeout(notify.timer); notify.timer = setTimeout(() => $('#notice').style.display = 'none', 7000); }
async function api(path, method = 'GET', body) { if (method !== 'GET' && stale())
    throw Error('当前页面已过期，请保留草稿并刷新后操作'); const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'x-workbench-role': role }, body: body === undefined ? undefined : JSON.stringify(body) }); const value = await r.json(); if (!r.ok)
    throw Error(value.error?.message ?? '请求失败'); return value; }
function draft() { if (!current)
    return null; if (!drafts.has(current.project.id))
    drafts.set(current.project.id, { baseHead: current.project.head, changes: {} }); return drafts.get(current.project.id); }
function content(path) { if (!editable())
    return current.files[path] ?? ''; const d = draft(); return Object.hasOwn(d.changes, path) ? d.changes[path] : current.files[path] ?? ''; }
function setDraft(path, value) { const d = draft(); if (value === current.files[path])
    delete d.changes[path];
else
    d.changes[path] = value; $('#draft-count').textContent = Object.keys(d.changes).length + ' 个文件待保存'; }
function editable() { return current && (role === 'platform' ? current.project.kind === 'template' : current.project.kind === 'application'); }
async function load() { const token = ++epoch; const [p, r] = await Promise.all([api('/projects'), api('/templates')]); if (token !== epoch)
    return; projects = p.projects; releases = r.releases; render(); }
async function open(id) { const token = ++epoch; const value = await api('/projects/' + encodeURIComponent(id)); if (token !== epoch)
    return; current = value; file = 'instructions.md'; tab = 'overview'; render(); }
function shell(body) { $('#global-nav').innerHTML = `<button data-action="home">${role === 'platform' ? '开发模板与应用诊断' : '我的应用'}</button>`; $('#workspace').innerHTML = body; }
function render() { if (!current)
    return home(); const p = current.project, d = draft(); shell(`<div class="toolbar"><div><button data-action="home">← ${role === 'platform' ? '模板与应用' : '全部应用'}</button><h1>${esc(p.name)}</h1><span class="badge">${p.kind === 'template' ? 'MOA 开发模板' : editable() ? '应用工程' : '应用诊断 · 只读'}</span></div><select class="project-switch" id="project-switch" aria-label="切换工程">${projects.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div><div class="row"><code>已保存版本 ${esc(p.head.slice(0, 12))}</code><span id="draft-count">${Object.keys(d.changes).length} 个文件待保存</span>${editable() ? '<button data-action="save" class="primary">保存所有修改</button><button data-action="discard">放弃草稿</button>' : ''}</div>${d.baseHead !== p.head ? '<p class="warning">工程版本已变化。请先复制保留草稿，再放弃草稿并基于新版本修改。</p>' : ''}<div class="tabs">${[['overview', '工程概览'], ['files', '文件与指令'], ...(p.kind === 'template' ? [['release', '模板发行']] : []), ['runs', '调试运行']].map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</div>${view()}`); }
function home() { shell(`<div class="toolbar"><div><h1>${role === 'platform' ? '开发模板与应用诊断' : '我的应用'}</h1><p class="muted">${role === 'platform' ? '维护开发范式并发行模板；应用工程以只读方式诊断。' : '从已发行的 MOA 模板创建应用，再定义业务范围、Skill 和转交 Agent。'}</p></div></div>${role === 'application' ? `<section class="panel"><h2>从 MOA 模板创建应用</h2>${releases.length ? `<form id="create"><div class="field"><label for="name">应用名称</label><input id="name" name="name" required maxlength="120" placeholder="例如：i豆福利助手"></div><div class="field"><label for="release">模板版本</label><select name="releaseId" id="release">${releases.map(r => `<option value="${esc(r.id)}">MOA · ${esc(r.version)} · ${esc(r.commit.slice(0, 8))}</option>`).join('')}</select></div><button class="primary">创建空白应用</button></form>` : '<p>尚无已发行模板。请切换至平台开发者，检查 MOA 模板并发行版本。</p>'}</section>` : ''}<div class="grid">${projects.map(p => `<section class="panel"><span class="badge">${p.kind === 'template' ? '开发模板' : '应用'}</span><h2>${esc(p.name)}</h2><p class="muted">版本 ${esc(p.head.slice(0, 12))}</p><button data-open="${esc(p.id)}">${role === 'platform' && p.kind === 'application' ? '查看诊断' : '进入工程'}</button></section>`).join('') || '<section class="panel">尚未创建应用。新应用不会预置 i豆业务。</section>'}</div>`); }
function view() {
    if (tab === 'overview')
        return `<section class="panel"><h2>业务与工程</h2><p>${esc(current.definition.description || '尚未定义业务。使用文件编辑或后续 Coding 助手补充当前应用。')}</p><p>业务范围、挂载 Skill、Agent 与任务切换策略统一保存在 application.json；System Prompt 保存在 instructions.md。</p><p>Skill 在当前任务中执行；转交 Agent 可以形成第二层任务。首期含当前任务共两层：A→B，只恢复 A。</p><p class="muted">当前入口已连接真实 Git 工程。编码审阅、业务配置图、任务交互和回放页面尚在接入，不能以此页替代完整 Demo 验收。</p></section>`;
    if (tab === 'files') {
        const paths = Object.keys(current.files).sort((a, b) => Number(current.editablePaths.includes(b)) - Number(current.editablePaths.includes(a)) || a.localeCompare(b));
        if (!paths.includes(file))
            file = paths[0];
        return `<div class="files"><section class="panel file-list">${paths.map(f => `<button data-file="${esc(f)}" class="${file === f ? 'active' : ''}">${esc(f)}${current.editablePaths.includes(f) ? '' : ' · 只读'}</button>`).join('')}</section><section class="panel"><label for="editor">${esc(file)}</label><textarea id="editor" class="editor" spellcheck="false" ${current.editablePaths.includes(file) ? '' : 'readonly'}>${esc(content(file))}</textarea><p class="muted">修改暂存在当前页面，切换工程或身份不会丢失。关闭或刷新页面前请保存。</p></section></div>`;
    }
    if (tab === 'release')
        return `<section class="panel"><h2>发行不可变模板版本</h2><p>发行已保存的工程提交。既有应用保持原模板来源，新应用选择新版本。</p><form id="publish"><div class="field"><label for="version">版本号</label><input name="version" id="version" required placeholder="例如 1.0.0"></div><button class="primary" ${Object.keys(draft().changes).length ? 'disabled' : ''}>发行模板</button></form></section>`;
    return '<section class="panel"><h2>调试运行</h2><p>构建与 Java 运行 API 已实现。此页面的运行控制、会话、Trace 与只读回放正在接入。</p><button data-action="run-list">查看实际运行记录</button><div id="run-list"></div></section>';
}
async function save() { const d = draft(); if (!Object.keys(d.changes).length)
    return notify('没有待保存的修改'); const id = current.project.id; await api('/projects/' + id + '/files', 'PUT', d); drafts.delete(id); current = await api('/projects/' + id); render(); notify('已提交工程版本'); }
async function action(fn) { if (busy)
    return; busy = true; $('#identity').disabled = true; try {
    await fn();
}
catch (e) {
    notify(e.message);
}
finally {
    busy = false;
    $('#identity').disabled = false;
} }
$('#identity').onchange = () => action(async () => { epoch++; role = $('#identity').value; current = null; await load(); });
document.addEventListener('click', e => { const b = e.target.closest('button'); if (!b)
    return; action(async () => { if (b.dataset.open)
    return open(b.dataset.open); if (b.dataset.tab) {
    tab = b.dataset.tab;
    return render();
} if (b.dataset.file) {
    file = b.dataset.file;
    return render();
} switch (b.dataset.action) {
    case 'home':
        current = null;
        return load();
    case 'save': return save();
    case 'discard':
        if (confirm('放弃当前工程全部未保存修改？')) {
            drafts.delete(current.project.id);
            render();
        }
        break;
    case 'run-list': {
        const { runs } = await api('/projects/' + current.project.id + '/runs');
        $('#run-list').innerHTML = runs.map(r => `<p><code>${esc(r.id)}</code> · ${esc(r.status)} · ${esc(r.head.slice(0, 12))}</p>`).join('') || '<p>没有运行记录。</p>';
    }
} }); });
document.addEventListener('input', e => { if (e.target.id === 'editor')
    setDraft(file, e.target.value); });
document.addEventListener('change', e => { if (e.target.id === 'project-switch')
    action(() => open(e.target.value)); });
document.addEventListener('submit', e => { e.preventDefault(); const form = e.target; action(async () => { if (form.id === 'create') {
    const v = Object.fromEntries(new FormData(form));
    const { project } = await api('/projects', 'POST', v);
    await load();
    await open(project.id);
    notify('已从 MOA 发行版创建空白应用');
} if (form.id === 'publish') {
    await api('/templates/' + current.project.id + '/releases', 'POST', Object.fromEntries(new FormData(form)));
    await load();
    notify('模板版本已发行');
} }); });
window.addEventListener('beforeunload', e => { if ([...drafts.values()].some(d => Object.keys(d.changes).length)) {
    e.preventDefault();
    e.returnValue = '';
} });
async function boot() { const context = await api('/context'); build = context.uiVersion; if (localStorage.getItem(buildKey) !== build) {
    for (const key of Object.keys(localStorage)) {
        if (/^openjiuwen-workbench-v2-demo-\d+$/.test(key))
            localStorage.removeItem(key);
    }
    localStorage.setItem(buildKey, build);
} await load(); }
boot().catch(e => notify(e.message));
