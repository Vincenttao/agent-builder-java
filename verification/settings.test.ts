import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {settings} from '../workbench-server/settings.js';
test('model selection supports generic local config, legacy config and environment precedence without exposing key',()=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-model-settings-'));const names=['MODEL_API_KEY','MODEL_BASE_URL','MODEL_NAME','DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','DEEPSEEK_MODEL'];const before=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{for(const n of names)delete process.env[n];
  writeFileSync(join(root,'.env.local'),'MODEL_API_KEY=local-placeholder\nMODEL_BASE_URL=http://127.0.0.1:8999/compatible/v1/\nMODEL_NAME=alternate-model\n',{mode:0o600});
  assert.equal(settings(root).model,'alternate-model');assert.equal(settings(root).baseUrl,'http://127.0.0.1:8999/compatible/v1/');assert.equal(settings(root).apiKey,'local-placeholder');
  process.env.DEEPSEEK_MODEL='legacy-environment';assert.equal(settings(root).model,'legacy-environment');process.env.MODEL_NAME='generic-environment';assert.equal(settings(root).model,'generic-environment');
  writeFileSync(join(root,'.env.local'),'DEEPSEEK_MODEL=legacy-local\nDEEPSEEK_BASE_URL=https://api.deepseek.com\n');delete process.env.MODEL_NAME;delete process.env.DEEPSEEK_MODEL;assert.equal(settings(root).model,'legacy-local');
 }finally{for(const n of names){if(before[n]===undefined)delete process.env[n];else process.env[n]=before[n];}rmSync(root,{recursive:true,force:true});}
});
