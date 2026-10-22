import {useEffect,useRef,useState} from 'react';
import type {Snapshot} from '../../../packages/contracts/src/index.js';
import type {ValidationReport} from '../../../packages/contracts/src/validations.js';
import type {ReleaseInput,ReleaseOperation,ReleaseOverview,ReleaseVersion} from '../../../packages/contracts/src/releases.js';
import type {Api} from './debug-run.js';
const labels:Record<ReleaseOperation['status'],string>={queued:'等待发布',preparing:'准备部署',smoking:'只读冒烟中',succeeded:'发布成功',failed:'发布失败，原入口保留'};
export function ProjectRelease({snapshot,report,api,onError,onAvailabilityChange}:{snapshot:Snapshot;report?:ValidationReport;api:Api;onError(error:unknown):void;onAvailabilityChange?(available:boolean):void}){
  const [overview,setOverview]=useState<ReleaseOverview>();const [reviewed,setReviewed]=useState(false);const [busy,setBusy]=useState(false);const [submitted,setSubmitted]=useState<ReleaseOperation>();
  const request=useRef<ReleaseInput|null>(null);
  useEffect(()=>{
    let alive=true;let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{try{const next=await api<ReleaseOverview>(`/api/drafts/${snapshot.draftId}/releases`);if(alive){setOverview(next);onAvailabilityChange?.(Boolean(next.pointer));}}catch(error){if(alive)onError(error);}finally{if(alive)timer=setTimeout(()=>{void poll();},1500);}};
    void poll();return()=>{alive=false;if(timer)clearTimeout(timer);};
  },[snapshot.draftId]);
  useEffect(()=>{setReviewed(false);},[report?.executionId,overview?.pointer?.revision]);
  const operation=submitted?(overview?.operations.find(o=>o.id===submitted.id)??submitted):overview?.operations[0];
  const active=overview?.operations.some(o=>['queued','preparing','smoking'].includes(o.status))||submitted&&['queued','preparing','smoking'].includes(operation?.status??'');
  const eligible=report?.verdict==='passed'&&report.binding.modelProfile.executionMode==='live-mock'&&report.snapshotId===snapshot.id;
  const current=overview?.versions.find(v=>v.id===overview.pointer?.versionId);
  async function publish(version?:ReleaseVersion){
    if(!reviewed||busy||active||!overview||!version&&!eligible)return;
    const target={snapshotId:version?.snapshotId??snapshot.id,validationId:version?.validationId??report!.executionId,
      expectedRevision:overview.pointer?.revision??0,...(version?{rollbackVersionId:version.id}:{})};
    if(!request.current||Object.entries(target).some(([key,value])=>(request.current as unknown as Record<string,unknown>)[key]!==value))request.current={...target,clientRequestId:crypto.randomUUID()};
    setBusy(true);
    try{const value=await api<ReleaseOperation>(`/api/drafts/${snapshot.draftId}/releases`,'POST',request.current);request.current=null;setSubmitted(value);setOverview(await api(`/api/drafts/${snapshot.draftId}/releases`));}
    catch(error){onError(error);}finally{setBusy(false);}
  }
  return <section className="release-section" data-testid={`publication-${snapshot.id}`} aria-label="演示发布"><h3>演示发布</h3>
    <p className="muted">验收通过后准备独立演示实例，通过只读冒烟再切换现行版本。回滚重新准备历史版本，保留业务账本和旧运行记录。</p>
    {current?<p className="hint">现行发布记录：{current.id.slice(0,8)} · 快照 {current.snapshotId.slice(0,8)} · 修订 {overview?.pointer?.revision}</p>:<p className="hint">尚无已发布版本。</p>}
    {!eligible&&<p className="hint">请选择此快照已通过的真实模型验收报告后发布。</p>}
    <label className="confirmation"><input type="checkbox" checked={reviewed} disabled={busy||Boolean(active)||!overview} onChange={e=>setReviewed(e.target.checked)}/>我已审阅验收报告，同意切换演示入口</label>
    <button type="button" className="secondary" disabled={!eligible||!reviewed||busy||Boolean(active)||!overview} onClick={()=>{void publish();}}>发布此验证版本</button>
    {(operation||busy)&&<><p role="status" data-testid="release-status">{busy?'正在提交':labels[operation!.status]}</p>{operation&&<p className="hint">发布任务 {operation.id}{operation.diagnostic?` · ${operation.diagnostic}`:''}</p>}</>}
    {overview?.cleanupPending.length? <p className="hint">失败实例清理仍在核对中，原发布记录保留。</p>:null}
    {overview&&overview.versions.length>0&&<details><summary>发布历史（{overview.versions.length}）</summary>{overview.versions.map(version=><article key={version.id} className="release-history">
      <p>版本 {version.id.slice(0,8)} · 快照 {version.snapshotId.slice(0,8)} · {new Date(version.createdAt).toLocaleString('zh-CN')}</p>
      {version.id!==current?.id&&<button type="button" className="secondary" disabled={!reviewed||busy||Boolean(active)} onClick={()=>{void publish(version);}}>回滚到 {version.id.slice(0,8)}</button>}
      <details><summary>只读冒烟证据</summary><pre>{JSON.stringify(version.smokeEvidence,null,2)}</pre></details>
    </article>)}</details>}
  </section>;
}
