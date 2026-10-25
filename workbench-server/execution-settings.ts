import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {settings,localSettings,compatibleBaseUrl} from './settings.js';
import {WorkbenchError,type Files} from './projects.js';
export type RuntimeSelection={modelProfile:string;environmentId:string};
const identifier=/^[a-z][a-z0-9_-]{0,39}$/;
export function selection(files:Files):RuntimeSelection{if(!files['runtime-settings.json'])return {modelProfile:'default',environmentId:'local'};try{const value=JSON.parse(files['runtime-settings.json']);if(!value||Object.keys(value).some(k=>!['modelProfile','environmentId'].includes(k))||typeof value.modelProfile!=='string'||typeof value.environmentId!=='string'||!identifier.test(value.modelProfile)||!identifier.test(value.environmentId))throw Error();return value;}catch{throw new WorkbenchError('INVALID_RUNTIME_SETTINGS','运行配置仅保存有效的modelProfile和environmentId引用');}}
function array(value:string|undefined){if(!value)return [];try{if(value.length>64000)throw Error();const parsed=JSON.parse(value);if(!Array.isArray(parsed)||parsed.length>16)throw Error();return parsed as Record<string,any>[];}catch{throw new WorkbenchError('INVALID_LOCAL_PROFILES','本机模型/环境目录须为最多16项的有效JSON数组');}}
export function registry(repository=process.cwd()){
 const local=localSettings(repository),base=settings(repository),models=[{id:'default',title:'本机默认模型',model:base.model,baseUrl:base.baseUrl,keyEnv:'MODEL_API_KEY',apiKey:base.apiKey}];
 for(const p of array(process.env.MODEL_PROFILES_JSON??local.MODEL_PROFILES_JSON)){
  if(!p||Object.keys(p).some(k=>!['id','title','model','baseUrl','keyEnv'].includes(k))||typeof p.id!=='string'||!identifier.test(p.id)||models.some(x=>x.id===p.id)||typeof p.title!=='string'||p.title.length>80||typeof p.model!=='string'||!/^[A-Za-z0-9_.:/-]{1,120}$/.test(p.model)||typeof p.baseUrl!=='string'||typeof p.keyEnv!=='string'||!/^[A-Z][A-Z0-9_]{0,79}$/.test(p.keyEnv))throw new WorkbenchError('INVALID_LOCAL_PROFILES','模型目录字段无效、重复或包含不允许的内容');
  compatibleBaseUrl(p.baseUrl);models.push({...p,apiKey:process.env[p.keyEnv]??local[p.keyEnv]??(p.keyEnv==='MODEL_API_KEY'?base.apiKey:'')} as typeof models[number]);
 }
 const environments:{id:string;title:string;connections:Record<string,string>}[]=[{id:'local',title:'本机已保存连接',connections:{}}];
 for(const p of array(process.env.WORKBENCH_ENVIRONMENTS_JSON??local.WORKBENCH_ENVIRONMENTS_JSON)){
  if(!p||Object.keys(p).some(k=>!['id','title','connections'].includes(k))||typeof p.id!=='string'||!identifier.test(p.id)||environments.some(x=>x.id===p.id)||typeof p.title!=='string'||p.title.length>80||!p.connections||typeof p.connections!=='object'||Array.isArray(p.connections)||Object.keys(p.connections).length>50)throw new WorkbenchError('INVALID_LOCAL_PROFILES','环境目录字段无效或重复');
  for(const [key,value]of Object.entries(p.connections)){try{const url=new URL(String(value));if(!/^[a-z][a-z0-9-]{0,63}$/.test(key)||typeof value!=='string'||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error();}catch{throw new WorkbenchError('INVALID_LOCAL_PROFILES','环境连接须为有效的无凭据HTTP(S)地址');}}
  environments.push(p as typeof environments[number]);
 }
 return {models,environments};
}
export function publicRegistry(repository=process.cwd()){const r=registry(repository);return {scope:'local-catalog',profiles:r.models.map(m=>{let origin='地址无效';try{origin=new URL(m.baseUrl).origin;}catch{}return {id:m.id,title:m.title,model:m.model,origin,configured:Boolean(m.apiKey)};}),environments:r.environments};}
export function executionSettings(repository:string,directory:string){const path=join(directory,'runtime-settings.json'),chosen=selection(existsSync(path)?{'runtime-settings.json':readFileSync(path,'utf8')}:{}) ,r=registry(repository),model=r.models.find(x=>x.id===chosen.modelProfile);if(!model)throw new WorkbenchError('MODEL_PROFILE_NOT_FOUND','所选模型配置档不存在，请重新选择');compatibleBaseUrl(model.baseUrl);if(!r.environments.some(x=>x.id===chosen.environmentId))throw new WorkbenchError('ENVIRONMENT_NOT_FOUND','所选环境配置档不存在，请重新选择');return {...settings(repository),...chosen,model:model.model,baseUrl:model.baseUrl,apiKey:model.apiKey};}
export type ExecutionSettings=ReturnType<typeof executionSettings>;
export function publicExecution(config:ExecutionSettings){let origin='地址无效';try{origin=new URL(config.baseUrl).origin;}catch{}return {modelProfile:config.modelProfile,environmentId:config.environmentId,model:config.model,origin,baseUrl:config.baseUrl,configured:Boolean(config.apiKey)};}
