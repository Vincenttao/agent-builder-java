'use strict';
// Browser drafts are not saved engineering revisions or Java execution state.
window.WorkbenchPersistence=(()=>{
 const prefix='openjiuwen-workbench-live-ui-state-',failed=new Set(),warned=new Set();
 let scope='',version='',buildKey='',enabled=false,onWarning=()=>{};
 const key=(id,role,name)=>scope+encodeURIComponent(role)+'/'+encodeURIComponent(id)+'/'+encodeURIComponent(name);
 const sensitive=text=>/sk-[a-zA-Z0-9_-]{20,}/.test(text);
 function warn(reason){if(warned.has(reason))return;warned.add(reason);onWarning(reason);}
 function stale(){try{return !!version&&localStorage.getItem(buildKey)!==version;}catch{return false;}}
 function init(options){version=options.build;buildKey=options.buildKey;onWarning=options.onWarning;scope=prefix+options.workspaceId+'/'+version+'/';
  try{if(localStorage.getItem(buildKey)!==version){for(const k of Object.keys(localStorage))if(k.startsWith(prefix)||/^openjiuwen-workbench-v2-demo-\d+$/.test(k))localStorage.removeItem(k);localStorage.setItem(buildKey,version);}enabled=true;}
  catch{enabled=false;warn('浏览器暂存不可用。修改仍在本页内存，请保存到工程后再关闭。');}
 }
 function record(k){try{const text=localStorage.getItem(k);if(!text||text.length>2_000_000)return null;const value=JSON.parse(text);return value&&typeof value==='object'?value:null;}catch{return null;}}
 function read(id,role,name,fallback){if(!enabled||stale())return fallback;const value=record(key(id,role,name));return value?.value??fallback;}
 function write(id,role,name,value){const k=key(id,role,name);if(!enabled||stale()){failed.add(k);return false;}const text=JSON.stringify({value});
  if(sensitive(text)){try{localStorage.removeItem(k);}catch{}failed.add(k);warn('检测到疑似模型 Key，未写入浏览器暂存。请移除 Key，并在关闭前保存其他修改。');return false;}
  if(text.length>2_000_000){failed.add(k);warn('浏览器草稿超过暂存容量，仅保留本页内存。请保存到工程。');return false;}
  try{localStorage.setItem(k,text);failed.delete(k);return true;}catch{failed.add(k);warn('浏览器暂存已满或不可用，修改仍在本页内存，请保存到工程。');return false;}
 }
 function loadDraft(id,role){if(!enabled||stale())return null;const entry=record(key(id,role,'draft')),d=entry?.value;
  if(!d||!/^([a-f0-9]{40})$/.test(d.baseHead)||!d.changes||typeof d.changes!=='object'||Array.isArray(d.changes)||!Object.values(d.changes).every(v=>typeof v==='string'||v===null))return null;
  return {baseHead:d.baseHead,changes:d.changes,cacheTag:entry.tag??null,cached:true};
 }
 function saveDraft(id,role,d){const k=key(id,role,'draft');if(!enabled||stale()){failed.add(k);return {cached:false,cacheTag:d.cacheTag};}
  const existing=record(k);if((existing?.tag??null)!==(d.cacheTag??null)){failed.add(k);warn('其他标签页已更新此工程的本地草稿。当前修改仅留在本页，请核对后保存或复制。');return {cached:false,cacheTag:d.cacheTag};}
  const value={baseHead:d.baseHead,changes:d.changes},text=JSON.stringify(value);
  if(sensitive(text)){try{localStorage.removeItem(k);}catch{}failed.add(k);warn('检测到疑似模型 Key，未写入浏览器暂存。请移除 Key，并在关闭前保存其他修改。');return {cached:false,cacheTag:null};}
  if(text.length>2_000_000){failed.add(k);warn('浏览器草稿超过暂存容量，仅保留本页内存。请保存到工程。');return {cached:false,cacheTag:d.cacheTag};}
  const tag=crypto.randomUUID();try{localStorage.setItem(k,JSON.stringify({tag,value}));failed.delete(k);return {cached:true,cacheTag:tag};}catch{failed.add(k);warn('浏览器暂存已满或不可用，修改仍在本页内存，请保存到工程。');return {cached:false,cacheTag:d.cacheTag};}
 }
 function clearDraft(id,role,d){const k=key(id,role,'draft');if(!enabled||stale())return false;if((record(k)?.tag??null)!==(d?.cacheTag??null))return false;try{localStorage.removeItem(k);failed.delete(k);return true;}catch{return false;}}
 return {init,stale,read,write,loadDraft,saveDraft,clearDraft,hasUnstored:()=>failed.size>0};
})();
