import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { ApiError, AssemblyInput, Blocker, Draft, DraftInput, EnvironmentStatus, Snapshot } from '../../../packages/contracts/src/index.js';
import type { ValidationReport } from '../../../packages/contracts/src/validations.js';
import './style.css';
import { DebugRun } from './debug-run.js';
import { equipmentAssembly, workOrderAssembly } from '../../../packages/contracts/src/equipment-template.js';
import { BaselineReview, ProjectValidation } from './project-validation.js';
import {DemoApp} from './demo-app.js';
import { ComponentCatalog, AssemblySummary } from './assembly-editor.js';
import { ProjectRelease } from './project-release.js';

const blank = (): DraftInput => ({ name: '', brief: {
  audience: { value: '', source: 'user', confirmed: false },
  goal: { value: '', source: 'user', confirmed: false },
  output: { value: '', source: 'user', confirmed: false }
} });
class RequestError extends Error { constructor(public readonly body: ApiError) { super(body.message); } }
function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState('');
  const [csrf, setCsrf] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [current, setCurrent] = useState<Draft>();
  const [input, setInput] = useState<DraftInput>(blank);
  const [environment, setEnvironment] = useState<EnvironmentStatus>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'form' | 'guided'>('form');
  const [activeTab, setActiveTab] = useState<'requirements' | 'assembly' | 'development' | 'release'>('requirements');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [reports, setReports] = useState<Record<string, ValidationReport>>({});
  const [published, setPublished] = useState<Record<string, boolean>>({});
  const [assembly, setAssembly] = useState<AssemblyInput>(equipmentAssembly);
  const [assemblyTouched, setAssemblyTouched] = useState(false);
  const [baselineRevision, setBaselineRevision] = useState(0);
  const hasUnsavedChanges = !current || JSON.stringify(input) !== JSON.stringify({ name: current.name, brief: current.brief });
  const canFreeze = current && !hasUnsavedChanges && Object.values(current.brief).every(f => f.confirmed && f.value.trim());
  const selectedSnapshot = snapshots.find(snapshot => snapshot.id === selectedSnapshotId);
  const showError = (e: unknown) => {
    if (e instanceof RequestError && e.body.code === 'UNAUTHENTICATED') setAuthenticated(false);
    if (e instanceof RequestError && e.body.code === 'ENVIRONMENT_BLOCKED') {
      const details = e.body.details as { blockers?: Blocker[] } | null;
      setError(details?.blockers?.map(b => b.message).join('；') || e.body.message); return;
    }
    setError(e instanceof Error ? e.message : '请求失败，请重试');
  };
  async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (!response.ok) throw new RequestError(await response.json() as ApiError);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  async function refresh() {
    const [list, status] = await Promise.all([api<{items: Draft[]}>('/api/drafts'), api<EnvironmentStatus>('/api/environment')]);
    setDrafts(list.items); setEnvironment(status);
  }
  useEffect(() => {
    void api<{ csrfToken: string }>('/api/auth/session').then(async session => {
      setCsrf(session.csrfToken); setAuthenticated(true); await refresh();
    }).catch(e => { if (!(e instanceof RequestError && e.body.code === 'UNAUTHENTICATED')) showError(e); }).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    let active = true;
    setSnapshots([]); setSelectedSnapshotId('');
    if (current) void api<{ items: Snapshot[] }>(`/api/drafts/${current.id}/snapshots`).then(result => {
      if (active) { setSnapshots(result.items); setSelectedSnapshotId(result.items[0]?.id ?? ''); }
    }).catch(e => { if (active) showError(e); });
    return () => { active = false; };
  }, [current?.id, current?.revision]);
  async function login(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const session = await api<{ csrfToken: string }>('/api/auth/session', 'POST', { token });
      setToken(''); setCsrf(session.csrfToken); setAuthenticated(true); await refresh();
    } catch (e) { showError(e); } finally { setBusy(false); }
  }
  function select(draft?: Draft, force = false) {
    if (!force && current && (hasUnsavedChanges || assemblyTouched) && !window.confirm('当前项目有未保存的需求或装配修改。放弃修改并切换项目吗？')) return;
    setCurrent(draft); setInput(draft ? { name: draft.name, brief: structuredClone(draft.brief) } : blank());
    setActiveTab('requirements'); setSelectedSnapshotId('');
    setError(''); setNotice(draft ? `已保存 · 修订 ${draft.revision}` : '尚未保存');
    setAssembly(equipmentAssembly(draft?.brief.goal.value)); setAssemblyTouched(false);
  }
  function field(key: keyof DraftInput['brief'], value: string) {
    setInput(prev => ({ ...prev, brief: { ...prev.brief, [key]: { value, source: 'user', confirmed: false } } })); setNotice('有未保存的修改');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const saved = current
        ? await api<Draft>(`/api/drafts/${current.id}`, 'PUT', { ...input, expectedRevision: current.revision })
        : await api<Draft>('/api/drafts', 'POST', input);
      select(saved, true); await refresh();
    } catch (e) { showError(e); } finally { setBusy(false); }
  }
  async function freeze() {
    if (!current || !canFreeze) return;
    setBusy(true); setError('');
    try {
      const snapshot = await api<Snapshot>(`/api/drafts/${current.id}/snapshots`, 'POST', { expectedRevision: current.revision, assembly });
      setSnapshots(previous => [snapshot, ...previous.filter(item => item.id !== snapshot.id)]); setSelectedSnapshotId(snapshot.id); setActiveTab('development'); setNotice('测试版本已固定，待运行验证');
    } catch (e) { showError(e); } finally { setBusy(false); }
  }
  if (checking) return <main className="login"><p>正在连接本地工作区…</p></main>;
  if (!authenticated) return <main className="login"><section className="login-card">
    <div className="mark">AB</div><p className="eyebrow">AGENT BUILDER · 本地工作区</p><h1>让业务需求成为可验证的 Agent</h1>
    <p className="muted">确认需求、固定版本，并通过模拟业务环境调试 Agent。使用本机配置的访问令牌进入工作台。</p>
    <form onSubmit={login}><label>本地访问令牌<input type="password" autoComplete="off" required value={token} onChange={e => setToken(e.target.value)}/></label>
    <button className="primary" disabled={busy}>进入工作台</button></form>{error && <p role="alert" className="error">{error}</p>}
    <p className="footnote">令牌位于本地配置的 LOCAL_BOOTSTRAP_TOKEN；不会保存在浏览器本地存储中。</p>
  </section></main>;
  return <div className="shell">
    <aside className="nav"><div className="brand"><span className="mark">AB</span><strong>Agent Builder</strong></div>
      <div className="nav-label">开发工作区</div><div className="nav-active">需求与草稿</div><a className="nav-muted" href="#component-library">组件目录 · Skill / Rail / Tool</a><div className="nav-muted">自动开发 · Tool / Skill</div><div className="nav-muted">候选预览与项目验收</div>
      <div className="nav-bottom"><span className="dot"/> 本地开发原型<br/><small>trusted-local · 未启用任务沙箱</small></div>
    </aside>
    <main className="workspace"><header><div><p className="eyebrow">需求 → 开发 → 测试 → 交付</p><h1>需求工作台</h1><p className="muted">定义需求，选择可用组件，装配并验证你的业务 Agent。</p></div>
      <button className="secondary" onClick={() => { void api('/api/auth/session', 'DELETE').then(() => { setAuthenticated(false); setCsrf(''); }).catch(showError); }}>退出</button></header>
      <nav className="workflow-tabs" role="tablist" aria-label="Agent 开发流程">
        {([
          ['requirements','01','需求录入',current?'需求草稿':'填写业务目标'],
          ['assembly','02','环境与装配',environment?.canRun?'环境就绪':'检测依赖'],
          ['development','03','开发与测试',selectedSnapshotId?'固定版本':'等待固定'],
          ['release','04','发布与验证',selectedSnapshotId && reports[selectedSnapshotId]?.verdict==='passed'?'验收通过':'待验收']
        ] as const).map(([id,number,title,detail])=><button type="button" role="tab" aria-selected={activeTab===id} aria-controls={`tab-${id}`} className={`workflow-tab ${activeTab===id?'active':''}`} key={id} onClick={()=>setActiveTab(id)}><span className="workflow-tab-number">{number}</span><span className="workflow-tab-copy"><strong>{title}</strong><small>{detail}</small></span></button>)}
      </nav>
      <div className="editor-grid"><section className="panel draft-list"><div className="panel-head"><h2>Agent 草稿</h2><span>{drafts.length}</span></div>
        <button className="secondary full" disabled={busy} onClick={() => select()}>新建草稿</button>
        <label>当前项目<select aria-label="选择项目" value={current?.id??''} disabled={busy} onChange={e=>select(drafts.find(d=>d.id===e.target.value))}><option value="">选择项目</option>{drafts.map(d=><option key={d.id} value={d.id}>{d.name} · r{d.revision}</option>)}</select></label>
        {current&&<div className="project-summary"><strong>{current.name}</strong><span>修订 r{current.revision}</span><span className={selectedSnapshotId?'badge good':'badge'}>{selectedSnapshotId?'已有固定版本':'尚未固定版本'}</span></div>}
        {!drafts.length&&<p className="empty">创建你的第一个 Agent 需求。</p>}
      </section>
      <section className="panel editor workflow-editor"><div className="workflow-project-heading"><div><p className="eyebrow">{current?.name??'新项目'}</p><h2>{['requirements','assembly','development','release'].indexOf(activeTab)+1} / {({requirements:'需求录入',assembly:'环境与装配',development:'开发与测试',release:'发布与验证'})[activeTab]}</h2></div>{current&&<span className={hasUnsavedChanges?'badge warning':'badge good'}>{hasUnsavedChanges?'有未保存修改':`需求 r${current.revision} · 已保存`}</span>}</div>
        <div id="tab-requirements" role="tabpanel" className="workflow-pane" hidden={activeTab!=='requirements'}><div className="panel-head"><div><p className="eyebrow">01 / 定义需求</p><h2>{current ? '编辑需求' : '新建需求'}</h2></div><span className="badge">草稿</span></div>
        <div className="tabs"><button type="button" aria-pressed={view === 'form'} onClick={() => setView('form')}>表单</button><button type="button" aria-pressed={view === 'guided'} onClick={() => setView('guided')}>引导填写</button></div>
        <form onSubmit={save}><label>Agent 名称<input maxLength={120} required value={input.name} onChange={e => { setInput({ ...input, name: e.target.value }); setNotice('有未保存的修改'); }} placeholder="例如：企业账户查询助手"/></label>
          {([['audience', '目标使用者', '谁会使用这个 Agent？'], ['goal', '业务目标', '它需要帮助用户完成什么？'], ['output', '交付内容', '什么结果意味着任务已完成？']] as const).map(([key, label, question]) => <div className="brief-field" key={key}><label htmlFor={`brief-${key}`}>{label}</label>
            {view === 'guided' && <span className="hint">{question}</span>}<textarea id={`brief-${key}`} aria-label={label} maxLength={8000} rows={key === 'goal' ? 4 : 2} value={input.brief[key].value} onChange={e => field(key, e.target.value)}/>
            <span className="hint">{input.brief[key].source === 'user' ? '用户填写' : input.brief[key].source === 'template' ? '模板默认' : '系统建议'} · {input.brief[key].confirmed ? '已确认' : '待确认'}</span>
            <label className="confirmation"><input type="checkbox" aria-label={`确认${label}`} checked={input.brief[key].confirmed} disabled={!input.brief[key].value.trim()} onChange={e => {
              const confirmed = e.target.checked;
              setInput(previous => ({ ...previous, brief: { ...previous.brief, [key]: { ...previous.brief[key], confirmed } } })); setNotice('有未保存的修改');
            }}/>我已确认此字段</label></div>)}
          <div className="actions"><button className="primary" disabled={busy}>保存草稿</button><button type="button" className="secondary" disabled={!current || busy} onClick={() => { setError(''); void api(`/api/drafts/${current!.id}/runs`, 'POST', {}).catch(showError); }}>检查运行条件</button><span className="save-state" role="status">{notice}</span></div>
        </form><div className="workflow-next"><span>{current?'保存需求后，进入下一阶段。':'新建需求并保存后继续。'}</span><button type="button" className="secondary" disabled={!current||hasUnsavedChanges} onClick={()=>setActiveTab('assembly')}>下一步：环境与装配 →</button></div></div>
        {current && <section className="snapshot-section" aria-label="测试版本">
          <div id="tab-assembly" role="tabpanel" className="workflow-pane" hidden={activeTab!=='assembly'}>
          <section className="environment workflow-environment" aria-label="环境诊断"><div><strong>环境诊断</strong><p>配置状态不代表模型调用已通过运行核验</p></div><div><span className={environment?.database==='ready'?'badge good':'badge warning'}>数据库 {environment?.database==='ready'?'就绪':'不可用'}</span><span className="badge">模型 {environment?.model==='configured_unverified'?'已配置，待核验':'未配置'}</span><span className={environment?.canRun?'badge good':'badge warning'}>运行依赖 {environment?.canRun?'就绪':'未就绪'}</span><button type="button" className="secondary" onClick={()=>{void refresh().catch(showError);}}>重新检测</button></div></section>
          <div className="panel-head"><div><p className="eyebrow">02 / 选择组件与装配</p><h2>装配业务 Agent</h2></div><span className="badge">受限模板装配</span></div>
          <p className="muted">先选择能力模板或下方组件，再审阅装配预览。固定版本保存已确认的需求与配置，后续编辑不会改变它。</p>
          <label>能力模板<select value={assembly.toolIds.includes('work-order-create@1') ? 'equipment-workorder' : 'equipment-read'} onChange={e => { setAssemblyTouched(true); setAssembly(e.target.value === 'equipment-workorder' ? workOrderAssembly(current.brief.goal.value) : equipmentAssembly(current.brief.goal.value)); }}>
            <option value="equipment-read">设备状态查询</option><option value="equipment-workorder">设备查询与工单审批</option>
          </select></label>
          <ComponentCatalog assembly={assembly} onChange={value=>{setAssemblyTouched(true);setAssembly(value);}} disabled={busy} goal={current.brief.goal.value}/>
          <label>Agent 指令<textarea rows={3} value={assembly.systemPrompt} onChange={e => {setAssemblyTouched(true);setAssembly({ ...assembly, systemPrompt: e.target.value });}}/></label>
          <label>最大模型轮次<input type="number" min={1} max={20} value={assembly.maxIterations} onChange={e => {setAssemblyTouched(true);setAssembly({ ...assembly, maxIterations: Number(e.target.value) });}}/></label>
          <AssemblySummary assembly={assembly}/>
          <BaselineReview draft={current} templateId={assembly.toolIds.includes('work-order-create@1') ? 'equipment-workorder@1' : 'equipment-read@1'} enabled={Boolean(canFreeze)} api={api} onError={showError} onConfirmed={() => setBaselineRevision(value => value + 1)}/>
          <button type="button" className="primary" disabled={busy || !canFreeze} onClick={() => { void freeze(); }}>固定为测试版本 →</button>
          {!canFreeze && <p className="hint">填写、确认全部需求字段并保存后，可以固定版本。</p>}
          <div className="workflow-next"><span>固定后进入开发与测试；可先查看候选能力。</span><button type="button" className="secondary" disabled={!selectedSnapshotId} onClick={()=>setActiveTab('development')}>下一步：开发与测试 →</button></div>
          </div>
          <div id="tab-development" role="tabpanel" className="workflow-pane" hidden={activeTab!=='development'}>
          {snapshots.length>0&&<label className="snapshot-picker">当前测试版本<select aria-label="当前测试版本" value={selectedSnapshotId} onChange={e=>setSelectedSnapshotId(e.target.value)}>{snapshots.map(snapshot=><option key={snapshot.id} value={snapshot.id}>修订 r{snapshot.draftRevision} · {new Date(snapshot.createdAt).toLocaleString('zh-CN')} · {snapshot.id.slice(0,8)}</option>)}</select></label>}
          {snapshots.filter(snapshot=>snapshot.id===selectedSnapshotId).map(snapshot => <article className="snapshot-card" data-testid="snapshot-card" key={snapshot.id}>
            <strong>草稿修订 {snapshot.draftRevision} · {snapshot.id.slice(0, 8)}</strong><span className="badge">待验收</span>
            <p className="hint">摘要 {snapshot.digest.slice(0, 16)} · {new Date(snapshot.createdAt).toLocaleString('zh-CN')}</p>
            <details><summary>查看固定定义</summary><pre>{JSON.stringify(snapshot.content, null, 2)}</pre></details>
            {environment?.runtime !== 'not_implemented' && <DebugRun snapshotId={snapshot.id} writeEnabled={snapshot.content.assembly.toolIds.includes('work-order-create@1')} canRun={Boolean(environment?.canRun)} api={api} onError={showError}/>}
            <ProjectValidation snapshot={snapshot} baselineRevision={baselineRevision} canRun={Boolean(environment?.canRun)} api={api} onError={showError} showRelease={false} onReport={report=>setReports(previous=>report?{...previous,[snapshot.id]:report}:previous)}/>
          </article>)}
          {!snapshots.length&&<div className="workflow-empty"><strong>还没有固定测试版本</strong><p>确认需求、检查组件并审阅基线后，再固定一个版本。</p><button type="button" className="secondary" onClick={()=>setActiveTab('assembly')}>去环境与装配</button></div>}
          <div className="workflow-next"><span>候选验收通过后，可在下一阶段发布并通过业务对话验证。</span><button type="button" className="secondary" disabled={!selectedSnapshotId} onClick={()=>setActiveTab('release')}>下一步：发布与验证 →</button></div>
          </div>
          <div id="tab-release" role="tabpanel" className="workflow-pane" hidden={activeTab!=='release'}>
            {snapshots.filter(snapshot=>snapshot.id===selectedSnapshotId).map(snapshot=><div key={snapshot.id}><ProjectRelease snapshot={snapshot} {...(reports[snapshot.id]?{report:reports[snapshot.id]}:{})} api={api} onError={showError} onAvailabilityChange={available=>setPublished(previous=>({...previous,[snapshot.draftId]:available}))}/>{published[snapshot.draftId]?<DemoApp key={snapshot.draftId} agentId={snapshot.draftId} api={api} onError={showError}/>:<div className="workflow-empty"><strong>发布后开启业务对话</strong><p>成功发布并切换演示入口后，可以在这里以模拟企业身份发送消息。</p></div>}</div>)}
            {!selectedSnapshotId&&<div className="workflow-empty"><strong>发布与验证需要固定版本</strong><p>先完成环境与装配，固定测试版本并通过验收。</p><button type="button" className="secondary" onClick={()=>setActiveTab('assembly')}>去环境与装配</button></div>}
          </div>
        </section>}
        {!current && <ComponentCatalog/>}
        {error && <div className="error" role="alert">{error}</div>}
        <p className="footnote">运行使用本地 Mock 数据。点击运行后会调用已配置模型；调试记录不代表正式验收通过。</p>
      </section></div>
    </main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
