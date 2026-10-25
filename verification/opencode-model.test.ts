import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OpenCodeEngine} from '../workbench-server/opencode.js';
test('OpenCode adapter passes configured model and matching provider catalog to a local protocol stub',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workbench-opencode-model-')),capture=join(root,'capture.json'),binary=join(root,'opencode-stub.mjs');
 const fields=['MODEL_API_KEY','MODEL_BASE_URL','MODEL_NAME','DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','DEEPSEEK_MODEL','OPENCODE_BIN'];const before=Object.fromEntries(fields.map(n=>[n,process.env[n]]));
 writeFileSync(binary,`#!/usr/bin/env node
import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';const config=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);const port=Number(process.argv[process.argv.indexOf('--port')+1]);const server=createServer(async(q,r)=>{let text='';for await(const part of q)text+=part;r.setHeader('content-type','application/json');if(q.url==='/global/health')r.end(JSON.stringify({healthy:true,version:'1.18.9'}));else if(q.url==='/session')r.end(JSON.stringify({id:'local-session'}));else if(q.url.endsWith('/prompt_async')){writeFileSync(${JSON.stringify(capture)},JSON.stringify({request:JSON.parse(text).model,selected:config.model,catalog:config.provider.workbench.models,base:config.provider.workbench.options.baseURL}));r.writeHead(204);r.end();}else if(q.url==='/session/status')r.end('{}');else if(q.url==='/question')r.end('[]');else if(q.url.endsWith('/message'))r.end(JSON.stringify([{info:{role:'assistant',time:{completed:Date.now()},finish:'stop'},parts:[{type:'tool',tool:'skill',state:{status:'completed',input:{name:'moa-application-development'}}},{type:'text',text:'local protocol stub only'}]}]));else {r.writeHead(404);r.end('{}');}});server.listen(port,'127.0.0.1');process.once('SIGTERM',()=>server.close(()=>process.exit(0)));
`,{mode:0o755});
 try{for(const n of fields)delete process.env[n];process.env.OPENCODE_BIN=binary;writeFileSync(join(root,'.env.local'),'MODEL_API_KEY=local-placeholder\nMODEL_NAME=alternate-model\nMODEL_BASE_URL=http://127.0.0.1:8999/compatible/v1/\n',{mode:0o600});const directory=join(root,'workspace');mkdirSync(directory);
  const result=await new OpenCodeEngine(root).run({directory,prompt:'local-only test',skill:'moa-application-development',signal:new AbortController().signal,onEvent:()=>{}});const value=JSON.parse(readFileSync(capture,'utf8'));assert.equal(result.model,'alternate-model');assert.equal(value.selected,'workbench/alternate-model');assert.deepEqual(value.request,{providerID:'workbench',modelID:'alternate-model'});assert.ok(value.catalog['alternate-model']);assert.deepEqual(value.catalog['alternate-model'].options,{});assert.equal(value.base,'http://127.0.0.1:8999/compatible/v1');
 }finally{for(const n of fields){if(before[n]===undefined)delete process.env[n];else process.env[n]=before[n];}rmSync(root,{recursive:true,force:true});}
});
