import { useEffect, useRef, useState } from 'react';
import type { RunRecord, RunEvent } from '../../../packages/contracts/src/runs.js';
import type { ActionRecord } from '../../../packages/contracts/src/actions.js';
export type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
const labels: Record<RunRecord['status'], string> = { queued: '准备运行', running: '运行中', waiting_confirmation: '等待确认', reconciling: '正在核对写入结果', cancelling: '正在取消', succeeded: '已完成', failed: '执行失败', cancelled: '已取消', interrupted: '已中断，需核对' };
const active = (run?: RunRecord) => run && ['queued', 'running', 'waiting_confirmation', 'reconciling', 'cancelling'].includes(run.status);
export function DebugRun({ snapshotId, canRun, writeEnabled = false, api, onError }: { snapshotId: string; canRun: boolean; writeEnabled?: boolean; api: Api; onError(error: unknown): void }) {
  const [input, setInput] = useState(writeEnabled ? '查询 PUMP-001 的状态、温度与来源，并申请创建检查工单。' : '查询 PUMP-001 的状态、温度与来源。');
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]); const [run, setRun] = useState<RunRecord>(); const [events, setEvents] = useState<RunEvent[]>([]); const [busy, setBusy] = useState(false);
  const pending = useRef<{ clientRequestId: string; input: string } | null>(null);
  useEffect(() => {
    let mounted = true;
    void api<{ items: RunRecord[] }>(`/api/snapshots/${snapshotId}/runs`).then(list => { if (mounted) { setRuns(list.items); setRun(list.items[0]); } }).catch(onError);
    return () => { mounted = false; };
  }, [snapshotId]);
  useEffect(() => {
    if (!run) return;
    setActions([]);
    let mounted = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const [record, history, pendingActions] = await Promise.all([api<RunRecord>(`/api/runs/${run.id}`), api<{ items: RunEvent[] }>(`/api/runs/${run.id}/events`), api<{ items: ActionRecord[] }>(`/api/runs/${run.id}/actions`)]);
        if (!mounted) return; setRun(record); setEvents(history.items); setActions(pendingActions.items); setRuns(previous => previous.map(r => r.id === record.id ? record : r));
        if (active(record)) timer = setTimeout(() => { void poll(); }, 1500);
      } catch (error) { if (mounted) { onError(error); timer = setTimeout(() => { void poll(); }, 3000); } }
    };
    void poll(); return () => { mounted = false; if (timer) clearTimeout(timer); };
  }, [run?.id]);
  async function start() {
    setBusy(true);
    if (!pending.current || pending.current.input !== input) pending.current = { clientRequestId: crypto.randomUUID(), input };
    try {
      const record = await api<RunRecord>(`/api/snapshots/${snapshotId}/runs`, 'POST', pending.current);
      pending.current = null; setRun(record); setEvents([]); setRuns(previous => [record, ...previous.filter(r => r.id !== record.id)]);
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  async function decide(action: ActionRecord, decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      const changed = await api<ActionRecord>(`/api/runs/${action.runId}/actions/${action.id}/decision`, 'POST', { decisionId: crypto.randomUUID(), decision, actionHash: action.actionHash });
      setActions(previous => previous.map(item => item.id === changed.id ? changed : item));
      setRun(await api<RunRecord>(`/api/runs/${action.runId}`));
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  const result = run?.result as { result?: { content?: unknown } } | undefined;
  const answer = typeof result?.result?.content === 'string' ? result.result.content : run?.result ? JSON.stringify(run.result, null, 2) : '';
  return <section className="debug-run" aria-label="版本调试">
    <label>调试消息<textarea value={input} rows={2} maxLength={8000} onChange={event => setInput(event.target.value)}/></label>
    <div className="actions"><button type="button" className="primary" disabled={!canRun || busy || Boolean(active(run)) || !input.trim()} onClick={() => { void start(); }}>运行此版本</button>
      {active(run) && <button type="button" className="secondary" disabled={busy || run?.status === 'cancelling'} onClick={() => { if (run) void api<RunRecord>(`/api/runs/${run.id}/cancel`, 'POST', {}).then(setRun).catch(onError); }}>取消运行</button>}
      {run && <span className="badge" data-testid="run-status">{labels[run.status]}</span>}</div>
    {!canRun && <p className="hint">运行依赖未就绪，请检查环境诊断。</p>}
    {runs.length > 1 && <label>运行历史<select value={run?.id ?? ''} onChange={event => { setRun(runs.find(r => r.id === event.target.value)); setEvents([]); }}>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString('zh-CN')} · {labels[r.status]}</option>)}</select></label>}
    {run && <div className="run-result"><p className="hint" data-testid="run-id">Run {run.id}</p>
      {run.diagnostic && <p className="hint">诊断：{run.diagnostic}</p>}
      {answer && <pre className="answer" data-testid="run-answer">{answer}</pre>}
      {actions.map(action => <section className="approval-card" data-testid="approval-card" key={action.id} aria-label="模拟工单确认">
        <strong>创建模拟维修工单</strong><p>设备 {String(action.args.equipmentId)} · 优先级 {action.args.priority === 'urgent' ? '紧急' : '普通'}</p>
        <p>{String(action.args.description)}</p><p className="hint">仅影响当前 Mock 环境。确认有效期至 {new Date(action.expiresAt).toLocaleString('zh-CN')}。</p>
        {action.status === 'pending' && run.status === 'waiting_confirmation' ? <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => { void decide(action, 'approve'); }}>确认创建模拟工单</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { void decide(action, 'reject'); }}>拒绝并取消运行</button>
        </div> : <p className="hint">动作状态：{({ pending: '已停止等待确认', approved: '已批准，准备执行', rejected: '已拒绝', expired: '确认已过期', invalidated:'参数已变化，原确认失效', executing: '正在执行', unknown: '结果待核对', succeeded: '已完成', failed: '执行失败' } as const)[action.status]}</p>}
        <details><summary>查看动作绑定</summary><p className="hint">用户 {action.actorId} · Run {action.runId}<br/>动作 {action.id}<br/>版本摘要 {action.snapshotDigest}<br/>参数摘要 {action.paramsHash}</p></details>
      </section>)}
      <details><summary>查看执行轨迹（{events.length}）</summary><pre>{JSON.stringify(events, null, 2)}</pre></details>
      <details><summary>查看外部调用证据</summary><pre data-testid="external-evidence">{JSON.stringify(run.externalEvidence, null, 2)}</pre></details>
      <p className="hint">这是固定版本的调试记录，尚未形成需求验收结论。</p></div>}
  </section>;
}
