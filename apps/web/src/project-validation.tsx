import { useEffect, useRef, useState } from 'react';
import type { Draft, Snapshot } from '../../../packages/contracts/src/index.js';
import type { AcceptanceBaseline, BaselinePreview, BaselineTemplateId } from '../../../packages/contracts/src/baselines.js';
import type { ValidationExecution, ValidationInput, ValidationReport, ValidationVerdict } from '../../../packages/contracts/src/validations.js';
import type { Api } from './debug-run.js';
import {ProjectRelease} from './project-release.js';
import {CandidatePreview} from './candidate-preview.js';
import {DevelopmentPanel} from './development-panel.js';
import type {Candidate} from '../../../packages/contracts/src/candidates.js';
const labels: Record<ValidationVerdict, string> = { passed: '通过', failed: '未通过', blocked: '阻塞', unverified: '未验证' };
export function BaselineReview({ draft, templateId, enabled, api, onError, onConfirmed }: { draft: Draft; templateId: BaselineTemplateId; enabled: boolean; api: Api; onError(error: unknown): void; onConfirmed(): void }) {
  const [preview, setPreview] = useState<BaselinePreview>(); const [reviewed, setReviewed] = useState(false); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true; setPreview(undefined); setReviewed(false); setConfirmed(false);
    if (enabled) void api<BaselinePreview>(`/api/drafts/${draft.id}/baseline-preview?templateId=${templateId}`).then(value => { if (mounted) setPreview(value); }).catch(onError);
    return () => { mounted = false; };
  }, [draft.id, draft.revision, templateId, enabled]);
  async function confirm() {
    if (!preview || !reviewed || !enabled) return; setBusy(true);
    try { await api(`/api/drafts/${draft.id}/baselines`, 'POST', { templateId, expectedRevision: draft.revision, expectedDigest: preview.digest, confirmed: true }); setConfirmed(true); onConfirmed(); }
    catch (error) { onError(error); } finally { setBusy(false); }
  }
  return <section data-testid="baseline-review" className="baseline-review"><h3>审阅验收基线</h3>
    <p className="muted">基线固定本次需求、必测场景和预期结果。修复代码可以复用同一需求修订的基线。</p>
    {!preview && <p className="hint">保存并确认全部需求字段后，查看验收场景。</p>}
    {preview && <><ul>{preview.content.requirements.map(r => <li key={r.id}><strong>{r.id}</strong> {r.text} <small>（{r.source === 'user' ? '用户需求' : '模板要求'}）</small></li>)}</ul>
      {preview.content.cases.map(c => <details key={c.id}><summary>{c.id} · {c.title} · 必测</summary><p>{c.input}</p><p className="hint">关联需求：{c.requirementIds.join('、')} · 故障条件：{c.fault}</p><pre>{JSON.stringify(c.assertions, null, 2)}</pre></details>)}
      <label className="confirmation"><input type="checkbox" checked={reviewed} disabled={busy || confirmed} onChange={e => setReviewed(e.target.checked)}/>我已审阅需求、测试场景和预期结果</label>
      <button type="button" className="secondary" disabled={!reviewed || busy || confirmed || !enabled} onClick={() => { void confirm(); }}>确认验收基线</button>{confirmed && <p role="status">基线已确认</p>}
    </>}
  </section>;
}
export function ProjectValidation({ snapshot, baselineRevision, canRun, api, onError, showRelease = true, onReport }: { snapshot: Snapshot; baselineRevision: number; canRun: boolean; api: Api; onError(error: unknown): void; showRelease?: boolean; onReport?(report?: ValidationReport): void }) {
  const [baselines, setBaselines] = useState<AcceptanceBaseline[]>([]); const [selected, setSelected] = useState(''); const [allowWrites, setAllowWrites] = useState(false);
  const [history, setHistory] = useState<ValidationExecution[]>([]); const [execution, setExecution] = useState<ValidationExecution>(); const [report, setReport] = useState<ValidationReport>(); const [evidence, setEvidence] = useState<unknown>(); const [busy, setBusy] = useState(false);
  const pending = useRef<ValidationInput | null>(null); const financeProfile=snapshot.content.connectionProfile==='mock-finance@1';const writeEnabled = snapshot.content.assembly.toolIds.includes('work-order-create@1');
  const [candidates,setCandidates]=useState<Candidate[]>([]);const [candidateId,setCandidateId]=useState('');const [candidateRefresh,setCandidateRefresh]=useState(0);
  useEffect(()=>{let mounted=true;void api<{items:Candidate[]}>(`/api/drafts/${snapshot.draftId}/candidates`).then(value=>{if(mounted)setCandidates(value.items.filter(item=>item.snapshotId===snapshot.id));}).catch(onError);return()=>{mounted=false;};},[snapshot.id,candidateRefresh]);
  useEffect(() => {
    let mounted = true;
    void api<{ items: AcceptanceBaseline[] }>(`/api/drafts/${snapshot.draftId}/baselines`).then(list => {
      if (!mounted) return; const templateId = financeProfile ? 'wealth-balance-read@1' : writeEnabled ? 'equipment-workorder@1' : 'equipment-read@1'; const rulesVersion = financeProfile ? 'wealth-balance-assertions@2' : writeEnabled ? 'equipment-workorder-assertions@3' : 'equipment-assertions@2'; const compatible = list.items.filter(b => b.draftRevision === snapshot.draftRevision && b.content.templateId === templateId && b.content.rulesVersion === rulesVersion);
      setBaselines(compatible); setSelected(compatible[0]?.id ?? '');
    }).catch(onError);
    return () => { mounted = false; };
  }, [snapshot.id, baselineRevision,financeProfile]);
  useEffect(() => {
    let mounted = true; void api<{ items: ValidationExecution[] }>(`/api/snapshots/${snapshot.id}/validations`).then(value => { if (mounted) { setHistory(value.items); setExecution(value.items[0]); } }).catch(onError);
    return () => { mounted = false; };
  }, [snapshot.id]);
  useEffect(() => {
    setReport(undefined); onReport?.(undefined); setEvidence(undefined); if (!execution) return;
    let mounted = true; let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const current = await api<ValidationExecution>(`/api/validations/${execution!.id}`); if (!mounted) return;
        setExecution(current); setHistory(previous => previous.map(item => item.id === current.id ? current : item));
        if (current.status === 'completed') { const value = await api<ValidationReport>(`/api/validations/${current.id}/report`); if (mounted) { setReport(value); onReport?.(value); } }
        else timer = setTimeout(() => { void poll(); }, 1500);
      } catch (error) { if (mounted) { onError(error); timer = setTimeout(() => { void poll(); }, 3000); } }
    }
    void poll(); return () => { mounted = false; if (timer) clearTimeout(timer); };
  }, [execution?.id]);
  async function start() {
    if (!selected) return; setBusy(true);
    if (!pending.current || pending.current.baselineId !== selected || pending.current.allowMockWrites !== allowWrites||pending.current.candidateId!==(candidateId||undefined)) pending.current = { clientRequestId: crypto.randomUUID(), baselineId: selected, allowMockWrites: allowWrites,...(candidateId?{candidateId}:{}) };
    try { const value = await api<ValidationExecution>(`/api/snapshots/${snapshot.id}/validations`, 'POST', pending.current); pending.current = null; setExecution(value); setHistory(previous => [value, ...previous.filter(p => p.id !== value.id)]); }
    catch (error) { onError(error); } finally { setBusy(false); }
  }
  const active = execution && execution.status !== 'completed';
  const selectedCandidate=candidates.find(c=>c.id===candidateId);const financeCandidateReady=Boolean(selectedCandidate?.generated?.baselineId===selected&&selectedCandidate.generated.runtimeArtifact.kind==='generated-component'&&selectedCandidate.generated.runtimeArtifact.generated.operationId==='getAccountBalance');
  const incompatibleCandidate=Boolean(candidateId&&!candidates.some(c=>c.id===candidateId&&(!c.generated||c.generated.baselineId===selected))||financeProfile&&candidateId&&!financeCandidateReady);
  return <section className="validation-section" data-testid={`validation-${snapshot.id}`} aria-label="项目验收"><h3>项目验收</h3>
    <DevelopmentPanel snapshot={snapshot} baseline={baselines.find(item=>item.id===selected)} {...(report?{repairReport:report}:{})} api={api} onError={onError}/>
    <CandidatePreview snapshot={snapshot} baseline={baselines.find(item=>item.id===selected)} api={api} onError={onError} onRegistered={value=>{setCandidates(previous=>[value,...previous.filter(c=>c.id!==value.id)]);if(!active)setCandidateId(value.id);}}/>
    <p className="muted">选择固定候选后，平台通过测试入口逐项执行已确认场景，并为每项用例创建独立数据环境。报告绑定候选、测试计划与实际制品；页面关闭后任务继续运行。</p>
    <label>自动验收目标<select value={candidateId} disabled={busy||Boolean(active)} onChange={event=>setCandidateId(event.target.value)}>{!financeProfile&&<option value="">当前模板装配（未指定候选）</option>}{candidates.map(c=><option key={c.id} value={c.id}>{c.provenance==='generated-component'?'生成 Tool 与 Skill':'固定模板候选'} · {c.id.slice(0,8)}</option>)}</select></label>
    <button type="button" className="secondary" disabled={busy} onClick={()=>setCandidateRefresh(value=>value+1)}>刷新验收候选</button>
    {incompatibleCandidate&&<p className="hint">请选择与当前验收基线匹配的候选。</p>}
    {baselines.length ? <label>使用验收基线<select value={selected} disabled={busy || Boolean(active)} onChange={e => setSelected(e.target.value)}>{baselines.map(b => <option key={b.id} value={b.id}>{b.id.slice(0, 8)} · {b.content.cases.length} 个必测场景</option>)}</select></label> : <p className="hint">此需求修订尚未确认匹配的验收基线。</p>}
    {writeEnabled && <label className="confirmation"><input type="checkbox" checked={allowWrites} disabled={busy || Boolean(active)} onChange={e => setAllowWrites(e.target.checked)}/>允许测试执行器按场景批准模拟工单写入</label>}
    {financeProfile&&!candidateId&&<p className="hint">余额用例必须运行刚生成的候选，避免用未绑定 Tool 的空模板代替真实生成产物。</p>}
    <button type="button" className="secondary" disabled={busy || Boolean(active) || !canRun || !selected || incompatibleCandidate || financeProfile&&!financeCandidateReady || writeEnabled && !allowWrites} onClick={() => { void start(); }}>运行验收用例</button>
    {history.length > 0 && <label>验证记录<select value={execution?.id ?? ''} onChange={e => setExecution(history.find(item => item.id === e.target.value))}>{history.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.verdict ? labels[item.verdict] : '进行中'}</option>)}</select></label>}
    {execution && <><p className="hint" data-testid="validation-id">验证任务 {execution.id}</p>
      <p className="hint" data-testid="validation-candidate">{execution.binding.candidate?`验收候选 ${execution.binding.candidate.id}`:'模板装配验收'} · 制品 {execution.binding.artifactDigest.slice(0,12)}</p>
      <span className={`badge ${report?.verdict === 'passed' ? 'good' : 'warning'}`} data-testid="validation-status">{report ? labels[report.verdict] : execution.status === 'cancelling' ? '正在取消' : execution.status === 'completed' ? '正在读取报告' : '验证中'}</span>
      <p className="hint">已完成 {execution.cases.filter(c => c.state === 'completed').length} / {execution.cases.length} 个场景</p>
      {active && <button type="button" className="secondary" disabled={execution.status === 'cancelling'} onClick={() => { void api<ValidationExecution>(`/api/validations/${execution.id}/cancel`, 'POST', {}).then(setExecution).catch(onError); }}>取消验证</button>}
    </>}
    {report && <><p className="hint">{report.binding.modelProfile.executionMode === 'live-mock' ? '真实模型 + 模拟业务环境' : '当前环境不满足真实模型验收要求'}。本报告仅覆盖所选项目基线，不代表平台全部需求通过。</p>
      {report.reasons.length > 0 && <p className="hint">{report.reasons.join('、')}</p>}
      {report.cases.map(c => <details key={c.caseId}><summary>{c.caseId} · {labels[c.status]}</summary>{c.reasons.length > 0 && <p>{c.reasons.join('、')}</p>}
        {c.assertions.map(a => <p key={a.ruleId}><strong>{labels[a.status]}</strong> · {a.ruleId}<br/><span className="hint">预期 {JSON.stringify(a.expected)}；实际 {JSON.stringify(a.actual)}</span></p>)}
        {c.evidenceId && <button type="button" className="secondary" aria-label={`查看证据 ${c.caseId}`} onClick={() => { void api(`/api/validations/${report.executionId}/evidence/${c.evidenceId}`).then(setEvidence).catch(onError); }}>查看证据 {c.caseId}</button>}
      </details>)}
      <details><summary>验收版本与摘要</summary><pre>{JSON.stringify(report.binding, null, 2)}</pre></details>
    </>}
    {evidence !== undefined && <pre data-testid="validation-evidence">{JSON.stringify(evidence, null, 2)}</pre>}
    {showRelease && <ProjectRelease snapshot={snapshot} {...(report?{report}:{})} api={api} onError={onError}/>}
  </section>;
}
