import{readFile,writeFile,mkdir}from'node:fs/promises';import{execFile}from'node:child_process';import{promisify}from'node:util';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';
if(process.env.RUN_LIVE_E2E!=='1')throw new Error('Explicit RUN_LIVE_E2E=1 required');
const base=process.env.APP_ORIGIN??'http://127.0.0.1:8080';const path='test-results/tdd-011/upgrade-checkpoint.json';await mkdir('test-results/tdd-011',{recursive:true});
let state;try{state=JSON.parse(await readFile(path,'utf8'));}catch{state={};}
const save=()=>writeFile(path,JSON.stringify(state,null,2));const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const exec=promisify(execFile);
let admin;
async function login(){const response=await fetch(`${base}/api/auth/session`,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:process.env.LOCAL_BOOTSTRAP_TOKEN})});assert.equal(response.status,200);admin={origin:base,cookie:response.headers.get('set-cookie').split(';')[0],'x-csrf-token':(await response.json()).csrfToken,'content-type':'application/json'};}
async function api(path,method='GET',body,headers=admin){const response=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const value=await response.json();if(!response.ok)throw new Error(`API ${response.status} ${value.code??'UNKNOWN'} ${path}`);return value;}
async function poll(read,done,timeout=240000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(done(value))return value;await wait(1000);}throw new Error('Observation timed out; resume the same IDs from upgrade-checkpoint.json');}
async function internal(service,path,tokenName,port){
  const code=`const r=await fetch('http://127.0.0.1:${port}'+${JSON.stringify(path)},{headers:{authorization:'Bearer '+process.env[${JSON.stringify(tokenName)}]}});if(!r.ok)throw new Error('Internal read '+r.status);console.log(JSON.stringify(await r.json()));`;
  const result=await exec('docker',['compose','--env-file','.env.local','exec','-T',service,'node','--input-type=module','-e',code],{windowsHide:true,timeout:20000});return JSON.parse(result.stdout);
}
async function fence(id){assert.match(id,/^[a-f0-9-]{36}$/);const code=`const fs=await import('node:fs/promises');console.log(await fs.readFile('/data/executions/claims/'+${JSON.stringify(id)}+'.json','utf8'));`;
  return JSON.parse((await exec('docker',['compose','--env-file','.env.local','exec','-T','runner','node','--input-type=module','-e',code],{windowsHide:true,timeout:20000})).stdout);}
await login();
if(!state.oldVersion){
  const previous=JSON.parse(await readFile('docs/implementation/evidence/TDD-010/live-invocation.json','utf8'));state.agentId=previous.evidence.request.agentId;
  const overview=await api(`/api/drafts/${state.agentId}/releases`);state.oldVersion=overview.versions.find(v=>v.id===overview.pointer.versionId);state.oldReport=await api(`/api/validations/${state.oldVersion.validationId}/report`);await save();
}
const issue=async(actorId='U1002')=>{const grant=await api('/api/demo-sessions','POST',{agentId:state.agentId,actorId});return{authorization:`Bearer ${grant.token}`,'content-type':'application/json'};};let business=await issue();
if(!state.oldBlocked){
  const response=await fetch(`${base}/api/drafts/${state.agentId}/releases`,{method:'POST',headers:admin,body:JSON.stringify({clientRequestId:randomUUID(),snapshotId:state.oldVersion.snapshotId,validationId:state.oldVersion.validationId,expectedRevision:(await api(`/api/drafts/${state.agentId}/releases`)).pointer.revision})});
  assert.equal(response.status,409);state.oldReportRejection=await response.json();assert.equal(state.oldReportRejection.code,'VALIDATION_BINDING_CHANGED');
  if(!state.oldRequest){state.oldMessage={clientRequestId:randomUUID(),input:'查询 PUMP-001 的状态与温度'};state.oldRequest=await api(`/agent-api/agents/${state.agentId}/messages`,'POST',state.oldMessage,business);await save();}
  state.oldBlocked=await poll(()=>api(`/agent-api/requests/${state.oldRequest.requestId}`,'GET',undefined,business),value=>['blocked','cancelled'].includes(value.request.status));assert.equal(state.oldBlocked.request.diagnostic,'PUBLISHED_DEPENDENCY_CHANGED');assert.equal(state.oldBlocked.run,null);
  await save();console.log(JSON.stringify({stage:'old-binding-rejected'}));
}
await api(`/agent-api/requests/${state.oldRequest.requestId}/cancel`,'POST',{},business);
if(!state.validation){state.validation=await api(`/api/snapshots/${state.oldVersion.snapshotId}/validations`,'POST',{clientRequestId:randomUUID(),baselineId:state.oldReport.baselineId,allowMockWrites:false});await save();}
const validation=await poll(()=>api(`/api/validations/${state.validation.id}`),value=>value.status==='completed');assert.equal(validation.verdict,'passed');
state.report=await api(`/api/validations/${validation.id}/report`);assert.notEqual(state.report.binding.mockDigest,state.oldReport.binding.mockDigest);assert.ok(state.report.cases.every(c=>c.status==='passed'));await save();console.log(JSON.stringify({stage:'revalidated',validationId:validation.id,cases:state.report.cases.length}));
async function publish(field){
  if(!state[field]){const overview=await api(`/api/drafts/${state.agentId}/releases`);state[field]=await api(`/api/drafts/${state.agentId}/releases`,'POST',{clientRequestId:randomUUID(),snapshotId:state.oldVersion.snapshotId,validationId:state.validation.id,expectedRevision:overview.pointer.revision});await save();}
  const operation=await poll(()=>api(`/api/releases/${state[field].id}`),value=>['succeeded','failed'].includes(value.status));assert.equal(operation.status,'succeeded');
  const overview=await api(`/api/drafts/${state.agentId}/releases`);const version=overview.versions.find(v=>v.id===operation.versionId);assert.equal(version.smokeEvidence.case.status,'passed');assert.equal(version.smokeEvidence.readOnly,true);return version;
}
state.version=await publish('publication');
if(!state.message){state.messageInput={clientRequestId:randomUUID(),input:'查询 PUMP-001 的状态、温度与来源。'};state.message=await api(`/agent-api/agents/${state.agentId}/messages`,'POST',state.messageInput,business);await save();}
state.completed??=await poll(()=>api(`/agent-api/requests/${state.message.requestId}`,'GET',undefined,business),value=>value.run&&['succeeded','failed','interrupted','cancelled'].includes(value.run.status));
assert.equal(state.completed.run.status,'succeeded');assert.equal(state.completed.agentVersion,state.version.id);assert.equal(state.completed.run.externalEvidence.length,1);assert.equal(state.completed.run.externalEvidence[0].actorId,'U1002');
const oldRetry=await api(`/agent-api/agents/${state.agentId}/messages`,'POST',state.oldMessage,business);assert.equal(oldRetry.requestId,state.oldRequest.requestId);assert.equal(oldRetry.request.status,'cancelled');
state.fenceBefore??=await fence(state.completed.runId);assert.ok(BigInt(state.fenceBefore.token)>=2n);await save();
if(!state.restarted){
  state.bootBefore??=await internal('runner','/capabilities','RUNNER_CONTROL_TOKEN',8081);await save();
  const boot=await internal('runner','/capabilities','RUNNER_CONTROL_TOKEN',8081);
  if(boot.bootId===state.bootBefore.bootId)await exec('docker',['compose','--env-file','.env.local','restart','app','runner','mock-services','postgres'],{windowsHide:true,timeout:60000});
  await poll(async()=>{try{return(await fetch(`${base}/health/ready`,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},Boolean,60000);
  state.restarted=true;await save();
}
await login();business=await issue();state.afterRestart=await api(`/agent-api/requests/${state.completed.requestId}`,'GET',undefined,business);assert.deepEqual(state.afterRestart,state.completed);
state.fenceAfter=await fence(state.completed.runId);assert.deepEqual(state.fenceAfter,state.fenceBefore);state.bootAfter=await internal('runner','/capabilities','RUNNER_CONTROL_TOKEN',8081);assert.notEqual(state.bootAfter.bootId,state.bootBefore.bootId);
assert.deepEqual(await api(`/agent-api/agents/${state.agentId}/messages`,'POST',state.messageInput,business),state.completed);
state.readyVersion=await publish('restoration');state.readyDeployment=await internal('runner',`/deployments/${state.readyVersion.deploymentId}`,'RUNNER_CONTROL_TOKEN',8081);assert.equal(state.readyDeployment.status,'ready');await save();
await writeFile('test-results/tdd-011/live-upgrade.json',JSON.stringify({checkedAt:new Date().toISOString(),modelMode:'live-deepseek',scope:'Normal four-service restart, preserved completed request and Runner fence; explicit republish with smoke restores availability. No in-flight crash recovery claimed.',...state},null,2));
console.log(JSON.stringify({stage:'complete',requestId:state.completed.requestId,validationId:state.validation.id,currentVersion:state.readyVersion.id,fencePersisted:true,oldRequestPreserved:true}));
