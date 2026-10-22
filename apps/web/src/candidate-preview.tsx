import {useEffect,useRef,useState} from 'react';
import type {Api} from './debug-run.js';
import {DemoApp} from './demo-app.js';
import type {Snapshot} from '../../../packages/contracts/src/index.js';
import type {AcceptanceBaseline} from '../../../packages/contracts/src/baselines.js';
import type {Candidate,TestDeployment,TestDeploymentInput} from '../../../packages/contracts/src/candidates.js';
import {canonicalJson} from '../../../packages/contracts/src/canonical.js';
import type {DevelopmentJob} from '../../../packages/contracts/src/development.js';
const labels={preparing:'准备中',ready:'就绪',stopping:'正在停止',stopped:'已停止',failed:'准备失败'};
export function CandidatePreview({snapshot,baseline,api,onError,onRegistered}:{snapshot:Snapshot;baseline:AcceptanceBaseline|undefined;api:Api;onError(error:unknown):void;onRegistered?(candidate:Candidate):void}){
  const [candidate,setCandidate]=useState<Candidate>();const [history,setHistory]=useState<TestDeployment[]>([]);const [target,setTarget]=useState<TestDeployment>();const [busy,setBusy]=useState(false);
  const [builds,setBuilds]=useState<DevelopmentJob[]>([]);const [source,setSource]=useState('template');const [refresh,setRefresh]=useState(0);
  const pending=useRef<TestDeploymentInput|undefined>(undefined);
  useEffect(()=>{let active=true;setCandidate(undefined);setSource('template');void api<{items:Candidate[]}>(`/api/drafts/${snapshot.draftId}/candidates`).then(value=>{if(active){const current=value.items.find(item=>item.snapshotId===snapshot.id);setCandidate(current);setSource(current?.generated?.developmentJobId??'template');}}).catch(onError);return()=>{active=false;};},[snapshot.id]);
  useEffect(()=>{let active=true;void api<{items:DevelopmentJob[]}>(`/api/drafts/${snapshot.draftId}/development`).then(value=>{if(active)setBuilds(value.items.filter(item=>item.snapshotId===snapshot.id&&item.status==='built'&&item.baselineId===baseline?.id));}).catch(onError);return()=>{active=false;};},[snapshot.id,baseline?.id,refresh]);
  useEffect(()=>{let active=true;setHistory([]);setTarget(undefined);pending.current=undefined;if(candidate)void api<{items:TestDeployment[]}>(`/api/candidates/${candidate.id}/test-deployments`).then(value=>{if(active){const previews=value.items.filter(item=>item.purpose==='preview');setHistory(previews);setTarget(previews[0]);}}).catch(onError);return()=>{active=false;};},[candidate?.id]);
  useEffect(()=>{
    if(!target||['stopped','failed'].includes(target.status))return;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{try{const value=await api<TestDeployment>(`/api/test-deployments/${target.id}`);if(!active)return;setTarget(value);setHistory(previous=>previous.map(item=>item.id===value.id?value:item));
      if(!['stopped','failed'].includes(value.status))timer=setTimeout(()=>{void poll();},1500);
    }catch(error){if(active)onError(error);}};void poll();return()=>{active=false;if(timer)clearTimeout(timer);};
  },[target?.id]);
  async function register(){setBusy(true);try{const value=await api<Candidate>('/api/candidates','POST',{snapshotId:snapshot.id,...(source==='template'?{}:{developmentJobId:source})});setCandidate(value);onRegistered?.(value);}catch(error){onError(error);}finally{setBusy(false);}}
  async function start(){
    if(!candidate||!baseline)return;setBusy(true);
    try{
      if(!pending.current||pending.current.candidateId!==candidate.id||pending.current.requirementBaselineId!==baseline.id){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(baseline.content.cases)));const suiteDigest=Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');
        pending.current={candidateId:candidate.id,requirementBaselineId:baseline.id,suiteDigest,clientRequestId:crypto.randomUUID(),purpose:'preview',ttlSeconds:3600};}
      const value=await api<TestDeployment>('/api/test-deployments','POST',pending.current);pending.current=undefined;setTarget(value);setHistory(previous=>[value,...previous.filter(item=>item.id!==value.id)]);
    }catch(error){onError(error);}finally{setBusy(false);}
  }
  const active=target&&!['stopped','failed'].includes(target.status);
  return <section className="candidate-preview demo-app" data-testid={`candidate-${snapshot.id}`}><h3>固定候选与独立预览</h3>
    <p className="muted">选择模板装配或已完成的生成构建，登记固定候选后可在独立数据环境预览，无需先发布。预览不代表完整项目验收通过。</p>
    <label>候选来源<select value={source} disabled={busy||Boolean(active)} onChange={event=>setSource(event.target.value)}><option value="template">模板装配</option>{builds.map(build=><option key={build.id} value={build.id}>生成 Tool 与 Skill · {build.id.slice(0,8)}</option>)}</select></label>
    <p className="hint" data-testid="selected-components">{source==='template'?'待登记：内置 Tool + 模板 Rail；未绑定 Skill。':'待登记：生成的设备查询 Tool + equipment-query Skill + 模板 Rail。'}</p>
    <button type="button" className="secondary" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>刷新可用构建</button>
    <button type="button" className="secondary" disabled={busy||Boolean(active)||source!=='template'&&!builds.some(build=>build.id===source)} onClick={()=>{void register();}}>登记固定候选</button>
    {candidate&&<><p className="hint" data-testid="candidate-id">候选 {candidate.id}</p><p data-testid="candidate-source">来源：{candidate.provenance==='generated-component'?'自动生成 Tool 与 Skill':'模板装配'}</p><p className="hint" data-testid="bound-skill">{candidate.provenance==='generated-component'?'已绑定 Skill：equipment-query（版本由候选制品摘要固定）':'此候选未绑定 Skill，使用内置 Tool。'}</p><details><summary>固定制品与装配摘要</summary><pre>{JSON.stringify(candidate,null,2)}</pre></details>
      <button type="button" className="secondary" disabled={busy||!baseline||Boolean(active)||Boolean(candidate.generated&&candidate.generated.baselineId!==baseline?.id)} onClick={()=>{void start();}}>{pending.current?'重试创建预览':'启动独立预览'}</button>
      {candidate.generated&&candidate.generated.baselineId!==baseline?.id&&<p className="hint">请使用生成此候选时确认的验收基线。</p>}
      {!baseline&&<p className="hint">请选择与当前版本匹配的已确认验收基线。</p>}
      {history.length>0&&<label>预览部署记录<select value={target?.id??''} disabled={busy} onChange={e=>setTarget(history.find(item=>item.id===e.target.value))}>{history.map(item=><option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {labels[item.status]}</option>)}</select></label>}
      {target&&<><p role="status" data-testid="test-deployment-status">{labels[target.status]}</p><p className="hint">有效至 {new Date(target.expiresAt).toLocaleString('zh-CN')}。关闭页面不会停止部署。</p>
        {target.diagnostic&&<p className="hint">{target.diagnostic}</p>}
        {active&&<button type="button" className="secondary" disabled={busy||target.status==='stopping'} onClick={()=>{setBusy(true);void api<TestDeployment>(`/api/test-deployments/${target.id}/stop`,'POST',{}).then(setTarget).catch(onError).finally(()=>setBusy(false));}}>停止测试部署</button>}
        <details><summary>部署绑定</summary><pre data-testid="test-deployment-evidence">{JSON.stringify(target,null,2)}</pre></details>
        {target.status==='ready'&&<DemoApp key={target.id} agentId={snapshot.draftId} testDeploymentId={target.id} api={api} onError={onError}/>}
      </>}
    </>}
  </section>;
}
