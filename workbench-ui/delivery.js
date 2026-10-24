'use strict';
window.WorkbenchDelivery=(()=>{
 const states=new Map();let host,generation=0;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function state(id){if(!states.has(id))states.set(id,{runs:[],exports:[],runId:null,manifest:null});return states.get(id);}
 function valid(token,c){const now=host.context();return token===generation&&now&&now.role===c.role&&now.project.id===c.project.id&&document.getElementById('delivery-host');}
 const eligible=run=>run.artifact&&run.origin&&['running','stopped','interrupted'].includes(run.status);
 function render(){return '<div id="delivery-host"><section class="panel"><div class="toolbar"><div><h2>固定版本与技术导出</h2><p>选择已构建并启动过的运行，下载其 JAR/资产应用包与可构建源码包。</p></div><button data-delivery-action="refresh">刷新交付记录</button></div><p class="warning">导出与业务验收、企业 CI/CD 和发布是不同步骤。当前不把下载成功标记为已发布。</p><div id="delivery-source">正在读取固定运行…</div><p id="delivery-progress" role="status"></p></section><div id="delivery-records"></div><section id="delivery-manifest-panel" class="panel" hidden><h2>固定交付清单</h2><pre id="delivery-manifest"></pre></section></div>';}
 function unmount(){generation++;}
 function mount(){unmount();const c=host.context();if(!c||!document.getElementById('delivery-host'))return;const token=generation;refresh(token,c).catch(e=>{if(valid(token,c))host.notify(e.message);});}
 async function refresh(token,c){const [runs,records]=await Promise.all([host.api('/projects/'+c.project.id+'/runs','GET',undefined,c.role),host.api('/projects/'+c.project.id+'/exports','GET',undefined,c.role)]);if(!valid(token,c))return;const s=state(c.project.id);s.runs=runs.runs;s.exports=records.exports;if(!s.runs.some(r=>r.id===s.runId))s.runId=s.runs.find(eligible)?.id??null;paint(c);}
 function paint(c){
  const s=state(c.project.id),selected=s.runs.find(r=>r.id===s.runId),editable=c.editable&&c.project.kind==='application';
  document.getElementById('delivery-source').innerHTML=`${editable?`<div class="field"><label for="delivery-run">交付来源运行</label><select id="delivery-run"><option value="">请选择已有运行</option>${s.runs.map(r=>`<option value="${esc(r.id)}" ${s.runId===r.id?'selected':''} ${eligible(r)?'':'disabled'}>${esc(r.head.slice(0,12))} · ${esc(r.createdAt)} · ${esc(r.engine)}</option>`).join('')}</select></div>${!s.runs.some(eligible)?'<p>尚无可导出的构建产物，请先到调试运行完成构建与启动。</p><button data-tab="runs">进入调试运行</button>':''}${selected?`<p>来源提交 <code>${esc(selected.head)}</code></p>${selected.head!==c.project.head?'<p class="warning">所选运行是旧版本；导出不会包含当前工程的新修改。</p>':''}${selected.engine!=='local-java'?'<p class="warning">当前运行来自契约测试引擎。测试包不能作为真实 Java 服务启动。</p>':''}`:''}<button class="primary" data-delivery-action="create" ${!selected||!eligible(selected)?'disabled':''}>导出所选运行</button><p class="muted">打包不重新构建，不读取本机模型 Key，也不复制工作台数据库、会话或日志。同一运行、同一包格式重复导出返回同一份包。</p>`:'<p>当前为只读诊断，可查看固定交付记录；不能创建或清理应用交付。</p>'}`;
  document.getElementById('delivery-records').innerHTML=s.exports.map(record=>`<section class="panel"><div class="toolbar"><h2>交付版本 ${esc(record.head.slice(0,12))} · 包格式 v${esc(record.formatVersion??1)}</h2><span class="badge">${record.engine==='local-java'?'本机 Java 构建':'契约测试包 · 不作为真实服务'}</span></div><p>独立运行未验证 · 业务未验证 · 未发布</p><p class="muted">${esc(record.createdAt)} · 来源运行 <code>${esc(record.runId.slice(0,8))}</code></p><div class="delivery-downloads">${['application','source'].map(kind=>`<article><h3>${kind==='application'?'可执行应用包':'可构建源码包'}</h3><p>${kind==='application'?'JAR、外置业务资产、配置样例与启动/校验脚本。':'固定源码、业务资产、构建/启动与校验脚本。'}</p><a class="btn" href="/api/exports/${encodeURIComponent(record.id)}/files/${kind}" download>${kind==='application'?'下载应用包':'下载源码包'}</a><p>${esc(record.artifacts[kind].bytes)} bytes</p><label>SHA-256</label><code>${esc(record.artifacts[kind].sha256)}</code></article>`).join('')}</div><p><code>包内 manifest.json / SHA256SUMS / DELIVERY.md</code></p><div class="row wrap"><button data-delivery-action="manifest" data-export="${esc(record.id)}">查看交付清单</button>${editable?`<button data-delivery-action="delete" data-export="${esc(record.id)}">清理交付包</button>`:''}</div></section>`).join('')||'<section class="panel">尚无交付记录。新草稿不会改变历史包。</section>';
  const panel=document.getElementById('delivery-manifest-panel');panel.hidden=!s.manifest;if(s.manifest)document.getElementById('delivery-manifest').textContent=JSON.stringify(s.manifest,null,2);
 }
 function init(callbacks){host=callbacks;
  document.addEventListener('change',e=>{if(e.target.id!=='delivery-run')return;const c=host.context();if(!c)return;state(c.project.id).runId=e.target.value;paint(c);});
  document.addEventListener('click',e=>{const button=e.target.closest('button');if(!button?.dataset.deliveryAction)return;host.action(async()=>{
   const c=host.context();if(!c)return;const token=generation,s=state(c.project.id),action=button.dataset.deliveryAction;
   if(action==='refresh')return refresh(token,c);
   if(action==='manifest'){const data=await host.api('/exports/'+button.dataset.export+'/manifest','GET',undefined,c.role);if(!valid(token,c))return;s.manifest=data.manifest;paint(c);document.getElementById('delivery-manifest-panel').scrollIntoView({block:'start'});return;}
   if(!c.editable||c.project.kind!=='application')throw Error('请使用应用开发者身份操作');
   if(action==='create'){
    document.getElementById('delivery-progress').textContent='正在核对原 JAR、构建输入与业务资产并打包；不会重新运行模型。';
    try{const result=await host.api('/projects/'+c.project.id+'/exports','POST',{runId:s.runId},c.role);if(!valid(token,c))return;const previous=s.exports.some(x=>x.id===result.export.id);await refresh(token,c);host.notify(previous?'复用同一运行的固定交付包':'已生成技术包；独立运行与业务验收尚未验证');}
    finally{if(valid(token,c))document.getElementById('delivery-progress').textContent='';}
   }
   if(action==='delete'){if(!confirm('清理这份交付归档和记录？原工程与运行将保留。请先完成所需下载。'))return;await host.api('/exports/'+button.dataset.export,'DELETE',undefined,c.role);if(valid(token,c)){s.manifest=null;await refresh(token,c);}}
  });});
 }
 return {init,render,mount,unmount};
})();
