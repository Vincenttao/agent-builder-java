'use strict';
window.WorkbenchRuntime=(()=>{
 const states=new Map(),activeStatuses=['building','starting','running','stopping','unresponsive'];
 const runLabels={building:'构建中',starting:'启动中',running:'运行中',stopping:'停止中',stopped:'已停止',failed:'构建或启动失败',interrupted:'进程已中断',unresponsive:'原进程待核验'};
 const taskLabels={ACTIVE:'处理中',WAITING_INPUT:'等待补充或确认',WAITING_RECEIPT:'等待原操作回执',NEEDS_REVIEW:'恢复前待复核',COMPLETED:'已完成',FAILED:'失败',ABANDONED:'已放弃'};
 const eventLabels={user_message:'收到业务消息',routing_started:'开始判断业务范围',routing_decided:'业务去向已确定',task_started:'开始当前任务',input_required:'等待原任务输入',input_accepted:'接受原任务输入',switch_decision_required:'等待任务切换决定',switch_declined:'保留当前处理，不切换',task_retained:'保留原任务',task_abandoned:'放弃未提交任务',handoff_started:'切换至新任务',a2a_call_started:'调用已挂载 Agent',a2a_response:'收到 Agent 结果',task_finished:'任务结束',task_resumed:'恢复原任务',review_required:'恢复前要求复核',resume_review:'执行恢复检查',resume_facts_checked:'复核当前业务数据',review_read_started:'读取复核数据',review_read_completed:'取得复核数据',write_authorized:'确认校验通过',operation_submitted:'提交原操作',operation_receipt:'取得原操作回执',receipt_required:'需要核对原操作回执',confirmation_declined:'用户拒绝，未提交操作',task_error:'任务执行失败',command_rejected:'操作被阻断','skill.TODO_START':'开始 Skill 操作','skill.TODO_END':'Skill 操作结束'};
 const errors={TASK_DEPTH_LIMIT:'已保留两个任务，不能再切换到第三层',STALE_TASK_INPUT:'原确认或回复已失效，请核对当前任务',DEFINITION_CONFLICT_REQUIRES_CODING:'业务定义存在冲突，请由 Coding 助手统一修订',JAVA_REQUEST_UNOBSERVED:'没有取得原请求结果。请核对原状态，不要重发操作',SUBMITTED_OPERATION_CANNOT_BE_DISCARDED:'原操作已经提交，不能按未提交任务放弃',RUN_BUSY:'已有构建或 Java 进程，请查看原运行，不要重复启动'};
 let host,timer,generation=0,sequence=0,observing=null;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const json=value=>JSON.stringify(value,null,2);
 const ended=state=>['COMPLETED','FAILED','ABANDONED'].includes(state);
 function state(id){const role=host.context()?.role??'application',key=role+'|'+id;if(!states.has(key)){const saved=host.local?.read(id,role,'runtime',{})??{};states.set(key,{projectId:id,role,runs:[],all:[],selected:typeof saved.selected==='string'?saved.selected:null,byRun:new Map(),detailKey:null});}return states.get(key);}
 function persist(s,rs){host.local?.write(s.projectId,s.role,'runtime',{selected:s.selected});if(rs)host.local?.write(s.projectId,s.role,'runtime-conversation:'+rs.runId,rs.conversation);}
 function persistQuery(rs,key=rs.conversation||'new'){host.local?.write(rs.projectId,rs.role,'runtime-query:'+rs.runId+':'+key,rs.drafts.get(key)?.query??'');}
 function runState(s,id){if(!s.byRun.has(id))s.byRun.set(id,{projectId:s.projectId,role:s.role,runId:id,conversation:host.local?.read(s.projectId,s.role,'runtime-conversation:'+id,null)??null,view:null,pending:false,uncertain:false,error:'',playback:null,drafts:new Map()});return s.byRun.get(id);}
 function draft(rs){const key=rs.conversation||'new';if(!rs.drafts.has(key))rs.drafts.set(key,{query:host.local?.read(rs.projectId,rs.role,'runtime-query:'+rs.runId+':'+key,'')??'',reply:''});return rs.drafts.get(key);}
 function read(c,path,method='GET',body){return host.api(path,method,body,c.role);}
 function currentRun(c){const s=state(c.project.id);return s.runs.find(r=>r.id===s.selected);}
 function valid(token,c){const now=host.context();return token===generation&&now&&now.project.id===c.project.id&&now.role===c.role&&document.getElementById('runtime-host');}
 function render(c){return `<div id="runtime-host"><section class="panel"><div class="toolbar"><div><h2>本机调试与轨迹</h2><p class="muted">运行绑定已保存的 Git 版本。修改工程不会改变已启动的 Java 应用。</p></div><button data-run-action="refresh">核对运行记录</button></div><div id="runtime-controls">正在核对本机运行…</div></section><div class="runtime-layout"><section class="panel"><h2>运行记录</h2><div id="runtime-list">正在读取…</div></section><section class="panel" id="runtime-detail">选择运行查看。</section></div></div>`;}
 function unmount(){clearTimeout(timer);generation++;}
 function mount(){unmount();const c=host.context();if(!c||!document.getElementById('runtime-host'))return;state(c.project.id).detailKey=null;refresh(generation,c,true).catch(e=>report(e,generation,c));}
 function report(error,token,c){if(valid(token,c))host.notify(errors[error.code]||error.message);}
 function controls(s,c){
  const run=currentRun(c),rs=run&&runState(s,run.id),active=s.all.find(r=>activeStatuses.includes(r.status));
  if(rs?.playback)return '<p class="warning">只读回放：不会重新调用模型、Skill 或 Agent</p>';
  return `${!c.editable?'<p>当前身份只读诊断，不能发起业务或停止应用。</p>':`<button class="primary" data-run-action="start" ${c.dirty||active?'disabled':''}>构建并启动保存版本</button>${c.dirty?'<p class="warning">请先保存或放弃工程草稿，再构建。</p>':''}`}${active&&active.projectId!==c.project.id?`<p class="warning">其他工程已有活动运行 <code>${esc(active.id.slice(0,8))}</code>。<button data-run-open="${esc(active.id)}" data-project="${esc(active.projectId)}">查看原运行</button></p>`:''}`;
 }
 function traces(run,view){
  const ids=[...new Set([...(view.tasks??[]).flatMap(t=>t.traceIds??[]),...(view.events??[]).map(e=>e.traceId)].filter(id=>typeof id==='string'&&/^[a-f0-9]{32}$/i.test(id)&&!/^0+$/.test(id)))];
  return `<details id="runtime-traces"><summary>Trace 关联（${ids.length}）</summary>${ids.length?ids.map(id=>run.engine==='local-java'?`<p><a href="http://127.0.0.1:16686/trace/${id}" target="_blank" rel="noopener noreferrer">在本机 Jaeger 查看 ${esc(id)}</a></p>`:`<p><code>${esc(id)}</code> · 测试标识，不作为真实 Trace</p>`).join(''):'<p>尚无 Trace 标识。没有标识不代表执行成功；请同时检查任务结果和事件。</p>'}</details>`;
 }
 function timeline(view,cursor){
  const events=view.events??[],visible=events.slice(0,cursor??events.length),shown=visible.slice(-100);
  const route={SKILL:'调用业务 Skill',DELEGATE:'委派已挂载 Agent',HANDOFF:'转交范围外接管 Agent',CONTINUE:'继续原任务',CLARIFY:'先澄清',CONFLICT:'阻断定义冲突'};
  return `<h3>执行事件</h3>${visible.length>100?`<p class="muted">当前窗口展示最近 100 条；事件位置可用于查看更早事件。共 ${events.length} 条。</p>`:''}<ol class="event-timeline">${shown.map((e,i)=>`<li><strong>${esc(eventLabels[e.type]||e.type)}</strong><small> #${esc(e.sequence??i+1)} · ${esc(e.time??'')}</small>${e.type==='routing_decided'?`<p>${esc(route[e.data?.action]||e.data?.action)}${e.data?.target?' → '+esc(e.data.target):''} ${esc(e.data?.reason??'')}</p>`:''}<details><summary>查看原事件证据</summary><pre>${esc(json(e))}</pre></details></li>`).join('')||'<li>尚无执行事件。</li>'}</ol>`;
 }
 function taskCard(frame,slot,view,canOperate){
  if(!frame)return '';
  const submitted=(view.stack?.tasks??[]).find(t=>t.id===frame.id)?.submittedCall;
  const stateInfo=`<span class="badge">${esc(taskLabels[frame.state]||frame.state)}</span>`;
  return `<article class="runtime-task"><h3>${esc(slot)}</h3><p><strong>${esc(frame.target)}</strong> · ${frame.kind==='skill'?'当前任务内 Skill':'A2A Agent'} ${stateInfo}</p><p>${esc(frame.query)}</p>${frame.error?`<p class="warning">${esc(errors[frame.error]||frame.error)}</p>`:''}${Object.keys(frame.output??{}).length?`<details><summary>原任务结果</summary><pre>${esc(json(frame.output))}</pre></details>`:''}${submitted&&!ended(frame.state)&&canOperate?`<p>已提交操作仅核对原键回执，不重复提交。</p><button data-run-action="receipt" data-task="${esc(frame.id)}">核对原操作回执</button>`:''}<details><summary>任务标识</summary><code>${esc(frame.id)}</code>${submitted?`<p>原操作键：<code>${esc(submitted)}</code></p>`:''}</details></article>`;
 }
 function interaction(run,rs,view,c){
  const owned=c.editable&&run.role===c.role,unobserved=rs.uncertain||view.unobserved||(run.unobserved??[]).includes(rs.conversation);
  const live=run.status==='running'&&view.live!==false,blocked=rs.pending||view.busy||unobserved;
  const disabled=blocked||view.conflict?'disabled':'',stack=view.stack??{},frames=view.tasks??[],current=frames.find(t=>t.id===stack.current?.id),retained=frames.find(t=>t.id===stack.retained?.id);
  const mutable=owned&&live&&!rs.playback&&!blocked;
  let body=`${view.live===false?'<p class="warning">历史观察快照 · 只读</p>':''}${view.interrupted?'<p class="warning">原进程已停止或中断，未完成业务需要核对，不能从历史快照继续确认。</p>':''}${view.busy?'<p class="notice">原任务正在执行；页面只观察，不会重发。</p>':''}${view.conflict?'<p class="warning">业务定义存在冲突。请由 Coding 助手统一修订，不能用提示词绕过程序约束。</p>':''}${view.clarification?`<p class="warning">需要澄清：${esc(view.clarification)}</p>`:''}<div class="task-stack">${taskCard(retained,'保留的原任务',view,mutable)}${retained?'<div class="stack-arrow">保留 A → 当前处理 B<br>最多两层</div>':''}${taskCard(current,retained?'当前处理的任务':'当前任务',view,mutable)}</div>${frames.some(t=>t.id!==current?.id&&t.id!==retained?.id)?`<details id="runtime-task-history"><summary>本会话其他任务与结果</summary>${frames.filter(t=>t.id!==current?.id&&t.id!==retained?.id).map(t=>taskCard(t,'历史任务',view,false)).join('')}</details>`:''}`;
  if(current?.state==='COMPLETED'&&!retained)body+='<p class="success"><strong>原任务已完成</strong></p>';
  if(!owned||!live||rs.playback)return body;
  if(unobserved)body+=`<p class="warning">原请求结果未核对。先查看原会话，不要重新提交。</p><button data-run-action="observe" ${rs.pending?'disabled':''}>核对原状态</button>`;
  if(view.switchRequest){const request=view.switchRequest;body+=`<section class="warning"><h3>当前任务未完成，是否切换？</h3><p>新目标：${esc(request.target)} · ${esc(request.query)}</p><div class="row wrap"><button data-run-action="decide" data-request="${esc(request.requestId)}" data-choice="RETAIN" ${disabled}>保留原任务并切换</button><button data-run-action="decide" data-request="${esc(request.requestId)}" data-choice="STAY" ${disabled}>暂不切换</button><button data-run-action="decide" data-request="${esc(request.requestId)}" data-choice="DISCARD" ${disabled||(stack.current?.submittedCall?'disabled':'')}>放弃未提交任务并切换</button></div></section>`;}
  const candidate=stack.resumeCandidate??(current?.state==='NEEDS_REVIEW'||current?.prompt?.expiresAt<Date.now()?current.id:null);
  if(candidate&&!view.conflict)body+=`<p>新任务结束后，先复核原任务的数据和等待点，再续办；旧确认不能复用。</p><button data-run-action="resume" data-task="${esc(candidate)}" ${disabled}>复核并续办原任务</button>`;
  if(current?.prompt&&!retained?.prompt&&!view.switchRequest&&!view.conflict){const prompt=current.prompt,expired=prompt.expiresAt<Date.now();body+=`<section class="original-prompt"><h3>原任务等待输入</h3><p>${esc(prompt.message)}</p>${expired?'<p class="warning">原确认已过期，请复核后获取新的确认。</p>':''}${prompt.kind==='confirm_action'?`<div class="row"><button class="primary" data-run-action="confirm" data-task="${esc(current.id)}" data-token="${esc(prompt.token)}" ${disabled||expired?'disabled':''}>确认原操作</button><button data-run-action="decline" data-task="${esc(current.id)}" data-token="${esc(prompt.token)}" ${disabled||expired?'disabled':''}>拒绝原操作</button></div>`:`<form id="runtime-reply" data-task="${esc(current.id)}" data-token="${esc(prompt.token)}"><div class="field"><label for="runtime-reply-input">原任务补充回答</label><textarea id="runtime-reply-input" required ${disabled}>${esc(draft(rs).reply)}</textarea></div><button ${disabled}>回复原任务</button></form>`}</section>`;}
  body+=`<form id="runtime-message"><div class="field"><label for="runtime-query">新需求或澄清补充</label><textarea id="runtime-query" required maxlength="12000" ${disabled||view.switchRequest||view.conflict?'disabled':''}>${esc(draft(rs).query)}</textarea><small class="muted">新需求会判断业务范围；补充参数和确认请使用上方原任务入口，不要在此重复提交。</small></div><button class="primary" ${disabled||view.switchRequest||view.conflict?'disabled':''}>发送新需求</button></form>`;
  return body;
 }
 function detail(run,rs,c){
  const playback=rs.playback,shownRun=playback?.run??run,view=playback?.view??rs.view,owned=c.editable&&run.role===c.role;
  return `<div class="toolbar"><h2>${esc(runLabels[shownRun.status]||shownRun.status)}</h2><code>${esc(shownRun.id.slice(0,8))}</code></div><p><span class="badge">${shownRun.engine==='local-java'?'本机 Java 运行':esc(shownRun.engine)+' · 运行契约测试，不代表真实业务'}</span></p><p>启动版本 <code>${esc(shownRun.head.slice(0,12))}</code></p>${run.head!==c.project.head?'<p class="warning">工程已修改，运行仍使用启动时版本。不会自动重建或重启。</p>':''}${run.error?`<p class="warning">${esc(run.error.code)}：${esc(run.error.message)}</p>`:''}${rs.error?`<p class="warning" role="alert">${esc(rs.error)}</p>`:''}${shownRun.artifact?`<details id="runtime-artifact"><summary>构建产物摘要</summary><p>SHA-256：<code>${esc(shownRun.artifact.sha256)}</code></p><p>${esc(shownRun.artifact.bytes)} bytes · 绑定本次启动版本</p></details>`:''}
    ${!playback&&owned&&activeStatuses.includes(run.status)?`<div class="row"><button data-run-action="stop">停止原运行</button>${run.status==='unresponsive'?'<button data-run-action="reconnect">核验原进程</button>':''}</div>`:''}
    <details id="runtime-logs"><summary>本次构建与进程日志</summary><pre>${esc((shownRun.logs??[]).join(''))}</pre></details>
    ${playback?`<section class="warning"><h3>只读轨迹回放</h3><p>浏览器冻结时间：${esc(playback.capturedAt)}。下方按原事件顺序查看，不重新执行。任务卡展示冻结快照的状态，不冒充所选事件时的完整状态。</p><div class="row"><button data-run-action="previous" ${playback.cursor<=1?'disabled':''}>上一步事件</button><button data-run-action="next" ${playback.cursor>=(view.events??[]).length?'disabled':''}>下一步事件</button><button data-run-action="live">返回当前状态</button></div><div class="field"><label for="replay-position">回放事件位置</label><input id="replay-position" type="number" min="1" max="${Math.max(1,(view.events??[]).length)}" value="${playback.cursor}"></div><label for="replay-slider">回放进度</label><input id="replay-slider" type="range" min="1" max="${Math.max(1,(view.events??[]).length)}" value="${playback.cursor}" style="width:100%"></section>`:''}
    ${!playback&&run.conversations.length?`<div class="field"><label for="runtime-conversation">业务会话</label><select id="runtime-conversation"><option value="">新会话（尚未发送）</option>${run.conversations.map((id,i)=>`<option value="${esc(id)}" ${id===rs.conversation?'selected':''}>会话 ${i+1} · ${esc(id.slice(0,8))}${(run.unobserved??[]).includes(id)?' · 请求结果待核对':''}</option>`).join('')}</select></div>`:''}
    ${!playback&&owned&&run.status==='running'?`<button data-run-action="new-conversation" ${rs.pending||rs.uncertain||run.unobserved?.length?'disabled':''}>新建业务会话</button>`:''}
    ${view?interaction(shownRun,rs,view,c):!playback&&owned&&run.status==='running'?interaction(run,rs,{stack:{},tasks:[],events:[],live:true},c):'<p>尚无业务会话或可用观察快照。</p>'}
    ${view&&!playback?`<button data-run-action="playback" ${rs.pending?'disabled':''}>进入只读回放</button>`:''}
    ${view?traces(shownRun,view)+timeline(view,playback?.cursor):''}${!playback&&owned&&!activeStatuses.includes(run.status)?'<button data-run-action="delete">清理此历史运行</button>':''}`;
 }
 function paint(c){
  const s=state(c.project.id),run=currentRun(c);if(!document.getElementById('runtime-host'))return;
  document.getElementById('runtime-controls').innerHTML=controls(s,c);
  document.getElementById('runtime-list').innerHTML=s.runs.map(r=>`<button class="runtime-record ${s.selected===r.id?'active':''}" data-run-select="${esc(r.id)}">${esc(runLabels[r.status]||r.status)} · ${esc(r.createdAt)}<br><code>${esc(r.head.slice(0,8))}</code></button>`).join('')||'<p>尚无运行。先保存工程，再构建并启动。</p>';
  const target=document.getElementById('runtime-detail');if(!run){target.textContent='选择运行查看会话、任务与事件。';return;}
  const rs=runState(s,run.id),key=json({run,view:rs.view,playback:rs.playback,pending:rs.pending,uncertain:rs.uncertain,error:rs.error,conversation:rs.conversation,role:c.role,head:c.project.head,expired:(rs.view?.tasks??[]).filter(t=>t.prompt?.expiresAt<Date.now()).map(t=>t.id)});if(key===s.detailKey)return;
  const focus=target.contains(document.activeElement)?{id:document.activeElement.id,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
  const expanded=[...target.querySelectorAll('details[id][open]')].map(e=>e.id);
  target.innerHTML=detail(run,rs,c);s.detailKey=key;
  for(const id of expanded){const element=document.getElementById(id);if(element)element.open=true;}
  if(focus?.id){const field=document.getElementById(focus.id);if(field){field.focus({preventScroll:true});if(field.tagName==='TEXTAREA')field.setSelectionRange(focus.start,focus.end);}}
 }
 async function refresh(token,c,force=false){
  if(!valid(token,c))return;const s=state(c.project.id),selected=currentRun(c);if(selected&&runState(s,selected.id).playback){paint(c);return;}
  clearTimeout(timer);const seq=++sequence,current=()=>valid(token,c)&&seq===sequence;
  const execution=(async()=>{
   if(force){const {runs}=await read(c,'/runs');if(!current())return;s.all=runs;s.runs=runs.filter(r=>r.projectId===c.project.id);if(!s.runs.some(r=>r.id===s.selected))s.selected=s.runs[0]?.id??null;}
   const run=currentRun(c);if(run){const value=await read(c,'/runs/'+run.id);if(!current())return;s.runs[s.runs.findIndex(r=>r.id===run.id)]=value.run;s.all=s.all.map(r=>r.id===run.id?value.run:r);const rs=runState(s,run.id);if(rs.conversation===null||rs.conversation&&!value.run.conversations.includes(rs.conversation))rs.conversation=value.run.conversations.at(-1)??'';persist(s,rs);
    if(rs.conversation){const view=await read(c,'/runs/'+run.id+'/conversations/'+rs.conversation);if(!current())return;rs.view=view;}
   }
   if(!current())return;paint(host.context());const latest=currentRun(c);if(latest&&activeStatuses.includes(latest.status))timer=setTimeout(()=>refresh(token,c).catch(e=>report(e,token,c)),1000);
  })();observing=execution;try{await execution;}finally{if(observing===execution)observing=null;}
 }
 async function operate(c,action,body){
  const s=state(c.project.id),run=currentRun(c);if(!run||!c.editable||run.role!==c.role)throw Error('当前身份不能操作此运行');const rs=runState(s,run.id);if(rs.pending||rs.playback)throw Error('原请求尚未结束，或当前处于只读回放');
  rs.pending=true;rs.error='';paint(c);const token=generation,conversation=rs.conversation,originalDraft=draft(rs),text=action==='messages'?originalDraft.query:originalDraft.reply;
  try{
   const path='/runs/'+run.id+(action==='messages'?'/messages':'/conversations/'+conversation+'/'+action);
   const view=await read(c,path,'POST',body);rs.view=view;rs.conversation=view.conversationId;rs.uncertain=false;if(action==='messages'&&originalDraft.query===text){originalDraft.query='';persistQuery(rs,conversation||'new');}if(action==='reply'&&originalDraft.reply===text)originalDraft.reply='';
  }catch(error){rs.error=errors[error.code]||error.message;if(error.code==='JAVA_REQUEST_UNOBSERVED'||!error.code){rs.uncertain=true;if(action==='messages'&&!conversation)rs.conversation=null;}host.notify(rs.error);}
  finally{rs.pending=false;if(valid(token,c)){s.detailKey=null;await refresh(token,c,true).catch(e=>report(e,token,c));}}
 }
 function init(callbacks){host=callbacks;
  document.addEventListener('input',e=>{const c=host.context();if(!c)return;const run=currentRun(c);if(!run)return;const s=state(c.project.id),rs=runState(s,run.id);
   if(e.target.id==='runtime-query'){draft(rs).query=e.target.value;persistQuery(rs);}if(e.target.id==='runtime-reply-input')draft(rs).reply=e.target.value;
   if(['replay-position','replay-slider'].includes(e.target.id)&&rs.playback){rs.playback.cursor=Math.max(1,Math.min((rs.playback.view.events??[]).length||1,Number(e.target.value)||1));s.detailKey=null;paint(c);}
  });
  document.addEventListener('change',e=>{if(e.target.id!=='runtime-conversation')return;const c=host.context(),run=c&&currentRun(c);if(!run)return;const s=state(c.project.id),rs=runState(s,run.id);rs.conversation=e.target.value;persist(s,rs);rs.view=null;s.detailKey=null;refresh(generation,c).catch(error=>report(error,generation,c));});
  document.addEventListener('submit',e=>{const id=e.target.getAttribute('id');if(!['runtime-message','runtime-reply'].includes(id))return;e.preventDefault();const c=host.context(),run=c&&currentRun(c);if(!run)return;const rs=runState(state(c.project.id),run.id);const body=id==='runtime-message'?{query:draft(rs).query,...(rs.conversation?{conversationId:rs.conversation}:{})}:{taskId:e.target.dataset.task,token:e.target.dataset.token,answer:draft(rs).reply};void operate(c,id==='runtime-message'?'messages':'reply',body).catch(error=>host.notify(error.message));});
  document.addEventListener('click',e=>{const button=e.target.closest('button');if(!button||!button.dataset.runAction&&!button.dataset.runSelect&&!button.dataset.runOpen)return;
   const c=host.context();if(!c)return;const s=state(c.project.id),run=currentRun(c),rs=run&&runState(s,run.id),action=button.dataset.runAction;
   if(['confirm','decline','decide','resume','receipt','observe'].includes(action)){
    let body={};if(['confirm','decline'].includes(action))body={taskId:button.dataset.task,token:button.dataset.token,answer:action==='confirm'?'确认':'拒绝'};
    if(action==='decide')body={requestId:button.dataset.request,choice:button.dataset.choice};if(['resume','receipt'].includes(action))body={taskId:button.dataset.task};
    void operate(c,['confirm','decline'].includes(action)?'reply':action,body).catch(error=>host.notify(error.message));return;
   }
   host.action(async()=>{
    if(button.dataset.runOpen){const target=state(button.dataset.project);target.selected=button.dataset.runOpen;return host.openRun(button.dataset.project);}
    if(button.dataset.runSelect){s.selected=button.dataset.runSelect;s.detailKey=null;return refresh(generation,c,true);}
    if(action==='refresh'){if(rs?.playback)return host.notify('请先返回当前状态；回放不会读取或重执行业务');return refresh(generation,c,true);}
    if(action==='start'){if(!c.editable||c.dirty)throw Error('请使用工程所属身份保存修改后运行');const {run:created}=await read(c,'/projects/'+c.project.id+'/runs','POST',{baseHead:c.project.head});s.selected=created.id;s.runs.unshift(created);return refresh(generation,c,true);}
    if(!run)return;
    if(action==='playback'){if(rs.pending||!rs.view)throw Error('请先等待原请求结束');clearTimeout(timer);generation++;if(observing)await observing.catch(()=>{});rs.playback={run:structuredClone(run),view:structuredClone(rs.view),cursor:1,capturedAt:new Date().toISOString()};s.detailKey=null;paint(c);return;}
    if(action==='live'){rs.playback=null;generation++;s.detailKey=null;return refresh(generation,c,true);}
    if(['previous','next'].includes(action)&&rs.playback){rs.playback.cursor=Math.max(1,Math.min(rs.playback.view.events.length,rs.playback.cursor+(action==='next'?1:-1)));s.detailKey=null;paint(c);return;}
    if(rs.playback)throw Error('当前为只读回放');
    if(action==='new-conversation'){if(rs.pending)throw Error('请等待原请求结束');rs.conversation='';persist(s,rs);rs.view=null;rs.uncertain=false;rs.error='';s.detailKey=null;paint(c);return;}
    if(action==='stop'){if(!confirm('停止原运行会中断尚未结束的会话；不会撤销已提交的业务。确定停止？'))return;await read(c,'/runs/'+run.id+'/stop','POST',{});return refresh(generation,c,true);}
    if(action==='reconnect'){await read(c,'/runs/'+run.id+'/reconnect','POST',{});return refresh(generation,c,true);}
    if(action==='delete'){if(!confirm('清理此已停止运行的专属目录与记录？工程和其他运行不会被删除。'))return;await read(c,'/runs/'+run.id,'DELETE');s.byRun.delete(run.id);s.selected=null;return refresh(generation,c,true);}
   });
  });
 }
 return {init,render,mount,unmount};
})();
