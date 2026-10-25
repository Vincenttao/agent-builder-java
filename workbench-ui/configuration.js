'use strict';
// This module projects project files. It does not choose business routes or invoke tools.
window.WorkbenchConfiguration = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const json = value => JSON.stringify(value, null, 2) + '\n';
  function definition(files) {
    const d = JSON.parse(files['application.json']);
    if (!d || !d.scope || !['own','delegated','outside'].every(k=>Array.isArray(d.scope[k])&&d.scope[k].every(v=>typeof v==='string')) || !Array.isArray(d.skills) || !d.skills.every(s=>s&&typeof s.id==='string'&&typeof s.file==='string'&&Array.isArray(s.operations)&&s.operations.every(op=>typeof op==='string')) || !Array.isArray(d.capabilities) || !d.capabilities.every(c=>c&&typeof c==='object') || !d.handoff || !d.connections || typeof d.connections!=='object' || Array.isArray(d.connections)) throw Error('配置缺少必要字段');
    return d;
  }
  function operations(files) {
    try { const catalog = JSON.parse(files['adapters/operations.json'] ?? '{}');return catalog && typeof catalog === 'object' && !Array.isArray(catalog) ? Object.fromEntries(Object.entries(catalog).filter(([,v])=>v&&typeof v==='object'&&!Array.isArray(v))) : {}; }
    catch { return {}; }
  }
  function issues(d, files) {
    const result = [], catalog = operations(files), ids = new Set();
    for (const c of d.capabilities) {
      if (c.type !== 'agent') continue;
      if (!c.id || ids.has(c.id)) result.push('Agent 标识缺失或重复。');
      ids.add(c.id);
      if (!d.connections[c.connection]) result.push(`Agent ${c.id} 缺少服务连接。`);
    }
    for(const [id,value] of Object.entries(d.connections)) {
      try {const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash)throw Error();}
      catch {result.push(`服务连接 ${id} 不是有效的无凭据 HTTP(S) 基础地址。`);}
    }
    if (d.handoff.enabled && !ids.has(d.handoff.target)) result.push('范围外接管 Agent 尚未挂载。');
    if (d.handoff.enabled && !d.scope.outside.length) result.push('已启用转交，但没有明确范围外示例；不能把未匹配请求直接转交。');
    if (d.scope.own.length && !d.skills.length) result.push('已声明自身业务范围，但尚未添加业务 Skill。');
    for (const s of d.skills) {
      if (!files[s.file]?.trim()) result.push(`Skill ${s.id} 缺少指导文件。`);
      else if (!files[s.file].startsWith('---')) result.push(`Skill ${s.id} 缺少原生 Skill frontmatter，请修复文件头。`);
      if (!s.operations.length) result.push(`Skill ${s.id} 尚未绑定可执行操作；当前只是指导草稿。`);
      for (const op of s.operations) if (!catalog[op]) result.push(`Skill ${s.id} 引用的操作 ${op} 不存在。`);
    }
    return [...new Set(result)];
  }
  const field = (label, name, value, disabled, hint='') => `<div class="field"><label for="config-${name}">${esc(label)}</label><textarea id="config-${name}" data-spec="${name}" ${disabled}>${esc(value)}</textarea>${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</div>`;
  function render(files, readOnly) {
    let d;try { d = definition(files); } catch {return '<section class="panel warning">application.json 存在格式错误，请到文件页修复。</section>';}
    const disabled = readOnly ? 'disabled' : '', catalog = operations(files), warnings = issues(d, files);
    const agents = d.capabilities.filter(c => c.type === 'agent');
    return `<nav class="configuration-nav" aria-label="业务配置分区">${[['scope-settings','业务范围与指令'],['skill-settings','业务 Skills'],['agent-settings','Agent 装配'],['handoff-settings','接管与续办'],['connection-settings','连接与映射']].map(([id,label])=>`<button data-config-section="${id}">${label}</button>`).join('')}</nav><div class="configuration-grid">${warnings.length ? `<section class="warning"><strong>配置提示（静态检查）</strong><ul>${warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>业务范围、Prompt 与 Skill 的语义冲突由 Coding 助手提出统一修订，保存表单不代表语义验证通过。</p></section>` : ''}
      <section class="panel" id="scope-settings"><h2>业务范围与角色</h2><p class="muted">业务范围决定可处理的业务；角色与行为指导模型。两者分别保存，不自动互相改写。</p>
      ${field('自己负责的业务','own',d.scope.own.join('\n'),disabled,'每行一项；当前 Agent 从已挂载的业务 Skill 中选择。')}
      ${field('可委派的业务','delegated',d.scope.delegated.join('\n'),disabled,'每行一项；只能交给下面已挂载的 Agent。')}
      ${field('明确范围外的业务示例','outside',d.scope.outside.join('\n'),disabled,'信息不足或未匹配应先澄清，不能直接判为范围外。')}
      <div class="field"><label for="system-prompt">角色与行为（应用层 System Prompt）</label><textarea id="system-prompt" data-prompt ${disabled}>${esc(files['instructions.md'])}</textarea></div></section>
      <section class="panel" id="skill-settings"><h2>业务 Skills 与可用操作</h2><p>Skill 是当前任务内的业务指导，不产生独立待办。模型按指导选择可用操作，下面的勾选表示可用集合，不表示固定顺序。</p>
      ${d.skills.map((s,index) => `<article class="skill-card"><h3>${esc(s.id)}</h3><p><code>${esc(s.file)}</code></p><div class="field"><label for="skill-${index}">Skill ${esc(s.id)} 的指导</label><textarea id="skill-${index}" data-skill-file="${esc(s.file)}" ${disabled}>${esc(files[s.file])}</textarea></div><fieldset ${disabled}><legend>Skill ${esc(s.id)} 可用操作</legend>${Object.entries(catalog).map(([id,op]) => `<label class="check"><input type="checkbox" data-operation="${esc(id)}" data-skill="${esc(s.id)}" ${s.operations.includes(id)?'checked':''}> ${esc(op.title || id)} <code>${esc(id)}</code> · ${esc(op.type || '未声明执行方式')} ${op.confirmationRequired?'· 需确认':''} ${op.terminal?'· 可收束任务':''}</label>`).join('') || '<p class="muted">尚无操作定义。需要开发执行脚本及输入输出契约后，再在此装配。</p>'}${s.operations.filter(id=>!catalog[id]).map(id=>`<p class="warning">失效引用：${esc(id)}。请修复操作定义；不会自动换绑。</p>`).join('')}</fieldset></article>`).join('') || '<p class="muted">尚未添加业务 Skill。</p>'}
      ${readOnly?'':`<form id="add-skill"><h3>添加业务 Skill 草稿</h3><div class="field"><label for="skill-id">Skill 标识</label><input id="skill-id" name="id" required pattern="[a-z][a-z0-9-]{0,63}" placeholder="例如 benefits"></div><div class="field"><label for="skill-guidance">Skill 指导</label><textarea id="skill-guidance" name="guidance" required></textarea></div><button>添加业务 Skill</button></form>`}</section>
      <section class="panel" id="agent-settings"><h2>挂载 Agent（A2A）</h2><p>Agent 可承接委派或范围外业务。A2A 是调用协议，服务地址不是企业授权。</p>${agents.map(c=>`<article class="skill-card"><h3>${esc(c.id)}</h3><p>${esc(c.description)}</p><code>${esc(d.connections[c.connection] || '缺少连接')}</code></article>`).join('') || '<p class="muted">没有挂载 Agent。</p>'}
      ${readOnly?'':`<form id="add-agent"><div class="field"><label for="agent-id">Agent 标识</label><input id="agent-id" name="id" required pattern="[a-z][a-z0-9-]{0,63}"></div><div class="field"><label for="agent-description">Agent 用途</label><input id="agent-description" name="description" required></div><div class="field"><label for="agent-url">A2A 服务地址</label><input id="agent-url" name="url" type="url" required placeholder="http://127.0.0.1:8770/a2a/..."></div><button>挂载 Agent</button></form>`}</section>
      <section class="panel" id="handoff-settings"><h2>范围外接管与原任务</h2><label class="check"><input type="checkbox" data-spec="enabled" ${d.handoff.enabled?'checked':''} ${disabled}> 启用范围外转交</label><div class="field"><label for="fallback-agent">范围外接管 Agent</label><select id="fallback-agent" data-spec="target" ${disabled}><option value="">请选择已挂载 Agent</option>${agents.map(c=>`<option value="${esc(c.id)}" ${d.handoff.target===c.id?'selected':''}>${esc(c.id)} · ${esc(c.description || '')}</option>`).join('')}${d.handoff.target&&!agents.some(c=>c.id===d.handoff.target)?`<option selected value="${esc(d.handoff.target)}">失效引用：${esc(d.handoff.target)}</option>`:''}</select></div>
      <div class="field"><label for="unfinished">原任务未完成时</label><select id="unfinished" data-spec="unfinished" ${disabled}>${[['ask','询问用户：保留、留在当前任务或放弃'],['retain','保留原任务，再切换'],['discard','放弃未提交任务，再切换']].map(([v,l])=>`<option value="${v}" ${d.handoff.unfinished===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field"><label for="resume">第二层任务结束后</label><select id="resume" data-spec="resume" ${disabled}><option value="prompt" ${d.handoff.resume==='prompt'?'selected':''}>提示用户复核并续办原任务</option><option value="auto" ${d.handoff.resume==='auto'?'selected':''}>自动复核原任务；写操作仍须新确认</option></select></div><p>含当前任务共两层：A→B，只恢复 A。第三层被阻断；已提交但结果未知的任务不能当成未提交任务放弃。恢复会复核业务数据，旧确认失效。</p></section>
      <section class="panel" id="connection-settings"><h2>已有服务连接与映射</h2><p class="muted">这里只编辑模板开放的本机连接配置。新系统、认证或协议接入由平台方牵头；真实密钥不写入工程。</p><div class="field"><label for="balance-path">余额结果字段路径</label><input id="balance-path" data-spec="balancePath" value="${esc(d.mapping?.balancePath??'')}" ${disabled}><small class="muted">填写业务接口 JSON 中的嵌套字段，例如 employee.wallet.availablePoints。修改只保存配置；请在新运行中验证实际返回值。</small></div>${Object.entries(d.connections).map(([id,url],i)=>`<div class="field"><label for="connection-${i}">服务连接 ${esc(id)}</label><input id="connection-${i}" data-connection="${esc(id)}" value="${esc(url)}" ${disabled}></div>`).join('') || '<p>尚无连接。</p>'}</section></div>`;
  }
  function change(target, files) {
    if (target.hasAttribute('data-prompt')) return {'instructions.md':target.value};
    if (target.dataset.skillFile) return {[target.dataset.skillFile]:target.value};
    if (!target.hasAttribute('data-spec') && !target.hasAttribute('data-operation') && !target.hasAttribute('data-connection')) return null;
    const d = definition(files), key = target.dataset.spec;
    if (['own','delegated','outside'].includes(key)) d.scope[key] = target.value.split('\n').map(x=>x.trim()).filter(Boolean);
    else if (key === 'balancePath') d.mapping={...d.mapping,balancePath:target.value};
    else if (key === 'enabled') d.handoff.enabled = target.checked;
    else if (['target','unfinished','resume'].includes(key)) d.handoff[key] = target.value;
    else if (target.hasAttribute('data-connection')) d.connections[target.dataset.connection] = target.value;
    else if (target.hasAttribute('data-operation')) {
      const skill = d.skills.find(s=>s.id===target.dataset.skill), id=target.dataset.operation;
      skill.operations = target.checked ? [...new Set([...skill.operations,id])] : skill.operations.filter(x=>x!==id);
    }
    return {'application.json':json(d)};
  }
  function submit(form, files) {
    const data = Object.fromEntries(new FormData(form)), d = definition(files);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(data.id)) throw Error('标识必须为小写字母开头的字母、数字或短横线');
    if (form.getAttribute('id')==='add-skill') {
      if (d.skills.some(s=>s.id===data.id) || Object.hasOwn(files,`skills/${data.id}/SKILL.md`)) throw Error('Skill 标识或文件已存在，请编辑现有 Skill');
      const file=`skills/${data.id}/SKILL.md`;
      d.skills.push({id:data.id,file,operations:[]});
      const guidance=data.guidance.startsWith('---')?data.guidance:`---\nname: ${data.id}\ndescription: ${data.id} business guidance\n---\n\n${data.guidance}\n`;
      return {'application.json':json(d),[file]:guidance};
    }
    if (d.capabilities.some(c=>c.id===data.id) || Object.hasOwn(d.connections,data.id)) throw Error('Agent 标识或连接名已存在');
    const url = new URL(data.url);if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash)throw Error('服务地址需要 HTTP(S)，不能包含凭据、查询参数或片段');
    d.capabilities.push({id:data.id,type:'agent',connection:data.id,description:data.description});
    d.connections[data.id]=url.href;
    return {'application.json':json(d)};
  }
  function flow(files, dirty, head) {
    let d;try{d=definition(files);}catch{return '<section class="panel warning">已保存配置无法解析，请先修复。</section>';}
    const warnings=issues(d,files), agents=d.capabilities.filter(c=>c.type==='agent'&&c.id!==d.handoff.target);
    const scope = list=>list.length?`<ul>${list.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="muted">尚未配置</p>';
    const node=(title,body,section)=>`<article class="flow-node"><button data-config-section="${section}">${esc(title)}</button>${body}</article>`;
    return `<section class="panel"><h2>处理流程 · 已保存规则</h2><p>版本 <code>${esc(head.slice(0,12))}</code>。这是配置关系图，不执行请求，也不代表真实 Trace；语义路由由运行时模型决定。</p>${dirty?'<p class="warning">有未保存修改，当前图仍展示已保存版本。</p>':''}<div id="flow-definition"><div class="flow-entry">用户输入或后续消息</div><p class="flow-arrow">↓ 原任务回复/确认绑定原任务；新需求进入业务范围判断</p><div class="flow-grid">${node('自己负责 → 业务 Skill',scope(d.scope.own)+d.skills.map(s=>`<div class="skill-card"><strong>${esc(s.id)}</strong><p>可用操作：${esc(s.operations.join('、')||'未绑定，当前为草稿')}</p></div>`).join(''),'skill-settings')}${node('可委派 → 已挂载 Agent',scope(d.scope.delegated)+`<p>${esc(agents.map(c=>c.id).join('、')||'未挂载可委派 Agent')}</p>`,'agent-settings')}${node('明确范围外 → 接管 Agent',scope(d.scope.outside)+`<p>${d.handoff.enabled?'接管目标：'+esc(d.handoff.target||'尚未选择'):'尚未启用范围外转交'}</p>`,'handoff-settings')}</div><div class="flow-grid flow-secondary">${node('信息不足或多候选 → 澄清','<p>未匹配示例不等于范围外，不自动转交。</p>','scope-settings')}${node('冲突或目标失效 → 阻断','<p>不擅自修正规则。由 Coding 助手协助统一业务范围、Prompt 与 Skill；应用前审阅。</p>','scope-settings')}${node('原任务未完成 → 两层切换',`<p>${esc({ask:'先询问用户，再决定保留或放弃',retain:'保留 A，再切换到 B',discard:'仅未提交任务可放弃，再切换到 B'}[d.handoff.unfinished])}</p><p>B 结束 → ${d.handoff.resume==='auto'?'自动复核 A':'提示复核并续办 A'} → 新确认。最多 A→B；第三层阻断。</p>`,'handoff-settings')}</div></div>${warnings.length?`<div class="warning"><strong>当前定义仍有待补齐项</strong><ul>${warnings.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}<p class="muted">Skill 执行后回到当前任务；委派或接管 Agent 可创建第二层任务。回执按原任务归属，迟到回执不会抢占当前任务。</p></section>`;
  }
  return {render, change, submit, flow};
})();
