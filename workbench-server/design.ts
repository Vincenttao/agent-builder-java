import {createHash} from 'node:crypto';
import {validateFiles,type ProjectStore,type Files} from './projects.js';
function catalog(files:Files){try{const value=JSON.parse(files['adapters/operations.json']??'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
function hash(files:Files,skillId:string){const d=validateFiles(files),skill=d.skills.find(s=>s.id===skillId),ops=catalog(files);return createHash('sha256').update(JSON.stringify({guidance:skill?files[skill.file]:null,operations:(skill?.operations??[]).map(id=>[id,ops[id]??null])})).digest('hex');}
/** File history is provenance, not a claim that the diagram correctly describes its Skill. */
export function flowSources(store:ProjectStore,id:string,head:string){
 const files=store.snapshot(id,head),d=validateFiles(files),result:Record<string,{status:'missing'|'current'|'stale'|'invalid';hash:string;sourceCommit?:string;reason:string;semantic:'not-verified'}>={};
 for(const skill of d.skills){const path='skills/'+skill.id+'/flow.json',currentHash=hash(files,skill.id),common={hash:currentHash,semantic:'not-verified' as const};
  if(!files[path]){result[skill.id]={...common,status:'missing',reason:'尚无流程说明图，可由Coding助手参考当前Skill生成。'};continue;}
  let flow:any;try{flow=JSON.parse(files[path]);if(flow.designOnly!==true||!Array.isArray(flow.nodes)||!Array.isArray(flow.edges))throw Error();}catch{result[skill.id]={...common,status:'invalid',reason:'流程说明JSON格式无效，请修复。'};continue;}
  const sourceCommit=store.git(id,['log','-1','--format=%H',head,'--',path]);
  const sourceHash=typeof flow.sourceHash==='string'?flow.sourceHash:sourceCommit?hash(store.snapshot(id,sourceCommit),skill.id):null;
  const stale=sourceHash!==currentHash;
  result[skill.id]={...common,sourceCommit,status:stale?'stale':'current',reason:stale?'Skill指导或绑定操作已变化，流程说明需要关联修订。':'来源与当前保存指导一致；图示语义仍需审阅和业务验证。'};
 }
 return result;
}
