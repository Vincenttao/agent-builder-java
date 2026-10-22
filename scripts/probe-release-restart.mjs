import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
// Explicit live probe: restarts local Compose, then republishes the verified target.
if(process.env.RUN_LIVE_E2E!=='1')throw new Error('Set RUN_LIVE_E2E=1 for the live recovery probe');
const base=process.env.APP_ORIGIN??'http://127.0.0.1:8080';
async function login(){const r=await fetch(base+'/api/auth/session',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:process.env.LOCAL_BOOTSTRAP_TOKEN})});assert.equal(r.status,200);return{cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrfToken};}
const request=async(path,session,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{cookie:session.cookie,origin:base,'x-csrf-token':session.csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.ok,true,`HTTP ${r.status} for ${path}`);return r.json();};
async function docker(args){const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],windowsHide:true});let text='';child.stdout.on('data',d=>{text+=d;});child.stderr.on('data',()=>{});assert.equal(await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);}),0);return text;}
async function internal(service,path,tokenName,port){
  const code=`const r=await fetch('http://127.0.0.1:${port}${path}',{headers:{authorization:'Bearer '+process.env.${tokenName}}});if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()));`;
  return JSON.parse(await docker(['compose','--env-file','.env.local','exec','-T',service,'node','--input-type=module','-e',code]));
}
const published=JSON.parse(await readFile('test-results/publication-live.json','utf8'));const agentId=published.final.pointer.agentId;const session=await login();
async function republish(activeSession,version,revision){
  const admitted=await request(`/api/drafts/${agentId}/releases`,activeSession,'POST',{clientRequestId:randomUUID(),snapshotId:version.snapshotId,validationId:version.validationId,expectedRevision:revision});
  let operation=admitted;const until=Date.now()+180000;
  while(!['succeeded','failed'].includes(operation.status)&&Date.now()<until){await new Promise(r=>setTimeout(r,1000));operation=await request(`/api/releases/${admitted.id}`,activeSession);}
  assert.equal(operation.status,'succeeded',operation.diagnostic);return operation;
}
let before=await request(`/api/drafts/${agentId}/releases`,session);assert.ok(before.operations.every(o=>['succeeded','failed'].includes(o.status)));assert.deepEqual(before.cleanupPending,[]);
let version=before.versions.find(v=>v.id===before.pointer.versionId);assert.ok(version);let initialRecovery;
const initialDeployment=await internal('runner',`/deployments/${version.deploymentId}`,'RUNNER_CONTROL_TOKEN',8081);
if(['stopped','interrupted'].includes(initialDeployment.status)){
  initialRecovery=await republish(session,version,before.pointer.revision);before=await request(`/api/drafts/${agentId}/releases`,session);version=before.versions.find(v=>v.id===before.pointer.versionId);
}
const reports=await Promise.all([...new Set(before.versions.map(v=>v.validationId))].map(async id=>({id,report:await request(`/api/validations/${id}/report`,session)})));
const smokeId=before.operations.find(o=>o.versionId===version.id).smokeRunId;const run=await request(`/api/runs/${smokeId}`,session);assert.equal(run.status,'succeeded');
const state=await internal('mock-services',`/control/environments/${version.environmentId}`,'MOCK_CONTROL_TOKEN',8082);
assert.equal((await internal('runner',`/deployments/${version.deploymentId}`,'RUNNER_CONTROL_TOKEN',8081)).status,'ready');
await writeFile('test-results/tdd-009/release-restart-before.json',JSON.stringify({before,reports,run,state,initialRecovery},null,2));
await docker(['compose','--env-file','.env.local','restart','postgres','mock-services','runner','app']);
let restoredSession;const deadline=Date.now()+45000;
while(Date.now()<deadline){try{restoredSession??=await login();if((await request('/api/environment',restoredSession)).canRun)break;}catch{restoredSession=undefined;}await new Promise(r=>setTimeout(r,500));}
assert.ok(restoredSession);assert.equal((await request('/api/environment',restoredSession)).canRun,true);
assert.equal((await fetch(base+'/api/drafts',{headers:{cookie:session.cookie}})).status,401);
const after=await request(`/api/drafts/${agentId}/releases`,restoredSession);assert.deepEqual(after,before);
assert.deepEqual(await request(`/api/runs/${smokeId}`,restoredSession),run);
for(const item of reports)assert.deepEqual(await request(`/api/validations/${item.id}/report`,restoredSession),item.report);
assert.deepEqual(await internal('mock-services',`/control/environments/${version.environmentId}`,'MOCK_CONTROL_TOKEN',8082),state);
const interrupted=await internal('runner',`/deployments/${version.deploymentId}`,'RUNNER_CONTROL_TOKEN',8081);assert.ok(['stopped','interrupted'].includes(interrupted.status),'Previous JVM must not be presented as ready after restart');
const operation=await republish(restoredSession,version,before.pointer.revision);
const recovered=await request(`/api/drafts/${agentId}/releases`,restoredSession);const current=recovered.versions.find(v=>v.id===recovered.pointer.versionId);
assert.equal(current.snapshotId,version.snapshotId);assert.notEqual(current.deploymentId,version.deploymentId);assert.equal(current.environmentId,version.environmentId);
assert.deepEqual(recovered.versions.filter(v=>v.id!==current.id),before.versions);
assert.deepEqual(await internal('mock-services',`/control/environments/${version.environmentId}`,'MOCK_CONTROL_TOKEN',8082),state);
assert.equal((await internal('runner',`/deployments/${current.deploymentId}`,'RUNNER_CONTROL_TOKEN',8081)).status,'ready');
const result={checkedAt:new Date().toISOString(),servicesRestarted:['postgres','mock-services','runner','app'],agentId,historyPersistedExactly:true,reportsPersistedExactly:true,oldRunPersistedExactly:true,businessStatePersistedExactly:true,oldSessionInvalidated:true,
  initialRecovery,previousDeployment:interrupted,recoveryOperation:operation,currentVersion:current,previousVersion:version.id,revisionBefore:before.pointer.revision,revisionAfter:recovered.pointer.revision};
await writeFile('test-results/tdd-009/release-restart.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({agentId,historyPersistedExactly:true,reportsPersistedExactly:true,businessStatePersistedExactly:true,previousDeploymentStatus:interrupted.status,recoveredDeploymentId:current.deploymentId,currentVersion:current.id}));
