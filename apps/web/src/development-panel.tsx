import {useEffect,useRef,useState} from 'react';
import type {Snapshot} from '../../../packages/contracts/src/index.js';
import type {AcceptanceBaseline} from '../../../packages/contracts/src/baselines.js';
import type {DevelopmentInput,DevelopmentJob,EngineeringEvent,CommandResult} from '../../../packages/contracts/src/development.js';
import type {ValidationReport} from '../../../packages/contracts/src/validations.js';
import {equipmentGenerationRequest} from '../../../packages/contracts/src/generation-profile.js';
import type {Api} from './debug-run.js';
const labels={queued:'排队中',running:'开发中',cancelling:'正在取消',cancelled:'已取消',failed:'开发失败',reconciling:'待核对',built:'构建完成'};
const terminal=(job:DevelopmentJob)=>['built','failed','cancelled'].includes(job.status);
export function DevelopmentPanel({snapshot,baseline,repairReport,api,onError}:{snapshot:Snapshot;baseline:AcceptanceBaseline|undefined;repairReport?:ValidationReport;api:Api;onError(error:unknown):void}){
 const [history,setHistory]=useState<DevelopmentJob[]>([]);const [job,setJob]=useState<DevelopmentJob>();const [events,setEvents]=useState<EngineeringEvent[]>([]);const [review,setReview]=useState<{title:string;text:string}>();const [busy,setBusy]=useState(false);
 const pending=useRef<DevelopmentInput|undefined>(undefined);
 useEffect(()=>{let mounted=true;setJob(undefined);setHistory([]);pending.current=undefined;
  void api<{items:DevelopmentJob[]}>(`/api/drafts/${snapshot.draftId}/development`).then(value=>{if(mounted){const own=value.items.filter(item=>item.snapshotId===snapshot.id);setHistory(own);setJob(own[0]);}}).catch(onError);return()=>{mounted=false;};
 },[snapshot.id]);
 useEffect(()=>{
  setEvents([]);setReview(undefined);if(!job)return;let mounted=true;let timer:ReturnType<typeof setTimeout>|undefined;let cursor=0;
  const poll=async()=>{try{
   const [current,page]=await Promise.all([api<DevelopmentJob>(`/api/development/${job.id}`),api<{items:EngineeringEvent[]}>(`/api/development/${job.id}/events?after=${cursor}`)]);
   if(!mounted)return;setJob(current);setHistory(previous=>previous.map(item=>item.id===current.id?current:item));
   if(page.items.length){cursor=page.items.at(-1)!.sequence;setEvents(previous=>[...previous,...page.items]);}
   if(!terminal(current)||page.items.length===500)timer=setTimeout(()=>{void poll();},1500);
  }catch(error){if(mounted){onError(error);timer=setTimeout(()=>{void poll();},3000);}}};void poll();return()=>{mounted=false;if(timer)clearTimeout(timer);};
 },[job?.id]);
 async function start(repairExecutionId?:string){
  if(!baseline||baseline.content.templateId!=='equipment-read@1')return;setBusy(true);
  if(!pending.current||pending.current.baselineId!==baseline.id||pending.current.repairExecutionId!==repairExecutionId)pending.current={clientRequestId:crypto.randomUUID(),baselineId:baseline.id,generation:{...equipmentGenerationRequest,scope:[...equipmentGenerationRequest.scope],dependencies:[...equipmentGenerationRequest.dependencies]},maxSeconds:900,...(repairExecutionId?{repairExecutionId}:{})};
  try{const value=await api<DevelopmentJob>(`/api/snapshots/${snapshot.id}/development`,'POST',pending.current);pending.current=undefined;setJob(value);setHistory(previous=>[value,...previous.filter(item=>item.id!==value.id)]);}
  catch(error){onError(error);}finally{setBusy(false);}
 }
 async function file(path:string){if(!job)return;try{const value=await api<{path:string;digest:string;content:string}>(`/api/development/${job.id}/file?path=${encodeURIComponent(path)}`);setReview({title:value.path,text:value.content});}catch(error){onError(error);}}
 async function command(id:string){if(!job)return;try{const value=await api<CommandResult>(`/api/development/${job.id}/commands/${id}`);setReview({title:`${value.commandId} · 退出码 ${value.exitCode}`,text:JSON.stringify(value,null,2)});}catch(error){onError(error);}}
 const active=history.some(item=>!terminal(item));
 const repairable=repairReport?.verdict==='failed'&&repairReport.baselineId===baseline?.id&&repairReport.binding.candidate?.provenance==='generated-component'&&repairReport.cases.every(c=>['passed','failed'].includes(c.status))&&repairReport.cases.some(c=>c.assertions.some(a=>a.status==='failed'));
 return <section className="development-panel baseline-review dev-workbench" data-testid={`development-${snapshot.id}`}>
  <div className="dev-workbench-head"><div><p className="eyebrow">开发 Agent · 双角色协作</p><h3>开发工作台</h3>
   <p className="muted">测试 Agent 先准备验收方案，开发 Agent 再生成设备查询 Tool、Skill 和单元测试。平台依据构建与执行证据确定候选状态。</p></div>
   <div className="dev-head-meta"><span className="dev-status-pill"><i className={`dev-status-dot ${job?.status==='built'?'is-ready':job?.status==='failed'?'is-failed':active?'is-running':''}`}/>{job?labels[job.status]:'等待启动'}</span><small>设备只读场景 · 单任务最多 15 分钟</small></div>
  </div>
  <div className="dev-pipeline" aria-label="开发任务阶段">{[
   {name:'验收基线',state:baseline?.content.templateId==='equipment-read@1'?'done':'pending',detail:baseline?.content.templateId==='equipment-read@1'?'已确认需求与场景':'等待确认只读基线'},
   {name:'测试 Agent',state:job?.roles.find(role=>role.role==='tester')?.status==='completed'?'done':job?.roles.find(role=>role.role==='tester')?.status==='running'?'active':'pending',detail:job?.roles.find(role=>role.role==='tester')?({completed:'测试方案已准备',running:'正在准备测试方案',failed:'测试方案失败',cancelled:'已取消',queued:'等待执行',skipped:'未执行',reused:'复用固定方案'} as Record<string,string>)[job.roles.find(role=>role.role==='tester')!.status]:'先行设计验收方案'},
   {name:'开发 Agent',state:job?.roles.find(role=>role.role==='developer')?.status==='completed'?'done':job?.roles.find(role=>role.role==='developer')?.status==='running'?'active':'pending',detail:job?.roles.find(role=>role.role==='developer')?({completed:'会话已结束',running:'正在生成与修复',failed:'开发会话失败',cancelled:'已取消',queued:'等待执行',skipped:'未执行',reused:'复用固定方案'} as Record<string,string>)[job.roles.find(role=>role.role==='developer')!.status]:'生成 Tool、Skill 与单元测试'},
   {name:'构建候选',state:job?.bundle?'done':job?.status==='failed'?'failed':'pending',detail:job?.bundle?'源码与制品已生成':job?.status==='failed'?'构建未完成':'等待单测、契约检查与构建'}
  ].map((step,index)=><div className={`dev-pipeline-step ${step.state}`} key={step.name}><span className="dev-step-index">{step.state==='done'?'✓':String(index+1).padStart(2,'0')}</span><div><strong>{step.name}</strong><small>{step.detail}</small></div>{index<3&&<span className="dev-step-connector"/>}</div>)}</div>
  <div className="dev-task-surface"><div className="dev-task-main"><div className="dev-section-heading"><div><span className="dev-section-kicker">TASK</span><h4>开发任务</h4></div>{job&&<span className="dev-task-id">{job.id.slice(0,8)}</span>}</div>
   <p className="muted">基于固定需求和测试方案生成组件；完成后登记固定候选，进入独立验收。</p>
  <button type="button" className="primary" disabled={busy||active||baseline?.content.templateId!=='equipment-read@1'} onClick={()=>{void start();}}>{pending.current&&!pending.current.repairExecutionId?'重试开发请求':'启动双角色开发'}</button>
  {repairable&&<><p className="hint">修复当前失败报告对应的候选，保留原报告、旧单测与测试方案。先复现缺陷，再生成新候选并重新验收。每个初始开发任务最多修复 3 次，每次最多 15 分钟；失败和取消均计入次数。</p><button type="button" className="secondary" disabled={busy||active} onClick={()=>{void start(repairReport!.executionId);}}>按失败证据修复</button></>}
  {!baseline&&<p className="hint">请先确认与此版本匹配的验收基线。</p>}
  </div><aside className="dev-role-aside"><div className="dev-section-heading"><div><span className="dev-section-kicker">ROLES</span><h4>协作角色</h4></div></div><div className="dev-role-card"><span className="dev-role-mark tester">QA</span><div><strong>测试 Agent</strong><p>先于实现准备验收方案，固定预期结果。</p></div></div><div className="dev-role-card"><span className="dev-role-mark developer">DEV</span><div><strong>开发 Agent</strong><p>生成 Tool、Skill 和单元测试，提交构建证据。</p></div></div><div className="dev-side-foot">候选是否可交付，由平台根据测试与外部证据判定。</div></aside></div>
  {history.length>0&&<label>开发任务记录<select value={job?.id??''} disabled={busy} onChange={e=>setJob(history.find(item=>item.id===e.target.value))}>{history.map(item=><option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString('zh-CN')} · {labels[item.status]}</option>)}</select></label>}
  {job&&<><p role="status" data-testid="development-status">{labels[job.status]}</p><p className="hint">任务 {job.id}。关闭页面后任务继续执行。</p>
   {job.repair&&<p className="hint" data-testid="repair-reference">第 {job.repair.attempt} / {job.repair.maxAttempts} 次修复 · 来源报告 {job.repair.executionId} · 原候选 {job.repair.candidateId}</p>}
   <ul>{job.roles.map(role=><li key={role.role}>{role.role==='tester'?'测试 Agent':'开发 Agent'}：{({queued:'等待执行',running:'执行中',completed:'会话完成',failed:'会话失败',cancelled:'已取消',skipped:'未执行',reused:'复用固定方案'} as Record<string,string>)[role.status]??role.status}{role.sessionId&&<small> · {role.sessionId}</small>}</li>)}</ul>
   {job.diagnostic&&<p className="hint">诊断：{job.diagnostic}</p>}
   {!terminal(job)&&<button type="button" className="secondary" disabled={busy||job.status==='cancelling'} onClick={()=>{setBusy(true);void api<DevelopmentJob>(`/api/development/${job.id}/cancel`,'POST',{}).then(setJob).catch(onError).finally(()=>setBusy(false));}}>取消开发任务</button>}
   {job.bundle&&<><p>代码包已通过构建检查，尚未完成业务验收。</p><div className="actions">{job.bundle.files.filter(item=>item.path!=='component.jar').map(item=><button className="secondary" type="button" key={item.path} onClick={()=>{void file(item.path);}}>{item.path}</button>)}</div><details><summary>固定版本与构建摘要</summary><pre>{JSON.stringify(job.bundle,null,2)}</pre></details></>}
   <details><summary>开发与测试执行记录（{events.length}）</summary><ol>{events.map(event=><li key={event.sequence}>{event.sequence} · {event.type}{event.type==='command.completed'?<> · {String(event.data.commandId)} · {String(event.data.status)} <button type="button" className="secondary" onClick={()=>{void command(String(event.data.id));}}>查看执行证据</button></>:<pre>{JSON.stringify(event.data,null,2)}</pre>}</li>)}</ol></details>
   {review&&<section><h4>{review.title}</h4><pre data-testid="development-review">{review.text}</pre></section>}
  </>}
 </section>;
}
