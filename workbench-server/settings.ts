import {existsSync,readFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {WorkbenchError} from './projects.js';
export function settings(repository=process.cwd()){
 const file=join(repository,'.env.local');const local:Record<string,string>={};
 if(existsSync(file)){
  if((statSync(file).mode&0o077)!==0)throw new WorkbenchError('PRIVATE_CONFIG_MODE','请将本机 .env.local 权限设为 600',500);
  for(const line of readFileSync(file,'utf8').split('\n')){const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))local[line.slice(0,i).trim()]=line.slice(i+1).trim();}
 }
 return {apiKey:process.env.DEEPSEEK_API_KEY??local.DEEPSEEK_API_KEY??'',model:process.env.DEEPSEEK_MODEL??local.DEEPSEEK_MODEL??'deepseek-flash',baseUrl:process.env.DEEPSEEK_BASE_URL??local.DEEPSEEK_BASE_URL??'https://api.deepseek.com',opencode:process.env.OPENCODE_BIN??'opencode',repository:resolve(repository)};
}
