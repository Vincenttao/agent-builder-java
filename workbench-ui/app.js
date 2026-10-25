'use strict';
const $ = s => document.querySelector(s), esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let role = 'application', projects = [], releases = [], current = null, tab = 'overview', file = 'instructions.md', epoch = 0, busy = false;
const drafts = new Map();const familyName=p=>p?.family==='deepagent'?'DeepAgent':'MOA';
const buildKey = 'openjiuwen-workbench-live-ui-build';
let build = null, workspaceId=null,modelInfo=null;
const localUI={read:(id,actor,name,fallback)=>WorkbenchPersistence.read(id,actor,name,fallback),write:(id,actor,name,value)=>WorkbenchPersistence.write(id,actor,name,value)};
const draftKey=()=>role+'|'+current.project.id;
function stale() { return WorkbenchPersistence.stale(); }
window.addEventListener('storage', e => { if (e.key === buildKey && stale())
    notify('页面版本已更新。请保留未保存内容，刷新后再操作。'); });
function notify(message) { $('#notice').textContent = message; $('#notice').style.display = 'block'; clearTimeout(notify.timer); notify.timer = setTimeout(() => $('#notice').style.display = 'none', 7000); }
async function api(path, method = 'GET', body, requestRole = role) { if (method !== 'GET' && stale())
    throw Error('当前页面已过期，请保留草稿并刷新后操作'); const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'x-workbench-role': requestRole, ...(build?{'x-workbench-ui-build':build}:{}),...(workspaceId?{'x-workbench-workspace':workspaceId}:{}) }, body: body === undefined ? undefined : JSON.stringify(body) }); if(r.status===204)return null;const value = await r.json(); if (!r.ok){const error=Error(value.error?.message ?? '请求失败');error.code=value.error?.code;throw error;}return value; }
function draft() {
 if(!current)return null;const k=draftKey();
 if(!drafts.has(k))drafts.set(k,WorkbenchPersistence.loadDraft(current.project.id,role)??{baseHead:current.project.head,changes:{},cacheTag:null,cached:true});
 const d=drafts.get(k);if(!Object.keys(d.changes).length)d.baseHead=current.project.head;return d;
}
function effectiveFiles() { return editable() ? Object.fromEntries(Object.entries({...current.files,...draft().changes}).filter(([,value])=>value!==null)) : current.files; }
function canEdit(path) { if(current?.project.kind==='application'&&current.contract?.editablePrefixes&&!current.contract.editablePrefixes.some(prefix=>prefix.endsWith('/')?path.startsWith(prefix):path===prefix))return false;return editable() && (current.editablePaths.includes(path) || (Object.hasOwn(draft().changes,path) && (current.project.kind==='template' || /^(skills|adapters|tests)\//.test(path)))); }
function patch(changes) { for(const [path,value] of Object.entries(changes)) setDraft(path,value); }
function content(path) { if (!editable())
    return current.files[path] ?? ''; const d = draft(); return Object.hasOwn(d.changes, path) ? d.changes[path] : current.files[path] ?? ''; }
function setDraft(path, value) { const d = draft(); if (value === current.files[path])
    delete d.changes[path];
else
    d.changes[path] = value; Object.assign(d,WorkbenchPersistence.saveDraft(current.project.id,role,d));WorkbenchJourney.repaint();$('#draft-count').textContent = Object.keys(d.changes).length + ' 个文件待保存'+(d.cached?' · 已在本机暂存':' · 未缓存');const dirty=Object.keys(d.changes).length>0;const submit=$('#coding-start button');if(submit)submit.disabled=dirty;const warning=$('#coding-dirty-warning');if(warning)warning.hidden=!dirty; }
function editable() { return current && (role === 'platform' ? current.project.kind === 'template' : current.project.kind === 'application'); }
async function load() { const token = ++epoch; const [p, r] = await Promise.all([api('/projects'), api('/templates')]); if (token !== epoch)
    return; projects = p.projects; releases = r.releases; render(); }
async function open(id) { const token = ++epoch; const value = await api('/projects/' + encodeURIComponent(id)); if (token !== epoch)
    return; current=value;const position=localUI.read(id,role,'position',{});file=typeof position.file==='string'?position.file:'instructions.md';tab=['overview','files','configuration','flow','capabilities','checks','history','guidance','activity','coding','runs',...(current.project.kind==='template'?['release']:['delivery'])].includes(position.tab)?position.tab:'overview';render(); }
function codingContext() {return current?{project:current.project,files:current.files,releases,assetOrigins:current.assetOrigins,contract:current.contract,sourceRelease:current.sourceRelease,templateMetadata:current.templateMetadata,journey:current.journey,effectiveFiles:effectiveFiles(),role,modelInfo,historyOnly:tab==='history',editable:editable(),dirty:editable()&&Object.keys(draft().changes).length>0}:null;}
function shell(body) {
 const platform=role==='platform';
 $('#role-caption').textContent=platform?'平台开发':'应用开发';
 $('#breadcrumb').innerHTML=`企业空间 <span>/</span> ${platform?'平台开发':'应用'}${current?` <span>/</span> <strong>${esc(current.project.name)}</strong>`:''}`;
 $('#global-nav').innerHTML=platform?`<button data-action="home" class="${!current?'active':''}">开发模板与应用诊断</button><div class="nav-label">切换模板 · 在工程内维护</div><select id="template-switch" aria-label="切换开发模板">${projects.filter(p=>p.kind==='template').map(p=>`<option title="${esc(p.name)}" value="${esc(p.id)}" ${current?.project.id===p.id?'selected':''}>${esc(familyName(p))} 模板</option>`).join('')}</select>${[['guidance','开发 Skill'],['activity','工程活动']].map(([id,label])=>`<button data-action="template" data-target-tab="${id}" class="${current?.project.kind==='template'&&tab===id?'active':''}">${label}</button>`).join('')}`:`<button data-action="home" class="active">▦　我的应用</button>`;
 $('#workspace').innerHTML=body;
 if(current&&tab==='configuration')WorkbenchConfiguration.restrict(current.contract);
 if(current&&tab==='configuration')WorkbenchConfiguration.focus(localUI.read(current.project.id,role,'configuration-section','scope-settings'));
 if(current)WorkbenchPanels.mount(tab);
 if(current)WorkbenchJourney.mount();
 if(current&&tab==='release')WorkbenchRelease.mount();
 if(current)WorkbenchCoding.mount();else WorkbenchCoding.unmount();
 if(['runs','history'].includes(tab)&&current)WorkbenchRuntime.mount();else WorkbenchRuntime.unmount();
 if(tab==='delivery'&&current)WorkbenchDelivery.mount();else WorkbenchDelivery.unmount();
}
function render() {
 localUI.write('',role,'navigation',{projectId:current?.project.id??null});if(current)localUI.write(current.project.id,role,'position',{tab,file});
 if(!current)return home();const p=current.project,d=editable()?draft():{baseHead:p.head,changes:{}};
 shell(`<section class="project-header"><div class="project-title"><button class="back-link" data-action="home">← ${role==='platform'?'模板与应用':'全部应用'}</button><div class="title-line"><h1>${esc(p.name)}</h1><span class="badge">${p.kind==='template'?familyName(p)+' 开发模板':editable()?'应用工程':'应用诊断 · 只读'}</span></div><p class="muted">${p.kind==='template'?'维护开发范式，定义应用可装配的能力与开发指导。':'基于 '+familyName(p)+' 模板开发 · 配置、代码与运行各自绑定版本'}</p></div><div class="project-actions"><select class="project-switch" id="project-switch" aria-label="切换工程">${projects.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><div class="row"><code title="${esc(p.head)}">版本 ${esc(p.head.slice(0,12))}</code><span id="draft-count">${Object.keys(d.changes).length} 个文件待保存</span>${editable()?`<button data-action="save" class="primary" ${d.baseHead!==p.head?'disabled':''}>保存所有修改</button><button data-action="discard">放弃草稿</button>`:''}</div></div></section>
 <nav class="tabs app-tabs" aria-label="当前工程导航">${[['overview','概览'],['configuration','开发'],['checks','测试'],['history','运行记录'],[p.kind==='template'?'release':'delivery',p.kind==='template'?'模板发行':'版本与发布']].map(([id,label])=>`<button data-tab="${id}" class="${tab===id||id==='configuration'&&['flow','capabilities','files','coding','guidance'].includes(tab)||id==='checks'&&tab==='runs'?'active':''}">${label}</button>`).join('')}</nav>
 ${['configuration','capabilities','flow','files','coding','guidance'].includes(tab)?`<nav class="tabs develop-tabs" aria-label="开发内容">${[['configuration',p.kind==='template'?'模板设置':'应用设置'],['capabilities',p.kind==='template'?'公共能力':'能力'],['flow','编排'],['files','文件与指令'],['coding','Coding 助手'],...(p.kind==='template'?[['guidance','开发 Skill']]:[])].map(([id,label])=>`<button data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('')}</nav>`:''}
 ${['checks','runs'].includes(tab)?`<nav class="tabs develop-tabs" aria-label="测试内容"><button data-tab="checks" class="${tab==='checks'?'active':''}">结构检查与候选</button><button data-tab="runs" class="${tab==='runs'?'active':''}">调试运行</button></nav>`:''}
 <div class="work-layout"><section class="canvas-main" aria-label="工程工作区">${d.baseHead!==p.head?'<p class="warning">工程版本已变化。请先复制保留草稿，再放弃草稿并基于新版本修改。</p>':''}<div id="journey-banner">${WorkbenchJourney.banner(codingContext())}</div>${view()}</section>${WorkbenchCoding.dock(codingContext(),tab==='coding')}</div>`);
}
function home() {
 const platform=role==='platform';shell(`<div class="directory"><div class="directory-head"><div><div class="eyebrow">${platform?'PLATFORM WORKSPACE':'APPLICATION WORKSPACE'}</div><h1>${platform?'开发模板与应用诊断':'我的应用'}</h1><p class="muted">${platform?'维护开发范式、发行模板，并协助定位应用问题。':'选择适合业务的开发模板，和 Coding Agent 一起构建应用。'}</p></div><span class="badge">${projects.length} 个${platform?'工程':'应用'}</span></div>
 ${!platform?`<section class="panel create-panel"><div><div class="template-icon">◈</div><h2>从开发模板创建应用</h2><p class="muted">MOA：装配业务与Agent；DeepAgent：独立目标与文件交付</p></div>${releases.length?`${WorkbenchJourney.picker(releases)}<form id="create"><div class="field"><label for="name">应用名称</label><input id="name" name="name" required maxlength="120" placeholder="例如：材料整理助手"></div><div class="field"><label for="release">模板版本</label><select name="releaseId" id="release">${releases.map(r=>`<option value="${esc(r.id)}" ${r.developmentMode==='legacy-trial'?'disabled':''}>${r.developmentMode==='legacy-trial'?'历史试作 · ':''}${esc(r.templateName??'MOA')} · ${esc(r.version)} · ${esc(r.commit.slice(0,8))}</option>`).join('')}</select></div><div class="field goal-field"><label for="goal">业务目标</label><textarea id="goal" name="goal" maxlength="12000" placeholder="例如：查询员工积分，兑换前让用户确认。创建后交给 Coding 助手制定开发方案。"></textarea><small>先创建空业务工程；不会自动加入任何示例 Skill。</small></div><button class="primary">创建应用</button></form>`:'<p>尚无已发行模板。请切换至平台开发者，检查 MOA 模板并发行版本。</p>'}</section>`:''}
 <div class="section-title"><h2>${platform?'模板与应用':'已有应用'}</h2><span class="muted">工程按保存版本管理</span></div><div class="grid applications-grid">${projects.map(p=>`<section class="panel project-card"><div class="card-meta"><span class="template-icon">${p.kind==='template'?'◈':'▦'}</span><span class="badge">${p.kind==='template'?'开发模板':releases.some(r=>r.id===p.sourceReleaseId&&r.developmentMode==='legacy-trial')?'历史试作 · 旧模板':'应用'}</span></div><h2>${esc(p.name)}</h2><p class="muted">${p.kind==='template'?'范式代码、开放契约与开发 Skill':'业务配置、Skill 与挂载 Agent'}</p><div class="card-bottom"><code>${esc(p.head.slice(0,12))}</code><button data-open="${esc(p.id)}">${platform&&p.kind==='application'?'查看诊断':'进入工程'}</button></div></section>`).join('')||'<section class="panel">尚未创建应用。新应用不会预置 i豆业务。</section>'}</div></div>`);
}
function overview(){const d=current.definition,j=current.journey;const stages=[['01','业务定义',d.scope.own.length+d.scope.delegated.length>0?'已定义业务范围':'待补充业务范围','configuration'],['02','能力与编排',d.skills.length?'已有Skill定义，待检查调用条件':'待装配业务Skill','flow'],['03','检查与运行',j?.check?(j.check.passed?'当前结构通过，业务待验证':'当前结构未通过'):'当前保存版本待检查','checks'],['04','固定版本交付',j?.export?'已有同版本技术包，企业发布待核验':j?.run?'已有同版本运行，可核对后导出':'待运行并固定交付来源','delivery']];return `<section class="panel"><h2>开发进度与下一步</h2><div class="stage-cards">${stages.filter(x=>current.project.kind==='application'||x[3]!=='delivery').map(([n,title,status,target])=>`<article><small>${n}</small><h3>${title}</h3><p>${status}</p><button data-tab="${target}">${target==='configuration'?'完善应用设置':target==='flow'?'查看编排':target==='checks'?'检查当前版本':'进入交付'}</button></article>`).join('')}</div><p class="muted">模板来源 ${esc(current.sourceRelease?current.sourceRelease.templateName+' · '+current.sourceRelease.version:familyName(current.project)+'范式工程')} · 未保存草稿不计为可交付版本。</p></section>`+ `<div class="section-title"><div><h2>${current.project.kind==='template'?'范式工作区':'应用工作区'}</h2><p class="muted">先定义业务，再装配能力；保存后进入调试验证。</p></div><span class="badge">${current.project.kind==='template'?'平台维护':'应用开发'}</span></div><div class="overview-stats">${[['业务 Skill',d.skills.length,'configuration'],['已挂载 Agent',d.capabilities.filter(c=>c.type==='agent').length,'configuration'],['任务层数','A → B','flow']].map(([label,value,target])=>`<button data-tab="${target}"><span>${label}</span><strong>${value}</strong><small>查看配置 ↗</small></button>`).join('')}</div><div class="overview-path"><span>01　业务与范围</span><i>→</i><span>02　能力与编排</span><i>→</i><span>03　调试与轨迹</span><i>→</i><span>04　固定版本交付</span></div>`;}
function view() {
    if(current.project.family==='deepagent'&&['overview','configuration','flow'].includes(tab))return (tab==='overview'?'<div id="journey-progress">'+WorkbenchJourney.progress(codingContext())+'</div>'+WorkbenchJourney.source(codingContext()):'')+WorkbenchDeep.render(tab,codingContext())+(tab==='configuration'?WorkbenchJourney.model(codingContext()):'');
    if(['capabilities','checks','guidance','activity'].includes(tab))return WorkbenchPanels.render(tab,codingContext());
    if(tab==='delivery')return WorkbenchDelivery.render(codingContext());
    if(['runs','history'].includes(tab))return WorkbenchRuntime.render(codingContext());
    if(tab==='coding')return WorkbenchCoding.render(codingContext());
    if(tab==='configuration') return WorkbenchConfiguration.render(effectiveFiles(),!editable())+WorkbenchJourney.model(codingContext());
    if(tab==='flow') return WorkbenchDesign.flow();
    if (tab === 'overview')
        return '<div id="journey-progress">'+WorkbenchJourney.progress(codingContext())+'</div>'+WorkbenchJourney.source(codingContext())+overview()+ `<section class="panel"><h2>业务与工程</h2><p>${esc(current.definition.description || '尚未定义业务。使用文件编辑或后续 Coding 助手补充当前应用。')}</p><p>业务范围、挂载 Skill、Agent 与任务切换策略统一保存在 application.json；System Prompt 保存在 instructions.md。</p><p>Skill 在当前任务中执行；转交 Agent 可以形成第二层任务。首期含当前任务共两层：A→B，只恢复 A。</p><p class="muted">代码与配置保存在工程中；运行固定在启动版本。右侧 Coding Agent 依据当前角色的开发 Skill 提出可审阅修改，建议不会自动改变工程。</p></section>`;
    if (tab === 'files') {
        const paths = Object.keys(effectiveFiles()).sort((a, b) => Number(canEdit(b)) - Number(canEdit(a)) || a.localeCompare(b));
        if (!paths.includes(file))
            file = paths[0];
        return `<div class="files"><section class="panel file-list">${paths.map(f => `<button data-file="${esc(f)}" title="${esc(f)}" aria-label="${esc(f)}${canEdit(f)?'':' · 只读'}" class="${file===f?'active':''}"><span class="file-name">${esc(f.split('/').at(-1))}${canEdit(f)?'':' · 只读'}</span>${f.includes('/')?`<small>${esc(f.slice(0,f.lastIndexOf('/')))}</small>`:''}</button>`).join('')}</section><section class="panel"><label for="editor">${esc(file)}</label><textarea id="editor" class="editor" spellcheck="false" ${canEdit(file) ? '' : 'readonly'}>${esc(content(file))}</textarea><p class="muted">同一界面版本内可恢复本机草稿；它尚未保存为 Git 版本。界面升级或关闭前请保存到工程。</p></section></div>`;
    }
    if (tab === 'release')return WorkbenchRelease.render(codingContext());
    return '<section class="panel">请选择工程功能。</section>';
}
async function save(){const d=draft();if(!Object.keys(d.changes).length)return notify('没有待保存的修改');if(d.baseHead!==current.project.head)throw Error('草稿基础版本已变化，请先核对并保留内容');const id=current.project.id;await api('/projects/'+id+'/files','PUT',{baseHead:d.baseHead,changes:d.changes});WorkbenchPersistence.clearDraft(id,role,d);current=await api('/projects/'+id);drafts.set(draftKey(),{baseHead:current.project.head,changes:{},cacheTag:null,cached:true});render();notify('已提交工程版本');}
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
$('#identity').onchange = () => action(async () => { epoch++; role = $('#identity').value;localUI.write('','shared','role',role); current = null; await load(); });
document.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !(b.dataset.open || b.dataset.tab || b.dataset.file || b.dataset.configSection || b.hasAttribute('data-config-expand') || b.dataset.openFile || b.dataset.action))
    return; action(async () => { if(b.hasAttribute('data-config-expand')){localUI.write(current.project.id,role,'configuration-section','all');WorkbenchConfiguration.focus('all');return;} if(b.dataset.openFile){tab='files';file=b.dataset.openFile;return render();} if(b.dataset.configSection) {localUI.write(current.project.id,role,'configuration-section',b.dataset.configSection);tab='configuration';render();document.getElementById(b.dataset.configSection)?.scrollIntoView({block:'start'});return;} if (b.dataset.open)
    return open(b.dataset.open); if (b.dataset.tab) {
    tab = b.dataset.tab;
    return render();
} if (b.dataset.file) {
    file = b.dataset.file;
    return render();
} switch (b.dataset.action) {
    case 'template': {const target=projects.find(p=>p.kind==='template'&&p.id===current?.project.id)??projects.find(p=>p.kind==='template');if(!target)throw Error('尚无开发模板');await open(target.id);tab=b.dataset.targetTab;return render();}
    case 'home':
        current = null;
        return load();
    case 'save': return save();
    case 'discard':
        if (confirm('放弃当前工程全部未保存修改？')) {
            WorkbenchPersistence.clearDraft(current.project.id,role,draft());drafts.set(draftKey(),{baseHead:current.project.head,changes:{},cacheTag:null,cached:true});
            render();
        }
        break;

} }); });
document.addEventListener('input', e => { if (e.target.id === 'editor')
    setDraft(file, e.target.value);
else if(current && editable()) { try {const changes=WorkbenchConfiguration.change(e.target,effectiveFiles());if(changes)patch(changes);}catch(error){notify(error.message);} } });
document.addEventListener('change', e => { if (['project-switch','template-switch'].includes(e.target.id))
    action(() => open(e.target.value)); });
document.addEventListener('submit', e => { e.preventDefault(); const form = e.target; if(!['create','publish','add-skill','add-agent'].includes(form.getAttribute('id')))return; action(async () => { if(['add-skill','add-agent'].includes(form.getAttribute('id'))) {if(!editable())throw Error('此工程只读');patch(WorkbenchConfiguration.submit(form,effectiveFiles()));render();notify('已加入工程草稿，请保存所有修改');return;} if (form.getAttribute('id') === 'create') {
    const v = Object.fromEntries(new FormData(form));
    const { project } = await api('/projects', 'POST', v);
    await load();
    await open(project.id);
    notify('已从 '+familyName(current.project)+' 发行版创建应用');
} if (form.getAttribute('id') === 'publish') {
    await api('/templates/' + current.project.id + '/releases', 'POST', Object.fromEntries(new FormData(form)));
    await load();
    notify('模板版本已发行');
} }); });
window.addEventListener('beforeunload', e => { if ([...drafts.values()].some(d => Object.keys(d.changes).length)||WorkbenchPersistence.hasUnstored()) {
    e.preventDefault();
    e.returnValue = '';
} });
async function boot(){const context=await api('/context');build=context.uiVersion;workspaceId=context.workspaceId;modelInfo=context.modelConfiguration;WorkbenchPersistence.init({build,workspaceId,buildKey,onWarning:notify});role=localUI.read('','shared','role','application');if(!['application','platform'].includes(role))role='application';$('#identity').value=role;const remembered=localUI.read('',role,'navigation',{});await load();if(remembered?.projectId&&projects.some(p=>p.id===remembered.projectId))await open(remembered.projectId);}
WorkbenchRelease.init({api,context:codingContext});
WorkbenchAssembly.init({context:codingContext,patch,render,action,notify});
WorkbenchJourney.init({api,context:codingContext,releases:()=>releases,update:j=>{if(current)current.journey=j;},next:target=>action(async()=>{if(target==='save')return save();tab=target;render();if(target==='coding'&&current.definition.description)WorkbenchCoding.setPrompt('请根据以下业务目标检查当前工程，并在允许范围内补齐开发方案、业务Skill与测试：\n'+current.definition.description);})});
WorkbenchCoding.init({api,local:localUI,context:codingContext,action,notify,showReview:()=>{tab='coding';render();},reloadProject:async()=>{const id=current.project.id;current=await api('/projects/'+id);render();}});
WorkbenchRuntime.init({api,local:localUI,context:codingContext,action,notify,openRun:async(projectId)=>{await open(projectId);tab='runs';render();}});
WorkbenchDelivery.init({api,context:codingContext,action,notify});
WorkbenchDesign.init({local:localUI,context:codingContext,render,patch,save,action,coding:text=>{tab='coding';render();WorkbenchCoding.setPrompt(text);}});
WorkbenchPanels.init({api,context:codingContext,render,patch,save,action,notify});
WorkbenchDeep.init({context:codingContext,patch,render});
boot().catch(e => notify(e.message));
