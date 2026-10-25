// Installs explicitly authored examples through the real workbench API. Never calls a coding model.
import assert from 'node:assert/strict';import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {moaTemplateFiles} from '../workbench-server/template.js';import {readTree} from '../workbench-server/files.js';
const base=process.env.WORKBENCH_URL??'http://127.0.0.1:8768';assert.equal(new URL(base).hostname,'127.0.0.1');const mock=process.env.EXAMPLE_MOCK_URL??'http://127.0.0.1:8772';assert.equal(new URL(mock).hostname,'127.0.0.1');const context=await(await fetch(base+'/api/context')).json() as any;
const marker=resolve('.workbench/examples/commerce-wealth-'+context.workspaceId+'.json');mkdirSync(resolve('.workbench/examples'),{recursive:true});
async function api(path:string,role='application',method='GET',body?:unknown){const r=await fetch(base+'/api'+path,{method,headers:{'content-type':'application/json','x-workbench-role':role,'x-workbench-workspace':context.workspaceId},body:body===undefined?undefined:JSON.stringify(body)});const value=await r.json() as any;assert.ok(r.ok,value.error?.message??r.status);return value;}
if(existsSync(marker)){
 const saved=JSON.parse(readFileSync(marker,'utf8')),common=readTree(resolve('examples/commerce-wealth'));
 // Only add missing design metadata to installer-owned, unchanged examples. Never replace business edits.
 for(const app of saved.applications){const current=await api('/projects/'+app.id);assert.equal(current.project.head,app.head,'Example was modified; preserve it rather than overwrite');}
 for(const app of saved.applications){const current=await api('/projects/'+app.id),ids=current.definition.skills.map((s:any)=>s.id),desired:Record<string,string>={};for(const id of ids){const path='skills/'+id+'/flow.json';if(common[path]&&!current.files[path])desired[path]=common[path];}if(!current.files['tests/routing-examples.json']){const cases=JSON.parse(common['tests/routing-examples.json']).cases.filter((x:any)=>x.action!=='SKILL'||ids.includes(x.target));desired['tests/routing-examples.json']=JSON.stringify({cases},null,2)+'\n';}if(Object.keys(desired).length){app.head=(await api('/projects/'+app.id+'/files','application','PUT',{baseHead:app.head,changes:desired})).project.head;writeFileSync(marker,JSON.stringify(saved,null,2)+'\n');}}
 console.log(JSON.stringify({alreadyInstalled:true,designMetadataPresent:true,...saved},null,2));}

else{
 const template=await api('/projects/moa-platform','platform'),latest=moaTemplateFiles();const changes=Object.fromEntries(Object.entries(latest).filter(([name,value])=>template.files[name]!==value));let head=template.project.head;
 if(Object.keys(changes).length)head=(await api('/projects/moa-platform/files','platform','PUT',{baseHead:head,changes})).project.head;
 const {releases}=await api('/templates');let release=releases.find((r:any)=>r.commit===head);if(!release){const next=Math.max(0,...releases.map((r:any)=>Number(r.version.split('.')[0])))+1;release=(await api('/templates/moa-platform/releases','platform','POST',{version:next+'.0.0'})).release;}
 const common=readTree(resolve('examples/commerce-wealth'));const applications=[];
 for(const [kind,name,ids]of [['idou','i豆商城',['benefits']],['wealth','理财购买',['wealth']],['main','综合业务主Agent',['benefits','wealth']]] as const){
  const created=(await api('/projects','application','POST',{releaseId:release.id,name})).project;assert.deepEqual((await api('/projects/'+created.id)).definition.skills,[]);
  const files={...common},definition=JSON.parse(files['application.json']);definition.name=name;definition.connections={idou:mock,wealth:mock};definition.skills=definition.skills.filter((s:any)=>(ids as readonly string[]).includes(s.id));if(kind!=='main')definition.scope.own=definition.scope.own.filter((s:string)=>s.includes(kind==='idou'?'benefits':'wealth'));definition.description='预制模拟示例（人工编写，非本次OpenCode生成）：'+name+'；从MOA空模板装配，业务由独立Mock提供。';files['application.json']=JSON.stringify(definition,null,2)+'\n';files['tests/routing-examples.json']=JSON.stringify({cases:JSON.parse(common['tests/routing-examples.json']).cases.filter((x:any)=>x.action!=='SKILL'||(ids as readonly string[]).includes(x.target))},null,2)+'\n';
  const saved=(await api('/projects/'+created.id+'/files','application','PUT',{baseHead:created.head,changes:files})).project;applications.push({kind,id:saved.id,name:saved.name,head:saved.head});
 }
 const result={workspaceId:context.workspaceId,release,provenance:'explicitly authored preset examples; not OpenCode generation evidence',mock,applications};writeFileSync(marker,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
