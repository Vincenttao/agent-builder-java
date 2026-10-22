import {useEffect,useRef,useState} from 'react';
import type {Api} from './debug-run.js';
import type {DemoGrant,InvocationView,MessageInput} from '../../../packages/contracts/src/invocations.js';
import type {ActionRecord} from '../../../packages/contracts/src/actions.js';
const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
const labels:Record<string,string>={reserved:'等待启动',blocked:'目标不可用，尚未执行',queued:'准备运行',running:'运行中',waiting_confirmation:'等待确认',reconciling:'核对业务结果中',cancelling:'正在取消',succeeded:'已完成',failed:'执行失败',cancelled:'已取消',interrupted:'执行中断'};
type Saved={requestId?:string;conversationId?:string;pending?:MessageInput};
export function DemoApp({agentId,testDeploymentId,api,onError}:{agentId:string;testDeploymentId?:string;api:Api;onError(error:unknown):void}){
  const [actorId,setActorId]=useState<'U1001'|'U1002'>('U1001');const [grant,setGrant]=useState<DemoGrant>();const [view,setView]=useState<InvocationView>();
  const [input,setInput]=useState('查询 PUMP-001 的状态、温度与来源。');const [busy,setBusy]=useState(false);const [saved,setSaved]=useState<Saved>({});
  const current=useRef(0);const savedRef=useRef<Saved>({});
  const key=(identity:DemoGrant)=>`${testDeploymentId?`test:${testDeploymentId}`:'demo'}:${identity.agentId}:${identity.environmentId}:${identity.actorId}`;
  const requestPath=(id:string)=>testDeploymentId?`/test-api/deployments/${testDeploymentId}/requests/${id}`:`/agent-api/requests/${id}`;
  const save=(identity:DemoGrant,value:Saved)=>{savedRef.current=value;setSaved(value);sessionStorage.setItem(key(identity),JSON.stringify(value));};
  async function business<T>(identity:DemoGrant,path:string,method='GET',body?:unknown):Promise<T>{
    const response=await fetch(path,{method,credentials:'omit',headers:{Authorization:`Bearer ${identity.token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();if(!response.ok)throw new Error(`${result.message??'模拟请求失败'}（${result.code??response.status}）`);return result as T;
  }
  const status=view?.run?.status??view?.request.status;
  const active=Boolean(view&&!terminal.has(status??''));
  useEffect(()=>{
    if(!grant||!view)return;let alive=true;let timer:ReturnType<typeof setTimeout>|undefined;const identity=grant;const id=view.requestId;
    const poll=async()=>{try{const next=await business<InvocationView>(identity,requestPath(id));if(!alive)return;setView(next);if(!terminal.has(next.run?.status??next.request.status))timer=setTimeout(()=>{void poll();},1000);}
      catch(error){if(alive)onError(error);}};void poll();return()=>{alive=false;if(timer)clearTimeout(timer);};
  },[grant,view?.requestId]);
  useEffect(()=>()=>{current.current++;},[]);
  async function login(){
    const generation=++current.current;setBusy(true);setGrant(undefined);setView(undefined);setSaved({});savedRef.current={};
    try{
      const identity=await api<DemoGrant>(testDeploymentId?`/api/test-deployments/${testDeploymentId}/sessions`:'/api/demo-sessions','POST',testDeploymentId?{actorId}:{agentId,actorId});if(generation!==current.current)return;setGrant(identity);
      let previous:Saved={};try{previous=JSON.parse(sessionStorage.getItem(key(identity))??'{}') as Saved;}catch{previous={};}
      save(identity,previous);if(previous.pending)setInput(previous.pending.input);
      if(previous.requestId){const value=await business<InvocationView>(identity,requestPath(previous.requestId));if(generation===current.current)setView(value);}
    }catch(error){if(generation===current.current)onError(error);}finally{if(generation===current.current)setBusy(false);}
  }
  async function send(){
    if(!grant||busy||active)return;const identity=grant;const generation=current.current;setBusy(true);
    const request=savedRef.current.pending??{clientRequestId:crypto.randomUUID(),input,...(savedRef.current.conversationId?{conversationId:savedRef.current.conversationId}:{})};
    save(identity,{...savedRef.current,pending:request});
    try{const value=await business<InvocationView>(identity,testDeploymentId?`/test-api/deployments/${testDeploymentId}/messages`:`/agent-api/agents/${agentId}/messages`,'POST',request);if(generation!==current.current)return;
      save(identity,{requestId:value.requestId,conversationId:value.conversationId});setView(value);
    }catch(error){if(generation===current.current)onError(error);}finally{if(generation===current.current)setBusy(false);}
  }
  async function cancel(){if(!grant||!view||busy)return;setBusy(true);try{setView(await business<InvocationView>(grant,`${requestPath(view.requestId)}/cancel`,'POST',{}));}catch(error){onError(error);}finally{setBusy(false);}}
  async function decide(action:ActionRecord,decision:'approve'|'reject'){
    if(!grant||!view||busy)return;setBusy(true);try{await business(grant,`${requestPath(view.requestId)}/actions/${action.id}/decision`,'POST',{decisionId:crypto.randomUUID(),actionHash:action.actionHash,decision});setView(await business<InvocationView>(grant,requestPath(view.requestId)));}catch(error){onError(error);}finally{setBusy(false);}
  }
  const result=view?.run?.result as {result?:{content?:unknown}}|undefined;
  return <section className="demo-app" aria-label={testDeploymentId?'未发布候选预览':'模拟企业 App'} data-testid={testDeploymentId?`candidate-app-${testDeploymentId}`:`demo-app-${agentId}`}><h3>{testDeploymentId?'未发布候选预览':'模拟企业 App'} · 虚构业务数据</h3>
    <p className="muted">{testDeploymentId?'当前请求固定使用此候选和独立预览数据。':'发布后可在此调用 Agent。新会话使用现行版本，已有会话固定原版本；'}当前每条消息须包含完整问题。</p>
    <label>模拟业务身份<select value={actorId} disabled={busy} onChange={e=>{current.current++;setActorId(e.target.value as typeof actorId);setGrant(undefined);setView(undefined);setSaved({});savedRef.current={};}}><option value="U1001">U1001</option><option value="U1002">U1002</option></select></label>
    <button type="button" className="secondary" disabled={busy} onClick={()=>{void login();}}>{testDeploymentId?'进入候选预览':'进入模拟 App'}</button>
    {grant&&<><p className="hint">当前身份：{grant.actorId} · 模拟环境</p><label>业务请求<textarea value={input} disabled={busy||active||Boolean(saved.pending)} onChange={e=>setInput(e.target.value)}/></label>
      <button type="button" disabled={busy||active||!input.trim()} onClick={()=>{void send();}}>{saved.pending?'重试原请求':'发送业务请求'}</button>
      <button type="button" className="secondary" disabled={busy||active||Boolean(saved.pending)} onClick={()=>{save(grant,{});setView(undefined);}}>新建业务会话</button>
      {view&&<><p role="status" data-testid="demo-request-status">{labels[status??'']??status}</p>
        {active&&<button type="button" className="secondary" disabled={busy||status==='cancelling'} onClick={()=>{void cancel();}}>取消业务请求</button>}
        {view.request.diagnostic&&<p className="hint">{view.request.diagnostic}。{testDeploymentId?'请停止并重新创建测试部署；历史请求保留。':view.request.diagnostic==='PUBLISHED_DEPENDENCY_CHANGED'?'请重新验收并发布，再新建会话。':'原请求与版本保留；可取消后新建会话。'}</p>}
        {result?.result?.content!==undefined&&<pre data-testid="demo-result">{typeof result.result.content==='string'?result.result.content:JSON.stringify(result.result.content,null,2)}</pre>}
        {view.actions.map(action=><article key={action.id}><p>模拟业务动作：{action.operation} · {action.status}</p><pre>{JSON.stringify(action.args,null,2)}</pre><p className="hint">身份 {action.actorId} · 有效至 {new Date(action.expiresAt).toLocaleString('zh-CN')}</p>
          {action.status==='pending'&&<><button disabled={busy} onClick={()=>{void decide(action,'approve');}}>确认模拟操作</button><button disabled={busy} className="secondary" onClick={()=>{void decide(action,'reject');}}>拒绝并结束</button></>}
        </article>)}
        <details><summary>演示详情与证据</summary><pre data-testid="demo-evidence">{JSON.stringify({requestId:view.requestId,runId:view.runId,conversationId:view.conversationId,agentVersion:view.agentVersion,testDeploymentId:view.testDeploymentId,candidateId:view.candidateId,artifactDigest:view.artifactDigest,actorId:view.request.actorId,environmentId:view.request.environmentId,deploymentId:view.run?.deploymentId,externalEvidence:view.run?.externalEvidence},null,2)}</pre></details>
      </>}
    </>}
  </section>;
}
