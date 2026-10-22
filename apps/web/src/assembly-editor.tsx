import { useState } from 'react';
import type { AssemblyInput } from '../../../packages/contracts/src/index.js';
import { componentCatalog, selectCapability } from './assembly-selection.js';

export function ComponentCatalog({ assembly, onChange, disabled = false, goal = '' }: {
  assembly?: AssemblyInput; onChange?(value: AssemblyInput): void; disabled?: boolean; goal?: string;
}) {
  const [filter, setFilter] = useState('全部');
  const write = assembly?.toolIds.includes('work-order-create@1') ?? false;
  return <section className="component-library" id="component-library" aria-label="组件目录">
    <div className="panel-head"><div><p className="eyebrow">组件目录</p><h2>选择能力，查看执行约束</h2></div><span className="badge">2 Tool · 1 Skill · 3 Rail</span></div>
    <p className="muted">Tool 连接业务接口，Skill 提供任务方法，Rail 约束执行行为。当前支持设备只读与工单审批两种组合。</p>
    <div className="component-filters" aria-label="组件类型">{['全部', 'Skill', 'Rail', 'Tool'].map(kind => <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{kind}</button>)}</div>
    <div className="component-grid">{componentCatalog.filter(item => filter === '全部' || item.kind === filter).map(item => {
      const selected = Boolean(assembly && [...assembly.toolIds, ...assembly.railIds].includes(item.id));
      return <article key={item.id} className={`component-card ${selected ? 'is-selected' : ''}`}>
        <div className="component-heading"><span className="component-kind">{item.kind}</span><span className={`badge ${selected ? 'good' : item.kind === 'Skill' ? 'warning' : ''}`}>{selected ? '已装配' : item.status}</span></div>
        <h3>{item.name}</h3><code>{item.id}</code><p>{item.description}</p><small>{item.detail}</small>
        {assembly && item.id === 'work-order-create@1' && <label className="confirmation"><input type="checkbox" aria-label="装配维修工单" checked={write} disabled={disabled} onChange={e => onChange?.(selectCapability(assembly, e.target.checked, goal))}/>装配维修工单</label>}
        {assembly && item.id === 'equipment-status@1' && <span className="component-rule">当前组合必需</span>}
        {assembly && item.kind === 'Rail' && <span className="component-rule">{selected ? '随能力组合启用' : '选择工单能力后启用'}</span>}
        {item.kind === 'Skill' && <span className="component-rule">{write ? '工单组合暂不支持生成 Skill' : '固定版本 → 自动开发 → 选择生成候选'}</span>}
      </article>;
    })}</div>
    {!assembly && <p className="hint">创建并保存需求后，可选择组件并固定装配版本。</p>}
  </section>;
}

export function AssemblySummary({ assembly }: { assembly: AssemblyInput }) {
  const names = (ids: string[]) => ids.map(id => componentCatalog.find(item => item.id === id)?.name ?? id).join('、');
  return <aside className="assembly-summary" aria-label="装配预览">
    <div><strong>装配预览</strong><span className="badge good">openJiuwen DeepAgent</span></div>
    <dl><dt>Tool</dt><dd>{names(assembly.toolIds)}</dd><dt>Rail</dt><dd>{names(assembly.railIds)}</dd><dt>Skill</dt><dd>模板未绑定；自动开发完成后，通过生成候选绑定设备查询 Skill。</dd></dl>
    <p>确认验收基线 → 固定为测试版本 → 调试或自动开发 → 候选验收与发布</p>
  </aside>;
}
