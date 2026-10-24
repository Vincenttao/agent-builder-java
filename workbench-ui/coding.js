'use strict';
window.WorkbenchCoding = (() => {
  const states=new Map(), activeStatuses=['running','awaiting_input'];
  const labels={running:'执行中',awaiting_input:'等待开发者回答',awaiting_review:'建议待审阅',applied:'已应用',rejected:'已拒绝',failed:'执行失败',cancelled:'已取消'};
  let host, timer, generation=0, refreshSequence=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function state(id){const role=host.context()?.role??'application',key=role+'|'+id;if(!states.has(key)){const saved=host.local?.read(id,role,'coding',{})??{};states.set(key,{jobs:[],selected:typeof saved.selected==='string'?saved.selected:null,prompt:typeof saved.prompt==='string'?saved.prompt:'',review:null,detailKey:null,answers:new Map()});}return states.get(key);}
  function persist(id,s){host.local?.write(id,host.context()?.role??'application','coding',{prompt:s.prompt,selected:s.selected});}
  function skill(project){return project.kind==='template'?'moa-platform-development':'moa-application-development';}
  function render(context){
    const s=state(context.project.id), path=`.opencode/skills/${skill(context.project)}/SKILL.md`;
    return `<section class="panel"><div class="toolbar"><div><h2>Coding 助手 · ${context.project.kind==='template'?'维护开发范式':'开发业务应用'}</h2><p class="muted">建议在独立 Git worktree 中生成。审阅前不改变当前工程；切换页面不会取消执行。</p></div><button data-coding-action="refresh">重新核对建议</button></div><details><summary>本工程开发指导：${esc(skill(context.project))}</summary><pre>${esc(context.files[path]??'缺少开发 Skill，生成时会被校验阻断。')}</pre></details><p class="muted">开发 Skill 给编码助手使用；业务 Skill 给运行中的应用使用，两者用途不同。</p>
      ${context.editable?`<p class="warning">本机 OpenCode 使用已配置的 DeepSeek。相关工程代码、测试和开发 Skill 会成为外部模型的开发上下文；任务结果会记录实际引擎与模型。</p>${context.dirty?'<p class="warning">存在未保存草稿。请先保存或放弃，再生成和应用建议。</p>':''}<form id="coding-start"><div class="field"><label for="coding-prompt">开发需求</label><textarea id="coding-prompt" name="prompt" maxlength="16000" required placeholder="说明业务目标、系统接口和需要修改的行为">${esc(s.prompt)}</textarea></div><button class="primary" ${context.dirty?'disabled':''}>生成修改建议</button></form>`:'<p class="warning">平台身份只能查看此应用的编码记录</p>'}</section><div id="coding-host" data-project="${esc(context.project.id)}"><div class="coding-layout"><section class="panel"><h2>编码记录</h2><div id="coding-list">正在读取记录…</div></section><section class="panel" id="coding-detail">选择记录查看执行与差异。</section></div></div>`;
  }
  function unmount(){clearTimeout(timer);generation++;}
  function valid(token,context){const now=host.context();return token===generation&&now&&now.project.id===context.project.id&&now.role===context.role&&document.getElementById('coding-host');}
  function mount(){unmount();const context=host.context();if(!context||!document.getElementById('coding-host'))return;const token=generation;state(context.project.id).detailKey=null;refresh(token,context,true).catch(error=>report(error,token,context));}
  function report(error,token,context){if(!valid(token,context))return;host.notify(error.message);document.getElementById('coding-list').textContent='读取失败；请点击“重新核对建议”核对原任务，不会自动重新生成。';}
  function question(job,s,readOnly){
    if(!job.pendingQuestion)return '';
    const answers=s.answers.get(job.id+':'+job.pendingQuestion.id)??{};
    return `<form id="coding-answer" data-job="${esc(job.id)}" data-question="${esc(job.pendingQuestion.id)}">${job.pendingQuestion.questions.map((q,i)=>`<fieldset ${readOnly?'disabled':''}><legend>${esc(q.question??q.header??'请补充需求')}</legend>${(Array.isArray(q.options)?q.options:[]).map((o,j)=>`<label class="check"><input type="${q.multiple?'checkbox':'radio'}" name="q-${i}" value="${esc(o.label)}" ${(answers['q-'+i]??[]).includes(o.label)?'checked':''}> ${esc(o.label)}${o.description?' · '+esc(o.description):''}</label>`).join('')}${q.custom!==false?`<label for="coding-answer-${i}">补充回答 ${i+1}</label><textarea id="coding-answer-${i}" name="custom-${i}">${esc(answers['custom-'+i]?.[0]??'')}</textarea>`:''}</fieldset>`).join('')}${readOnly?'':'<button class="primary">回答原问题</button>'}</form>`;
  }
  function detail(job,s,context){
    const readOnly=!context.editable||job.role!==context.role, review=s.review?.job.id===job.id?s.review:null;
    const stale=job.baseHead!==context.project.head||Boolean(review?.stale), dirty=context.dirty;
    const roleSkill=job.role==='platform'?'moa-platform-development':'moa-application-development';
    const evidence=[...(job.evidence??[]),...(job.events??[]).filter(e=>e.type==='tool')];
    const loaded=evidence.some(e=>e.tool==='skill'&&e.status==='completed'&&e.input?.name===roleSkill);
    const paths=Object.keys(job.changes??{});
    if(!paths.includes(s.path))s.path=paths[0];
    const before=review?.before?.[s.path], after=job.changes[s.path];
    return `<div class="toolbar"><h2>${esc(labels[job.status]??job.status)}</h2><code>${esc(job.id.slice(0,8))}</code></div><p><span class="badge">${job.engineKind==='opencode'?'实际 OpenCode 引擎':esc(job.engineKind||'历史未声明引擎')+' · 非真实 OpenCode 验证'}</span> <span class="badge">${esc(job.model||'模型信息尚未返回')}</span></p><p>基础版本 <code>${esc(job.baseHead.slice(0,12))}</code></p><p>${loaded?'已记录开发 Skill 工具读取':'尚无开发 Skill 实际读取证据'}：<code>${esc(roleSkill)}</code></p><details><summary>原开发需求</summary><pre>${esc(job.prompt)}</pre></details>${job.summary?`<h3>助手说明</h3><pre>${esc(job.summary)}</pre><p class="muted">以上是助手说明。实际检查以工具证据及后续测试为准，生成差异不代表业务验收通过。</p>`:''}${job.error?`<p class="warning">${esc(job.error.code)}：${esc(job.error.message)}</p>`:''}
      ${job.status==='awaiting_input'?question(job,s,readOnly):''}${activeStatuses.includes(job.status)&&!readOnly?'<button data-coding-action="cancel">取消原任务</button>':''}
      ${stale&&job.status==='awaiting_review'?'<p class="warning">建议已过期，请保留人工修改并重新发起</p>':''}${dirty&&job.status==='awaiting_review'?'<p class="warning">有未保存草稿，不能应用建议。</p>':''}
      ${paths.length?`<h3>文件差异（${paths.length}）</h3><label for="coding-diff-file">选择差异文件</label><select id="coding-diff-file">${paths.map(p=>`<option value="${esc(p)}" ${p===s.path?'selected':''}>${esc(p)}${job.changes[p]===null?' · 删除':''}</option>`).join('')}</select>${review?`<div class="diff-grid"><div><label for="coding-before">原版本内容${before===null?' · 新文件':''}</label><textarea id="coding-before" readonly spellcheck="false">${esc(before??'')}</textarea></div><div><label for="coding-after">建议内容${after===null?' · 删除文件':''}</label><textarea id="coding-after" readonly spellcheck="false">${esc(after??'')}</textarea></div></div>`:'<p>正在读取固定基础版本的差异…</p>'}`:''}
      ${job.status==='awaiting_review'&&!readOnly?`<div class="row"><button class="primary" data-coding-action="apply" ${stale||dirty||!review?'disabled':''}>应用全部差异</button><button data-coding-action="reject">拒绝建议</button></div>`:''}
      <details><summary>会话与工具记录</summary><p>会话：<code>${esc(job.sessionId??'尚未返回')}</code></p><ul>${evidence.map(e=>`<li>${esc(e.tool)} · ${esc(e.status)}${e.tool==='skill'?' · '+esc(e.input?.name??''):''}</li>`).join('')||'<li>尚无工具记录。</li>'}</ul></details>`;
  }
  function paint(context){
    const s=state(context.project.id),job=s.jobs.find(j=>j.id===s.selected);
    document.getElementById('coding-list').innerHTML=s.jobs.map(j=>`<button class="coding-record ${j.id===s.selected?'active':''}" data-coding-job="${esc(j.id)}">${esc(labels[j.status]??j.status)} · ${esc(j.createdAt)}<br><small>${esc(j.prompt.slice(0,100))}</small></button>`).join('')||'<p class="muted">没有编码记录。描述需求后生成真实文件差异，再审阅应用。</p>';
    const target=document.getElementById('coding-detail');if(!job){target.textContent='尚未选择编码任务。';return;}
    const live=host.context();
    const key=JSON.stringify({id:job.id,status:job.status,question:job.pendingQuestion,summary:job.summary,error:job.error,changes:job.changes,review:s.review,path:s.path,head:live.project.head,dirty:live.dirty,tools:[...(job.evidence??[]),...(job.events??[]).filter(e=>e.type==='tool')]});
    if(key===s.detailKey)return;
    const oldQuestion=target.querySelector('#coding-answer');
    const restore=oldQuestion?.dataset.question===job.pendingQuestion?.id&&oldQuestion?.dataset.job===job.id;
    const fields=restore?[...oldQuestion.querySelectorAll('input,textarea')].map(e=>({name:e.name,value:e.value,checked:e.checked})):[];
    const focused=restore&&target.contains(document.activeElement)?{name:document.activeElement.name,value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
    target.innerHTML=detail(job,s,live);s.detailKey=key;
    for(const input of target.querySelectorAll('#coding-answer input,#coding-answer textarea')){const old=fields.find(f=>f.name===input.name&&(input.type==='textarea'||f.value===input.value));if(old){if(input.tagName==='TEXTAREA')input.value=old.value;else input.checked=old.checked;}}
    if(focused){const input=[...target.querySelectorAll('#coding-answer input,#coding-answer textarea')].find(e=>e.name===focused.name&&(e.tagName==='TEXTAREA'||e.value===focused.value));if(input){input.focus({preventScroll:true});if(input.tagName==='TEXTAREA')input.setSelectionRange(focused.start,focused.end);}}
  }
  async function refresh(token,context,force=false){
    if(!valid(token,context))return;
    const sequence=++refreshSequence,current=()=>valid(token,context)&&sequence===refreshSequence;
    clearTimeout(timer);const s=state(context.project.id);
    if(force){const value=await host.api('/projects/'+context.project.id+'/jobs');if(!current())return;s.jobs=value.jobs;if(!s.jobs.some(j=>j.id===s.selected))s.selected=s.jobs[0]?.id;}
    if(s.selected){const value=await host.api('/jobs/'+s.selected);if(!current())return;const index=s.jobs.findIndex(j=>j.id===value.job.id);if(index>=0)s.jobs[index]=value.job;else s.jobs.unshift(value.job);
      if(Object.keys(value.job.changes).length&&(force||s.review?.job.id!==value.job.id)){const review=await host.api('/jobs/'+value.job.id+'/review');if(!current())return;s.review=review;}
    }
    persist(context.project.id,s);paint(context);const job=s.jobs.find(j=>j.id===s.selected);
    if(job&&activeStatuses.includes(job.status))timer=setTimeout(()=>refresh(token,context).catch(e=>report(e,token,context)),750);
  }
  function init(callbacks){host=callbacks;
    document.addEventListener('input',e=>{const form=e.target.closest('#coding-answer');if(form){const c=host.context();if(c){const values={};for(const [name,value] of new FormData(form)){(values[name]??=[]).push(value);}state(c.project.id).answers.set(form.dataset.job+':'+form.dataset.question,values);}}if(e.target.id==='coding-prompt'){const context=host.context();if(context){const s=state(context.project.id);s.prompt=e.target.value;persist(context.project.id,s);}}});
    document.addEventListener('change',e=>{if(e.target.id==='coding-diff-file'){const c=host.context();if(!c)return;state(c.project.id).path=e.target.value;paint(c);}});
    document.addEventListener('click',e=>{const button=e.target.closest('button');if(!button||!button.dataset.codingAction&&!button.dataset.codingJob)return;host.action(async()=>{
      const c=host.context();if(!c)return;const s=state(c.project.id),token=generation;
      if(button.dataset.codingJob){s.selected=button.dataset.codingJob;s.detailKey=null;return refresh(token,c,true);}
      const action=button.dataset.codingAction;if(action==='refresh')return refresh(token,c,true);
      const job=s.jobs.find(j=>j.id===s.selected);if(!job||!c.editable||job.role!==c.role)throw Error('当前身份不能修改此编码任务');
      if(action==='apply'&&c.dirty)throw Error('请先保存或放弃工程草稿');
      try{await host.api('/jobs/'+job.id+'/'+action,'POST',{});}catch(error){if(valid(token,c))await refresh(token,c,true);throw error;}
      if(!valid(token,c))return;
      if(action==='apply'){await host.reloadProject();host.notify('建议已应用并提交工程版本');}
      else {await refresh(token,c,true);if(action==='reject')host.notify('建议已拒绝，工程保持原状');}
    });});
    document.addEventListener('submit',e=>{const form=e.target,id=form.getAttribute('id');if(!['coding-start','coding-answer'].includes(id))return;e.preventDefault();host.action(async()=>{
      const c=host.context();if(!c||!c.editable)throw Error('当前工程只读');const s=state(c.project.id),token=generation;
      if(id==='coding-start'){
        if(c.dirty)throw Error('请先保存或放弃工程草稿');
        const {job}=await host.api('/projects/'+c.project.id+'/jobs','POST',{prompt:s.prompt});
        if(!valid(token,c))return;s.selected=job.id;s.review=null;s.jobs.unshift(job);s.detailKey=null;await refresh(token,c,true);
      }else{
        const job=s.jobs.find(j=>j.id===form.dataset.job),question=job?.pendingQuestion;
        if(!question||question.id!==form.dataset.question)throw Error('原问题已变化，请重新核对建议');
        const data=new FormData(form),answers=question.questions.map((q,i)=>{const custom=String(data.get('custom-'+i)??'').trim(),selected=data.getAll('q-'+i).map(String);return custom?(q.multiple?[...selected,custom]:[custom]):selected;});
        if(answers.some(a=>!a.length))throw Error('请回答每个原问题');
        await host.api('/jobs/'+job.id+'/answer','POST',{questionId:question.id,answers});if(valid(token,c))await refresh(token,c,true);
      }
    });});
  }
  return {init,render,mount,unmount};
})();
