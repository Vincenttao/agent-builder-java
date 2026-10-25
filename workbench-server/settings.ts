import {existsSync,readFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {WorkbenchError} from './projects.js';
export function settings(repository=process.cwd()){
 const file=join(repository,'.env.local');const local:Record<string,string>={};
 if(existsSync(file)){
  if((statSync(file).mode&0o077)!==0)throw new WorkbenchError('PRIVATE_CONFIG_MODE','请将本机 .env.local 权限设为 600',500);
  for(const line of readFileSync(file,'utf8').split('\n')){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))local[line.slice(0,i).trim()]=line.slice(i+1).trim();}
 }
 const pick=(name:string,legacy:string,fallback:string)=>process.env[name]??process.env[legacy]??local[name]??local[legacy]??fallback;
 return {apiKey:pick('MODEL_API_KEY','DEEPSEEK_API_KEY',''),model:pick('MODEL_NAME','DEEPSEEK_MODEL','deepseek-flash'),baseUrl:pick('MODEL_BASE_URL','DEEPSEEK_BASE_URL','https://api.deepseek.com'),opencode:process.env.OPENCODE_BIN??'opencode',repository:resolve(repository)};
}
export function compatibleBaseUrl(value:string){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new WorkbenchError('INVALID_MODEL_BASE_URL','模型地址必须为无凭据的 HTTP(S) API 前缀');const clean=value.replace(/\/+$/,'');return url.pathname==='/'?clean+'/v1':clean;}
