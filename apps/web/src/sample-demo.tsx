import {useEffect,useState} from 'react';
import type {Snapshot,EnvironmentStatus} from '../../../packages/contracts/src/index.js';
import type {Candidate} from '../../../packages/contracts/src/candidates.js';
import type {AcceptanceBaseline} from '../../../packages/contracts/src/baselines.js';
import type {ValidationReport} from '../../../packages/contracts/src/validations.js';
import type {Api} from './debug-run.js';
import {equipmentSample as sample,verifySample,matchesSampleReport} from './prebuilt-sample.js';
import {ProjectValidation} from './project-validation.js';
import {ProjectRelease} from './project-release.js';
import {DemoApp} from './demo-app.js';

const tabs=['需求说明','环境与装配','测试与证据','发布与对话'] as const;
export function SampleDemo({api,onClose}:{api:Api;onClose():void}) {
  const [data,setData]=useState<{candidate:Candidate;snapshot:Snapshot;baseline:AcceptanceBaseline}>();
  const [environment,setEnvironment]=useState<EnvironmentStatus>();
  const [error,setError]=useState('');const [tab,setTab]=useState(0);
  const [report,setReport]=useState<ValidationReport>();const [available,setAvailable]=useState(false);
  const [reload,setReload]=useState(0);
  function onError(value:unknown){setError(value instanceof Error?value.message:'请求失败');}
  useEffect(()=>{
    let alive=true;setData(undefined);setError('');setReport(undefined);
    void Promise.all([
      api<Candidate>(`/api/candidates/${sample.candidateId}`),
      api<{items:Snapshot[]}>(`/api/drafts/${sample.draftId}/snapshots`),
      api<{items:AcceptanceBaseline[]}>(`/api/drafts/${sample.draftId}/baselines`),
      api<EnvironmentStatus>('/api/environment')
    ]).then(([candidate,snapshots,baselines,env])=>{
      const snapshot=snapshots.items.find(item=>item.id===sample.snapshotId);
      const baseline=baselines.items.find(item=>item.id===sample.baselineId);
      verifySample(candidate,snapshot,baseline);
      if(alive){setData({candidate,snapshot:snapshot!,baseline:baseline!});setEnvironment(env);}
    }).catch(value=>{if(alive)onError(value);});return()=>{alive=false;};
  },[reload]);
  const generated=data?.candidate.generated?.runtimeArtifact;
  return <main className="workspace sample-workspace">
    <header><div><p className="eyebrow">AGENT BUILDER · 可操作样例</p><h1>设备查询 Agent</h1><p className="muted">固定需求 → 核验装配 → 独立验收 → 发布对话</p></div><button className="secondary" onClick={onClose}>返回开发工作台</button></header>
    <section className="panel sample-origin" aria-label="样例来源"><span className="badge good">预构建样例</span><strong>本次复用已有产物，未调用开发 Agent</strong><p>Tool 与 Rail 来自平台既有模板；本样例没有单独生成的 Skill 资产，查询流程写在固定 Agent 指令中。验收和对话会调用真实模型，业务接口使用虚构 Mock 数据。</p><details><summary>查看样例来源与固定版本</summary><p>来源证据：{sample.source}</p><p>构建来源：平台预构建 SDK 与固定装配，不涉及本次生成任务</p><p>候选：{sample.candidateId}</p><p>制品 SHA-256：{sample.artifactDigest}</p><p>候选内容摘要：{sample.bundleDigest}</p><p>当前目录仅适用于保留此候选及产物的本地主环境，不会在空环境自动重建。</p></details></section>
    {error&&<div role="alert" className="error">{error}</div>}
    {!data?<section className="panel"><p>{error?'样例不可用。请检查后端地址、访问权限和候选数据。':'正在核验样例…'}</p><button className="secondary" onClick={()=>setReload(v=>v+1)}>重新加载样例</button></section>:<>
      <nav className="workflow-tabs" role="tablist" aria-label="样例演示流程">{tabs.map((name,index)=><button type="button" role="tab" id={`sample-tab-${index}`} aria-controls={`sample-pane-${index}`} aria-selected={tab===index} className={`workflow-tab ${tab===index?'active':''}`} key={name} onClick={()=>setTab(index)}><span className="workflow-tab-number">0{index+1}</span><span className="workflow-tab-copy"><strong>{name}</strong><small>{['只读固定需求','查看实际组件','真实模型与 Mock','现有发布门禁'][index]}</small></span></button>)}</nav>
      <section className="panel editor sample-panel">
        <div role="tabpanel" id="sample-pane-0" aria-labelledby="sample-tab-0" hidden={tab!==0}><h2>已确认的样例需求</h2><p className="muted">此入口验证已有样例。修改需求或生成新组件，请返回开发工作台。</p>{([['audience','目标使用者'],['goal','业务目标'],['output','交付内容']] as const).map(([key,label])=><label key={key}>{label}<textarea aria-label={label} readOnly value={data.snapshot.content.draft.brief[key].value}/></label>)}<h3>独立验收场景</h3>{data.baseline.content.cases.map(c=><p key={c.id}><strong>{c.id} · {c.title}</strong><br/>{c.input}</p>)}</div>
        <div role="tabpanel" id="sample-pane-1" aria-labelledby="sample-tab-1" hidden={tab!==1}><h2>环境与实际装配</h2><p><span className={`badge ${environment?.canRun?'good':'warning'}`}>运行依赖{environment?.canRun?'就绪':'未就绪'}</span> 模型：{environment?.model==='configured_unverified'?'已配置，实际调用由验收核验':'未配置'}；执行方式：trusted-local</p><button className="secondary" onClick={()=>{void api<EnvironmentStatus>('/api/environment').then(setEnvironment).catch(onError);}}>重新检测环境</button>
          <div className="sample-components"><article><h3>Tool · 设备查询</h3>{data.candidate.runtimeSpec!.tools.map(t=><p key={t.name}><strong>{t.name}</strong><br/>{t.description}<br/><small>接口：{t.operationId}</small></p>)}</article><article><h3>Skill · 装载情况</h3>{generated?.kind!=='generated-component'&&<p>未装载独立 Skill；使用固定 Agent 指令。</p>}{generated?.kind==='generated-component'&&<><p>{generated.generated.skillName}</p><p className="hint">{generated.generated.skillPath}</p></>}</article><article><h3>Rail · 执行约束</h3><ul>{data.candidate.runtimeSpec!.agent.rails.map(r=><li key={r}>{r}</li>)}</ul><p className="hint">审计与工具白名单；本样例只开放设备查询接口。</p></article></div><label>固定 Agent 指令<textarea readOnly rows={4} value={data.candidate.runtimeSpec!.agent.systemPrompt}/></label><p>最大模型轮次：{data.candidate.runtimeSpec!.agent.maxIterations}</p></div>
        <div role="tabpanel" id="sample-pane-2" aria-labelledby="sample-tab-2" hidden={tab!==2}><ProjectValidation snapshot={data.snapshot} baselineRevision={0} canRun={Boolean(environment?.canRun)} api={api} onError={onError} showRelease={false} fixedSample={sample} onReport={value=>setReport(value&&matchesSampleReport(value)?value:undefined)}/></div>
        <div role="tabpanel" id="sample-pane-3" aria-labelledby="sample-tab-3" hidden={tab!==3}><ProjectRelease snapshot={data.snapshot} {...(report?{report}:{})} api={api} onError={onError} onAvailabilityChange={setAvailable}/>{available?<DemoApp agentId={sample.draftId} api={api} onError={onError}/>:<p className="hint">完成验收并发布后，可以进入模拟企业 App 发送设备查询请求。</p>}</div>
        <div className="workflow-next"><span>{tab+1} / 4 · {tabs[tab]}</span>{tab<3&&<button className="secondary" onClick={()=>setTab(v=>v+1)}>下一步：{tabs[tab+1]} →</button>}</div>
      </section>
    </>}
  </main>;
}
