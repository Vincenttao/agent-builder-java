import type {Files} from './projects.js';

/** Bounded template contract. Text guidance never grants a new execution type. */
export function assemblyContract(files:Files){
 let manifest:Record<string,any>={};try{manifest=JSON.parse(files['template.json']??'{}');}catch{}
 let ops:Record<string,any>={};try{ops=JSON.parse(files['adapters/operations.json']??'{}')??{};}catch{}
 const confirmed=typeof ops==='object'&&!Array.isArray(ops)?Object.entries(ops).filter(([,v])=>v?.confirmationRequired===true).map(([id])=>id):[];
 const deep=manifest.family==='deepagent',open=manifest.openCapabilities??{};
 return {family:deep?'deepagent':'moa',skills:open.skills!==false,agent:!deep&&open.agent!==false,handoff:!deep&&open.handoff!==false,
  toolDrafts:Array.isArray(open.toolDrafts)?open.toolDrafts.filter((v:unknown)=>['HTTP','MCP','SCRIPT'].includes(String(v))):['HTTP','MCP','SCRIPT'],
  executionTypes:deep?['CORE']:['SCRIPT','A2A'],requiredConfirmations:deep?[]:[...new Set(['redeem','transfer','purchase',...confirmed,...(Array.isArray(manifest.requiredConfirmations)?manifest.requiredConfirmations.filter((v:unknown)=>typeof v==='string'):[])])],
  maxCalls:20,editablePrefixes:Array.isArray(manifest.applicationEditablePrefixes)?manifest.applicationEditablePrefixes.filter((p:unknown)=>typeof p==='string'):null};
}
export function contractIssues(files:Files,baseline:Files):string[]{
 const c=assemblyContract(baseline),errors:string[]=[];let d:any,ops:any,original:any;
 try{d=JSON.parse(files['application.json']);}catch{return ['应用定义格式无效'];}
 try{ops=JSON.parse(files['adapters/operations.json']??'{}');original=JSON.parse(baseline['adapters/operations.json']??'{}');}catch{ops={};original={}; /* malformed drafts still retain capability boundary checks */}
 if(!c.skills&&d.skills.length)errors.push('模板未开放业务 Skill');
 if(!c.agent&&d.capabilities.some((x:any)=>x.type==='agent'))errors.push('模板未开放 Agent/A2A 装配');
 if(!c.handoff&&d.handoff.enabled)errors.push('模板未开放范围外接管');
 for(const cap of d.capabilities){if(cap.type==='tool'&&(!c.toolDrafts.includes(cap.execution)||cap.status!=='draft'))errors.push('工具接入只能保存为模板允许的待接线草稿');}
 if(!ops||Array.isArray(ops)||typeof ops!=='object')return errors;
 for(const [id,op]of Object.entries(ops) as [string,any][]){
  if(!op||typeof op!=='object'||Array.isArray(op))continue;
  if(c.requiredConfirmations.includes(id)&&op.confirmationRequired!==true)errors.push(id+' 必须保留模板固定的写操作确认');
  if(original?.[id]?.confirmationRequired===true&&op.confirmationRequired!==true)errors.push(id+' 不得放宽模板确认约束');
  if(op.maxCalls!==undefined&&(!Number.isInteger(op.maxCalls)||op.maxCalls<1||op.maxCalls>c.maxCalls))errors.push(id+' 调用上限须为 1～'+c.maxCalls);
  if(op.type==='CORE'&&c.family!=='deepagent'||op.type==='A2A'&&!c.agent)errors.push(id+' 执行方式未由模板开放');
 }
 return [...new Set(errors)];
}
