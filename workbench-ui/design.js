'use strict';
window.WorkbenchDesign = (() => {
    let host;
    const states = new Map(), esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), json = v => JSON.stringify(v, null, 2) + '\n';
    const ctx = () => host.context(), state = () => { const c = ctx(), key = c.role + '|' + c.project.id; if (!states.has(key))
        states.set(key, { section: 'map', node: 'decision', query: '', context: 'new', mode: 'examples', branch: 'SKILL', target: '', result: null, filter: 'all', selected: null, ...host.local?.read(c.project.id,c.role,'design',{}) }); return states.get(key); };
    const spec = (saved = false) => JSON.parse((saved ? ctx().files : ctx().effectiveFiles)['application.json']);
    const catalog = (saved = false) => { try {
        return JSON.parse((saved ? ctx().files : ctx().effectiveFiles)['adapters/operations.json'] ?? '{}');
    }
    catch {
        return {};
    } };
    const aliases = { SKILL: 'skill', DELEGATE: 'delegate', HANDOFF: 'handoff', CONTINUE: 'continue', CLARIFY: 'clarify', CONFLICT: 'blocked' }, names = { skill: '调用业务 Skill', delegate: '委派已挂载 Agent', handoff: '转交接管 Agent', continue: '继续原任务', clarify: '先向用户澄清', blocked: '停止并修复配置', decision: '当前 Agent 判断' };
    function examples() { try {
        return JSON.parse(ctx().files['tests/routing-examples.json'] ?? '{"cases":[]}').cases ?? [];
    }
    catch {
        return [];
    } }
    function preview() {
        const c = ctx(), s = state(), d = spec(true);
        let action, target = '', reason = '';
        if (c.dirty) {
            action = 'CONFLICT';
            reason = '有未保存配置，请先保存，预演不会读取草稿。';
        }
        else if (!d.scope.own.length && !d.scope.delegated.length) {
            action = 'CONFLICT';
            reason = '空应用尚未定义业务范围。';
        }
        else if (s.context === 'reply') {
            action = 'CONTINUE';
            reason = '按所选“原任务回复/确认”条件续接，不重新分发。';
        }
        else if (s.mode === 'branches') {
            action = s.branch;
            target = s.target;
            reason = '按手动选择的规则分支模拟，不做意图识别。';
        }
        else {
            const found = examples().filter(x => x.query.trim() === s.query.trim());
            if (found.length === 1) {
                ({ action, target = '' } = found[0]);
                reason = '匹配当前保存版本的预期示例；不等于真实模型判断。';
            }
            else {
                action = 'CLARIFY';
                reason = found.length > 1 ? '存在多个预期示例，需要澄清。' : '没有匹配的已保存预期示例；请在调试中验证真实路由。';
            }
        }
        if (!Object.hasOwn(aliases, action)) {
            action = 'CONFLICT';
            reason = '示例中的去向类型无效，请修复示例文件。';
        }
        const agents = d.capabilities.filter(x => x.type === 'agent');
        if (action === 'SKILL' && (!target || !d.skills.some(x => x.id === target)) || action === 'DELEGATE' && (!target || !agents.some(x => x.id === target && d.connections[x.connection])) || action === 'HANDOFF' && (!d.handoff.enabled || !agents.some(x => x.id === d.handoff.target && d.connections[x.connection]))) {
            action = 'CONFLICT';
            reason = '所选能力或接管目标尚未配置，不能高亮为可执行路径。';
        }
        if (action === 'HANDOFF')
            target = d.handoff.target;
        if (['DELEGATE', 'HANDOFF'].includes(action) && s.context === 'two') {
            action = 'CONFLICT';
            reason = '含当前任务共两层，阻断第三层调用，原任务不变。';
        }
        s.result = { head: c.project.head, query: s.query, context: s.context, mode: s.mode, branch: s.branch, target, action, reason, stale: false };
        s.node = aliases[action];
        host.render();
    }
    function node(id, title, body) { const s = state(), active = s.result && !s.result.stale && s.result.head === ctx().project.head && aliases[s.result.action] === id; return `<button class="map-node ${active ? 'is-path' : ''} ${s.node === id ? 'is-selected' : ''}" data-design-node="${id}" aria-pressed="${s.node === id}"><small>${esc(title)}</small><strong>${esc(names[id])}</strong><span>${esc(body)}</span>${active ? '<em>本次预演去向</em>' : ''}</button>`; }
    function inspector(d) { const s = state(), id = s.node; let html = '', section = 'scope-settings'; if (id === 'skill') {
        section = 'skill-settings';
        html = `<p>${esc(d.scope.own.join('；') || '尚未配置自己负责的业务')}</p>${d.skills.map(x => `<div class="skill-card"><h3>${esc(x.id)}</h3><p>在当前任务内调用，完成后返回；不新增B任务。</p><div class="operation-tags">${x.operations.map(name => { const op = catalog(true)[name]; return `<span>${esc(op?.title ?? name)} · ${op?.confirmationRequired ? '需确认' : '只读/无需确认'} · 最多${esc(op?.maxCalls ?? '?')}次</span>`; }).join('')}</div><button data-open-file="${esc(x.file)}">查看 Skill 内容</button><button data-design-skill="${esc(x.id)}">查看业务过程图</button></div>`).join('')}`;
    }
    else if (id === 'delegate' || id === 'handoff') {
        section = id === 'delegate' ? 'agent-settings' : 'handoff-settings';
        const agents = d.capabilities.filter(x => x.type === 'agent' && (id === 'delegate' ? x.id !== d.handoff.target : x.id === d.handoff.target));
        html = `<p>${esc((id === 'delegate' ? d.scope.delegated : d.scope.outside).join('；') || '尚未配置业务示例')}</p>${agents.map(x => `<div class="skill-card"><strong>${esc(x.id)}</strong><p>${esc(x.description)}</p><code>${esc(d.connections[x.connection] ?? '连接失效')}</code></div>`).join('') || '<p>尚未配置目标。</p>'}<p>转交前：${esc({ ask: '询问保留、放弃或留在当前任务', retain: '保留原任务A', discard: '只允许放弃未提交的剩余办理' }[d.handoff.unfinished])}；B结束后${d.handoff.resume === 'auto' ? '自动复核' : '提示复核并续办'}A，重新确认。原键回执归属原任务。</p>`;
    }
    else
        html = `<p>${esc({ decision: '结合已保存范围、挂载能力与当前任务上下文判断。语义路由由实际运行模型负责。', continue: '回复与确认绑定原任务、原等待点；不创建新任务。', clarify: '信息不足或多个候选时先澄清；未匹配示例不等于范围外。', blocked: '定义冲突或目标失效时阻断。由Coding助手提出同一版本的关联修订，审阅后保存。' }[id])}</p>`; return `<section class="panel map-inspector" data-map-inspector="${esc(id)}"><div class="section-title"><h2>${esc(names[id])} · 条件与配置</h2><span class="badge">已保存版本 ${esc(ctx().project.head.slice(0, 8))}</span></div>${html}<button data-config-section="${section}">编辑对应配置</button>${id === 'blocked' ? '<button data-design-coding>交给 Coding 助手统一修订</button>' : ''}</section>`; }
    function map() {
        const c = ctx(), d = spec(true), s = state();
        if (s.result && (s.result.head !== c.project.head || c.dirty))
            s.result.stale = true;
        const r = s.result;
        const html = `<section class="panel map-preview-controls"><div class="section-title"><div><h2>看看每一条请求的去向</h2><p class="muted">设计预演 · 不调用模型或业务。真实执行请到测试/运行记录查看。</p></div><span class="badge">已保存规则</span></div>${c.dirty ? '<p class="warning">有未保存修改，当前图仍展示已保存版本。</p>' : ''}<div class="preview-mode"><label>预演方式<select id="flow-mode"><option value="examples" ${s.mode === 'examples' ? 'selected' : ''}>保存的预期示例匹配</option><option value="branches" ${s.mode === 'branches' ? 'selected' : ''}>手动选择规则分支</option></select></label><label>任务上下文<select id="flow-context">${[['new', '新需求 · 无原任务'], ['pending', '新需求 · 原任务未完成'], ['receipt', '新需求 · 原操作待回执'], ['reply', '原任务回复 / 确认'], ['two', 'A/B都未完成 · 请求第三层']].map(([v, l]) => `<option value="${v}" ${s.context === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div><div class="preview-query"><label for="flow-query">用户请求</label><textarea id="flow-query" placeholder="输入预期示例，或切换到规则分支模拟">${esc(s.query)}</textarea><button data-design-preview class="primary">查看路径</button></div>${s.mode === 'branches' ? `<div class="preview-mode"><label>规则分支<select id="flow-branch">${Object.entries(aliases).map(([a, id]) => `<option value="${a}" ${s.branch === a ? 'selected' : ''}>${esc(names[id])}</option>`).join('')}</select></label><label>挂载目标<select id="flow-target"><option value="">选择目标</option>${[...d.skills, ...d.capabilities.filter(x => x.type === 'agent')].map(x => `<option value="${esc(x.id)}" ${s.target === x.id ? 'selected' : ''}>${esc(x.id)}</option>`).join('')}</select></label></div>` : ''}<div class="example-chips">${examples().map((x, i) => `<button data-design-example="${i}">${esc(x.query)}</button>`).join('')}</div><p id="flow-result" class="${r && !r.stale ? 'preview-result' : 'muted'}">${r ? r.stale ? '预演已过期，请按当前输入与保存版本重新预演。' : esc(names[aliases[r.action]] + '：' + r.reason + (r.target ? ' 目标：' + r.target : '')) : '尚未预演。点击节点仅查看规则；不会改变请求去向。'}</p></section>
 <section class="panel processing-map" id="flow-definition"><div class="map-top"><div class="map-input">用户输入<br><small>新请求 / 后续消息</small></div><span class="map-arrow">→</span>${node('decision', '结合任务与范围', '先判断是否为原任务回复')}<span class="map-arrow">→</span>${node('continue', '原任务补充 / 确认', '续接原等待点')}</div><div class="branch-trunk">↓ 新业务请求，判断包括挂载能力在内的处理范围</div><div class="map-branches">${node('skill', '范围内 · 自己处理', d.skills.map(x => x.id).join('、') || '尚未装配业务Skill')}${node('delegate', '范围内 · 已挂载Agent', d.capabilities.filter(x => x.type === 'agent' && x.id !== d.handoff.target).map(x => x.id).join('、') || '尚未挂载委派Agent')}${node('handoff', '明确超出全部处理范围', d.handoff.enabled ? d.handoff.target : '尚未配置接管目标')}</div><div class="map-return-labels"><small>↓ Skill返回当前任务</small><small>↓ 等待下游结果</small><small>↓ 按策略处置A，再处理B</small></div><div class="map-guards">${node('clarify', '信息不足 / 多个候选', '先澄清，不直接转交')}${node('blocked', '定义冲突 / 目标失效', '阻断并修复配置')}</div></section>${inspector(d)}`;
        const graphStart = html.indexOf('<section class="panel processing-map"'), inspectorStart = html.indexOf('<section class="panel map-inspector"');
        return html;
    }
    function handoff() { if(ctx().contract?.handoff===false)return '<section class="panel"><h2>转交与续办</h2><p>当前模板未开放范围外接管。应用方不能自行开启；请由平台检查执行支持并发行模板。</p></section>';const d = spec(), s = state(), disabled = ctx().editable ? '' : 'disabled', agents = d.capabilities.filter(x => x.type === 'agent'); return `<section class="panel" id="handoff-editor"><h2>范围外转交与任务续办</h2><p class="muted">当前Agent及其Skill/挂载Agent均不能处理时，才按这些规则接管。</p><label class="check"><input type="checkbox" data-spec="enabled" ${d.handoff.enabled ? 'checked' : ''} ${disabled}>启用范围外转交</label><div class="policy-question"><b>1</b><div><label for="flow-handoff-target">超出业务范围后，交给谁？</label><select id="flow-handoff-target" data-spec="target" ${disabled}><option value="">选择已挂载Agent</option>${agents.map(x => `<option value="${esc(x.id)}" ${x.id === d.handoff.target ? 'selected' : ''}>${esc(x.id)} · ${esc(x.description)}</option>`).join('')}</select></div></div><div class="policy-question"><b>2</b><div><h3>原任务还没办完，怎么办？</h3><div class="policy-options">${[['retain', '保留进度，先处理新请求'], ['ask', '切换前先询问用户'], ['discard', '仅放弃未提交的剩余办理']].map(([v, l]) => `<label><input type="radio" name="handoff-unfinished" data-spec="unfinished" value="${v}" ${d.handoff.unfinished === v ? 'checked' : ''} ${disabled}>${l}</label>`).join('')}</div></div></div><div class="policy-question"><b>3</b><div><h3>新任务结束后，如何继续？</h3><div class="policy-options">${[['prompt', '提示用户复核并续办'], ['auto', '自动复核原任务；写操作仍须新确认']].map(([v, l]) => `<label><input type="radio" name="handoff-resume" data-spec="resume" value="${v}" ${d.handoff.resume === v ? 'checked' : ''} ${disabled}>${l}</label>`).join('')}</div></div></div><p class="fixed-rules">模板固定：最多A→B；Skill不新增独立待办；恢复复核并生成新确认；未知写入只核对原回执，不回滚或重发。</p><p id="handoff-summary">${summary(d)}</p>${ctx().editable ? '<button data-action="save" class="primary">保存所有修改</button><button data-design-save-preview>保存并预演</button>' : ''}<button data-open-file="application.json">查看配置文件</button></section>`; }
    function summary(d) { return d.handoff.enabled ? `范围外转交 ${d.handoff.target || '（尚未选择）'}；${{ ask: '先询问用户', retain: '保留A，再处理B', discard: '只放弃未提交的剩余办理' }[d.handoff.unfinished]}；B结束后${d.handoff.resume === 'auto' ? '自动复核' : '提示复核并续办'}A。` : '尚未启用范围外接管；不会自动转交到任意Agent。'; }
    function rulePreview() { const d = spec(true), s = state(), r = s.result; return `<section class="panel"><h2>转交与 Skill 规则预演</h2><p class="muted">按保存策略模拟状态，不执行模型、转账或Agent调用。</p><div class="preview-mode"><label>业务条件<select id="rule-scenario">${[['pending', '原任务未提交'], ['new', '没有原任务'], ['receipt', '已提交待回执'], ['skill', '当前任务内调用Skill'], ['two', '已有A/B，再请求C']].map(([v, l]) => `<option value="${v}" ${s.scenario === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><button data-design-rule class="primary">预演规则</button></div>${s.ruleResult && !ctx().dirty && s.ruleHead === ctx().project.head ? `<div class="rule-result"><article><h3>原任务 A</h3><p>${esc(s.ruleResult.a)}</p></article><article><h3>新任务 B</h3><p>${esc(s.ruleResult.b)}</p></article></div><p>${esc(s.ruleResult.next)}</p><div class="rule-steps"><button data-rule-step="stay">模拟：留在A</button><button data-rule-step="retain">模拟：保留A，处理B</button><button data-rule-step="done">模拟：B结束</button><button data-rule-step="review">模拟：复核并续办A</button></div><p id="rule-step-result">${esc(s.ruleStep ?? '请选择后续业务条件。')}</p>` : '<p>请选择条件再预演；修改保存版本后旧结果失效。</p>'}</section>`; }
    function skillDiagram(id) {
        const c = ctx(), s = spec(true).skills.find(x => x.id === id);
        if (!s)
            return '<p>Skill已被移除，请重新选择。</p>';
        const source=c.flowSources?.[id],sourceWarning=source?.status==='stale'?'<p class="warning">流程说明已过期：'+esc(source.reason)+'</p>':'<p class="muted">'+esc(source?.reason??'来源未记录，图示需要人工核对。')+'</p>';
        let flow;
        try {
            flow = JSON.parse(c.files['skills/' + id + '/flow.json']);
        }
        catch { }
        if (!flow || flow.designOnly !== true || !Array.isArray(flow.nodes) || !flow.nodes.length || flow.nodes.length > 30 || !Array.isArray(flow.edges))
            return `<section class="panel"><h2>${esc(id)} · 业务指导</h2>${sourceWarning}<button data-design-diagram-coding="${esc(id)}">请Coding助手生成流程说明</button><p class="muted">尚未提供流程说明图。下面是实际Skill内容；操作集合不代表强制顺序。</p><pre>${esc(c.files[s.file])}</pre><button data-open-file="${esc(s.file)}">编辑指导</button></section>`;
        const positions = new Map(flow.nodes.map(n => [n.id, { x: 20 + (n.column ?? 1) * 190, y: 20 + (n.row ?? 0) * 100 }])), height = Math.max(...flow.nodes.map(n => (n.row ?? 0) * 100)) + 95;
        return `<section class="panel"><div class="section-title"><h2>${esc(id)} · ${esc(flow.title || '业务过程')}</h2><button data-design-diagram-coding="${esc(id)}">关联修订流程说明</button><button data-open-file="skills/${esc(id)}/flow.json">查看流程说明文件</button></div>${sourceWarning}<p class="muted">设计说明，非执行引擎；执行仍由Skill指导、模型和程序约束决定。</p><div class="skill-diagram" style="height:${height}px"><svg viewBox="0 0 600 ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="flow-arrow-tip" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#aab6c6"/></marker></defs>${flow.edges.map(e => { const a = positions.get(e.from), b = positions.get(e.to); if (!a || !b)
            return ''; if(b.y-a.y>140){const left=a.x<180,lane=left?8:570,start=left?a.x:a.x+160,end=left?b.x:b.x+160;return `<path d="M${start},${a.y+28} H${lane} V${b.y+28} H${end}" stroke="#aab6c6" fill="none" marker-end="url(#flow-arrow-tip)"/><text x="${lane+5}" y="${(a.y+b.y)/2+28}" font-size="10" fill="#6e7c91">${esc(e.when??'')}</text>`;} return `<path d="M${a.x + 80},${a.y + 55} C${a.x + 80},${a.y + 85} ${b.x + 80},${b.y - 15} ${b.x + 80},${b.y}" stroke="#aab6c6" fill="none" marker-end="url(#flow-arrow-tip)"/><text x="${(a.x + b.x) / 2 + 85}" y="${(a.y + b.y) / 2 + 35}" font-size="10" fill="#6e7c91">${esc(e.when ?? '')}</text>`; }).join('')}</svg>${flow.nodes.map(n => { const p = positions.get(n.id); return `<article class="skill-process-node" style="left:${p.x / 6}%;top:${p.y}px;width:26.6%"><small>${esc(n.operation ?? n.kind ?? '业务条件')}</small><strong>${esc(n.label)}</strong></article>`; }).join('')}</div><p>${esc(flow.note ?? '每个写操作独立确认；图中结果以实际工具回执为准。')}</p></section>`;
    }
    function flow() { const c = ctx(), s = state();host.local?.write(c.project.id,c.role,'design',s); const tabs = [['map', '处理流程'], ['scope', '业务范围'], ['handoff', '转交与续办'], ['skills', '业务 Skills'], ['preview', '规则预演']]; let body; if (s.section === 'map')
        body = map();
    else if (s.section === 'handoff')
        body = handoff();
    else if (s.section === 'preview')
        body = rulePreview();
    else {
        const box = document.createElement('div');
        box.innerHTML = WorkbenchConfiguration.render(c.effectiveFiles, !c.editable);
        body = (s.section==='scope'?WorkbenchAssignments.render(c):'')+(box.querySelector(s.section === 'scope' ? '#scope-settings' : '#skill-settings')?.outerHTML ?? '<p>先修复应用定义。</p>');
        if (s.section === 'skills')
            body = `<div class="skill-pickers">${spec(true).skills.map(x => `<button data-design-skill="${esc(x.id)}">${esc(x.id)} · 查看过程</button>`).join('')}</div>` + (s.skill ? skillDiagram(s.skill) : '') + body;
    } return `<div class="section-title"><div><h2>编排</h2><p class="muted">定义负责什么、如何处理，以及何时转交。</p></div><button data-design-coding>交给 Coding Agent</button></div><nav class="flow-nav" aria-label="编排内容">${tabs.map(([id, label], i) => `<button data-design-section="${id}" class="${s.section === id ? 'active' : ''}" aria-pressed="${s.section === id}"><small>0${i + 1}</small>${label}</button>`).join('')}</nav>${body}`; }
    function init(callbacks) { host = callbacks; document.addEventListener('input', e => { if (!ctx())
        return; const s = state(); if (e.target.id === 'flow-query') {
        s.query = e.target.value;
        if (s.result)
            s.result.stale = true;host.local?.write(ctx().project.id,ctx().role,'design',s);
        document.querySelectorAll('.map-node.is-path').forEach(x => x.classList.remove('is-path'));
        const r = document.getElementById('flow-result');
        if (r)
            r.textContent = '输入已变化，请重新预演。';
    } if (e.target.closest('#handoff-editor'))
        queueMicrotask(() => { const el = document.getElementById('handoff-summary'); if (el)
            el.textContent = summary(spec()); }); }); document.addEventListener('change', e => { if (!ctx())
        return; const s = state(), fields = { 'flow-context': 'context', 'flow-mode': 'mode', 'flow-branch': 'branch', 'flow-target': 'target', 'rule-scenario': 'scenario' }; if (fields[e.target.id]) {
        s[fields[e.target.id]] = e.target.value;if(e.target.id==='rule-scenario'){s.ruleResult=null;s.ruleStep=null;}
        if (s.result)
            s.result.stale = true;
        host.render();
    } }); document.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !ctx())
        return; const s = state(); if(b.dataset.designDiagramCoding){const id=b.dataset.designDiagramCoding;host.coding('请关联核对当前已保存Skill '+id+'、绑定操作和 skills/'+id+'/flow.json。流程只作设计说明，不是执行引擎。补齐或修订图中条件、确认、跳转及完成依据；将sourceHash设置为当前来源摘要 '+(ctx().flowSources?.[id]?.hash??'请先读取当前定义计算')+'。保持未涉及文件不变，并说明图示与业务指导的关系。');return;} if (b.dataset.designSection) {
        s.section = b.dataset.designSection;
        host.render();
    }
    else if (b.dataset.designNode) {
        s.node = b.dataset.designNode;
        host.render();
    }
    else if (b.hasAttribute('data-design-preview'))
        preview();
    else if (b.dataset.designExample !== undefined) {
        s.query = examples()[Number(b.dataset.designExample)].query;
        preview();
    }
    else if (b.dataset.designSkill) {
        s.section = 'skills';
        s.skill = b.dataset.designSkill;
        host.render();
    }
    else if (b.hasAttribute('data-design-coding')) {
        host.coding('请核对当前应用的业务范围、System Prompt、Skill与编排定义，定位冲突并提出同一修订的关联修改。');
    }
    else if (b.hasAttribute('data-design-save-preview'))
        host.action(async () => { await host.save(); state().section = 'preview'; host.render(); });
    else if (b.dataset.ruleStep) {
        const d = spec(true), step = b.dataset.ruleStep;
        s.ruleStep = s.ruleHead !== ctx().project.head ? '保存版本已变化，请重新预演。' : s.scenario === 'two' ? '两层上限：保持A/B，不创建C。' : s.scenario === 'skill' ? 'Skill返回A，不创建B。' : s.scenario === 'new' ? '没有原任务A，不能恢复A。' : ctx().dirty ? '先保存草稿，再重新预演。' : step === 'stay' ? '继续A，不创建B。' : (!d.handoff.enabled || !d.capabilities.some(x => x.type === 'agent' && x.id === d.handoff.target && d.connections[x.connection])) ? '接管目标无效，不创建或恢复模拟任务。' : step === 'retain' ? 'A保留进度，B处理新业务；两层上限，不能再创建C。' : step === 'done' ? '假定B结束，A进入待复核；不是业务已完成的证据。' : '复核A当前业务数据，旧确认失效；写操作需重新确认后提交。';
        host.render();
    }
    else if (b.hasAttribute('data-design-rule')) {
        const scenario = s.scenario ?? 'pending', d = spec(true);
        s.ruleHead = ctx().project.head;
        s.ruleStep = null;
        s.ruleResult = ctx().dirty ? { a: '先保存草稿', b: '不创建新任务', next: '预演仅按已保存版本进行。' } : !['skill', 'two'].includes(scenario) && (!d.handoff.enabled || !d.capabilities.some(x => x.type === 'agent' && x.id === d.handoff.target && d.connections[x.connection])) ? { a: '保持原任务', b: '不创建新任务', next: '请先配置有效的范围外接管目标。' } : scenario === 'skill' ? { a: 'A内调用Skill；等待输入后仍回到A', b: '不创建B', next: 'Skill完成后返回当前任务。' } : scenario === 'two' ? { a: '保留A', b: 'B保持原状态，不调用C', next: '两层上限：先处理当前任务。' } : scenario === 'new' ? { a: '没有原任务，不提示恢复', b: '作为当前任务开始', next: '业务结束后不恢复不存在的A。' } : scenario === 'receipt' ? { a: '等待原key回执，不能放弃或重发', b: '允许切换前先记录A处置', next: '迟到回执只更新A，不抢占B。' } : { a: d.handoff.unfinished === 'ask' ? '等待用户决定保留、放弃或不切换' : d.handoff.unfinished === 'retain' ? '保留进度，待续办' : '仅放弃未提交的剩余办理', b: d.handoff.unfinished === 'ask' ? '用户决定前不调用' : '按保存策略创建B', next: 'B完成/失败后' + (d.handoff.resume === 'auto' ? '自动复核' : '提示复核并续办') + 'A；写操作需要新确认。' };
        host.render();
    } }); }
    return { init, flow: () => { try {
            return flow();
        }
        catch {
            return '<section class="warning">业务定义无法解析，请先修复配置。<button data-open-file="application.json">打开定义文件</button></section>';
        } } };
})();
