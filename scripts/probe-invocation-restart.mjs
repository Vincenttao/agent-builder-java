import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
if(process.env.RUN_LIVE_E2E!=='1')throw new Error('Explicit RUN_LIVE_E2E=1 required');
const base=process.env.APP_ORIGIN??'http://127.0.0.1:8080';const live=JSON.parse(await readFile('test-results/tdd-010/live-invocation.json','utf8'));
const identity=live.evidence.request;const requestId=live.evidence.requestId;
async function login(){
  const response=await fetch(`${base}/api/auth/session`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:process.env.LOCAL_BOOTSTRAP_TOKEN})});assert.equal(response.status,200);
  return{origin:base,cookie:response.headers.get('set-cookie').split(';')[0],'x-csrf-token':(await response.json()).csrfToken,'content-type':'application/json'};
}
async function issue(headers){const response=await fetch(`${base}/api/demo-sessions`,{method:'POST',headers,body:JSON.stringify({agentId:identity.agentId,actorId:identity.actorId})});assert.equal(response.status,201);return(await response.json()).token;}
async function get(token){const response=await fetch(`${base}/agent-api/requests/${requestId}`,{headers:{authorization:`Bearer ${token}`}});assert.equal(response.status,200);return response.json();}
const beforeToken=await issue(await login());const before=await get(beforeToken);assert.deepEqual(before,live.evidence);
await promisify(execFile)('docker',['compose','--env-file','.env.local','restart','app'],{windowsHide:true,timeout:60000});
let ready=false;for(let attempt=0;attempt<45;attempt++){try{const response=await fetch(`${base}/health/ready`,{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}assert.ok(ready);
const expired=await fetch(`${base}/agent-api/requests/${requestId}`,{headers:{authorization:`Bearer ${beforeToken}`}});assert.equal(expired.status,401);
const token=await issue(await login());const after=await get(token);assert.deepEqual(after,before);
const retried=await fetch(`${base}/agent-api/agents/${identity.agentId}/messages`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(live.attempts[0])});assert.equal(retried.status,202);assert.deepEqual(await retried.json(),before);
const evidence={checkedAt:new Date().toISOString(),scope:'Normal app-only restart; Runner and Mock remain running. No crash or SDK checkpoint restoration claimed.',requestId,runId:before.runId,agentVersion:before.agentVersion,oldCredentialStatus:expired.status,historyPreservedExactly:true,retryReturnsOriginal:true,before,after};
await writeFile('test-results/tdd-010/invocation-restart.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({requestId,historyPreservedExactly:true,retryReturnsOriginal:true,oldCredentialStatus:expired.status}));
