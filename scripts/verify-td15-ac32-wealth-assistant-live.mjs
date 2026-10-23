import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

const base=(process.env.TD15_AC32_BASE_URL??'http://127.0.0.1:18080').replace(/\/$/,'');
const origin=process.env.TD15_AC32_ORIGIN??'http://127.0.0.1:8080';
const project=process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT??'agent-builder-td15-nf01';
const evidencePath=process.env.TD15_AC32_EVIDENCE_PATH??'docs/implementation/evidence/TD15-AC32-wealth-assistant-live.json';
const token=process.env.LOCAL_BOOTSTRAP_TOKEN??(await readFile('.env.local','utf8')).split(/\r?\n/).find(line=>line.startsWith('LOCAL_BOOTSTRAP_TOKEN='))?.slice('LOCAL_BOOTSTRAP_TOKEN='.length).replace(/^['"]|['"]$/g,'');
assert.ok(token,'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const evidence={schemaVersion:1,caseId:'AC-32',executionMode:'live-mock',startedAt:new Date().toISOString(),base,composeProject:project,verdict:'running'};
let cookie,csrf;
const imageIds=()=>{const ids=execFileSync('docker',['compose','--env-file','.env.local','-p',project,'ps','-q','app','runner'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);assert.equal(ids.length,2,'APP_RUNNER_TARGET_REQUIRED');return execFileSync('docker',['inspect','--format','{{.Image}}',...ids],{encoding:'utf8'}).trim().split(/\r?\n/);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const login=await fetch(`${base}/api/auth/session`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})});
assert.equal(login.status,200,'LOGIN_FAILED');cookie=login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];csrf=(await login.json()).csrfToken;assert.ok(cookie&&csrf,'SESSION_CONTEXT_REQUIRED');
const readHeaders={cookie};const writeHeaders={origin,cookie,'x-csrf-token':csrf,'content-type':'application/json'};
async function api(path,method='GET',body){const response=await fetch(`${base}${path}`,{method,headers:method==='GET'?readHeaders:writeHeaders,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45_000)});const value=response.status===204?null:await response.json();assert.ok(response.ok,`API_${method}_${response.status}_${value?.code??path}`);return value;}
async function poll(path,terminals,timeout,label){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await api(path);if(terminals.includes(value.status))return value;await wait(1000);}throw new Error(`${label}_TIMEOUT`);}
async function business(path,method='GET',body,grant){const response=await fetch(`${base}${path}`,{method,headers:{authorization:`Bearer ${grant.token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45_000)});const value=await response.json();assert.ok(response.ok,`BUSINESS_${method}_${response.status}:${value?.code??path}`);return value;}
async function pollBusiness(path,grant){const deadline=Date.now()+120_000;while(Date.now()<deadline){const value=await business(path,'GET',undefined,grant);if(value.run&&['succeeded','failed','cancelled','interrupted'].includes(value.run.status))return value;await wait(500);}throw new Error('BUSINESS_RUN_TIMEOUT');}
try{
  evidence.targetImageIds=imageIds();
  const draft=await api('/api/drafts','POST',{name:`TD15 AC32 ${randomUUID().slice(0,8)}`,brief:{
    audience:{value:'企业手机银行用户',source:'user',confirmed:true},
    goal:{value:'通过一个已发布的只读 Agent 查询指定账户余额或理财产品目录，所有业务事实来自企业模拟接口。',source:'user',confirmed:true},
    output:{value:'余额查询返回账户、币种、可用余额分、时间；产品查询返回产品编号、名称、状态、最低金额、说明和目录版本。',source:'user',confirmed:true}
  }});evidence.draftId=draft.id;
  const assembly={agentType:'DeepAgent',maxIterations:6,railIds:['audit@1','tool-allowlist@1'],toolIds:[],generationProfileVersion:'wealth-assistant-java@1',
    systemPrompt:'你是企业理财查询助手。先调用 skill_tool 读取 wealth-query/SKILL.md。查询余额时调用 get_account_balance 并只传 accountId；查询产品时调用 list_wealth_products 且参数为空。余额成功时必须仅输出一个 JSON 对象，不加 Markdown 或自然语言，格式为 {"kind":"account-balance","accountId":"接口返回值","currency":"接口返回值","availableBalanceFen":接口返回整数,"asOf":"接口返回值"}，所有值必须逐字来自工具结果。产品查询时必须仅输出一个 JSON 对象，格式为 {"kind":"wealth-products","version":"接口返回值","items":[{"productId":"接口返回值","name":"接口返回值","status":"接口返回值","minimumAmountFen":接口返回整数,"description":"接口返回值"}]}，完整保留工具返回的每个产品。缺少账户编号时用一句话追问，不调用余额工具；工具错误或数据缺失时说明未知，不能输出推测值。只读，不申购、不转账。'};
  const snapshot=await api(`/api/drafts/${draft.id}/snapshots`,'POST',{expectedRevision:draft.revision,assembly});evidence.snapshotId=snapshot.id;
  const preview=await api(`/api/drafts/${draft.id}/baseline-preview?templateId=${encodeURIComponent('wealth-balance-read@1')}`);
  const baseline=await api(`/api/drafts/${draft.id}/baselines`,'POST',{expectedRevision:draft.revision,templateId:'wealth-balance-read@1',expectedDigest:preview.digest,confirmed:true});evidence.baselineId=baseline.id;evidence.baselineDigest=baseline.digest;
  const generation={profileVersion:'wealth-assistant-java@1',scope:['tool','skill'],dependencies:['openjiuwen-core@0.1.17','agent-builder-bridge@0.1.0'],connectionProfile:'mock-finance@1'};
  let job=await api(`/api/snapshots/${snapshot.id}/development`,'POST',{clientRequestId:randomUUID(),baselineId:baseline.id,generation,maxSeconds:900});evidence.developmentJobId=job.id;
  job=await poll(`/api/development/${job.id}`,['built','failed','cancelled'],15*60_000,'DEVELOPMENT');evidence.development=job;assert.equal(job.status,'built',`DEVELOPMENT_${job.diagnostic??job.status}`);
  const toolFile=await api(`/api/development/${job.id}/file?path=${encodeURIComponent('src/generated/WealthQueryTool.java')}`);
  const skillFile=await api(`/api/development/${job.id}/file?path=${encodeURIComponent('skills/wealth-query/SKILL.md')}`);
  evidence.generatedFiles=[toolFile,skillFile];assert.match(toolFile.content,/class WealthQueryTool/);assert.match(skillFile.content,/name:\s*wealth-query/);
  const commands=[];for(const event of (await api(`/api/development/${job.id}/events`)).items.filter(item=>item.type==='command.completed')){const id=event.data.id??event.data.commandId;if(id)commands.push(await api(`/api/development/${job.id}/commands/${id}`));}
  evidence.commands=commands.map(({id,commandId,exitCode,status})=>({id,commandId,exitCode,status}));const bundle=job.bundle;assert.ok(bundle,'BUNDLE_REQUIRED');
  for(const id of [bundle.unitRedId,bundle.unitGreenId,bundle.contractCheckId,bundle.buildId])assert.ok(commands.some(command=>command.id===id&&command.exitCode===(id===bundle.unitRedId?1:0)),`TDD_COMMAND_EVIDENCE_MISSING:${id}`);
  assert.deepEqual(bundle.runtimeSpec.tools.map(tool=>[tool.name,tool.operationId]),[['get_account_balance','getAccountBalance'],['list_wealth_products','listWealthProducts']]);
  const candidate=await api('/api/candidates','POST',{snapshotId:snapshot.id,developmentJobId:job.id});evidence.candidate=candidate;
  const started=await api(`/api/snapshots/${snapshot.id}/validations`,'POST',{clientRequestId:randomUUID(),baselineId:baseline.id,allowMockWrites:false,candidateId:candidate.id});evidence.validationId=started.id;
  const validation=await poll(`/api/validations/${started.id}`,['completed','failed','cancelled'],15*60_000,'VALIDATION');
  const report=await api(`/api/validations/${started.id}/report`);evidence.validation=report;assert.equal(validation.status,'completed');assert.equal(report.verdict,'passed',`VALIDATION_${report.verdict}`);
  const releaseStarted=await api(`/api/drafts/${draft.id}/releases`,'POST',{clientRequestId:randomUUID(),snapshotId:snapshot.id,validationId:started.id,expectedRevision:draft.revision});
  const release=await poll(`/api/releases/${releaseStarted.id}`,['succeeded','failed'],180_000,'RELEASE');evidence.release=release;assert.equal(release.status,'succeeded',`RELEASE_${release.diagnostic??release.status}`);
  const overview=await api(`/api/drafts/${draft.id}/releases`);const version=overview.versions.find(item=>item.operationId===release.id);assert.ok(version,'PUBLISHED_VERSION_MISSING');evidence.agentVersion=version.id;
  const grant=await api('/api/demo-sessions','POST',{agentId:draft.id,actorId:'U1001'});evidence.actorId=grant.actorId;
  let request=await business(`/agent-api/agents/${draft.id}/messages`,'POST',{clientRequestId:randomUUID(),input:'查询账户 A1001 的可用余额、币种和更新时间。'},grant);
  request=await pollBusiness(`/agent-api/requests/${request.requestId}`,grant);evidence.balanceRequest=request;
  assert.equal(request.run.status,'succeeded','BALANCE_APP_RUN_FAILED');assert.equal(request.agentVersion,version.id,'BALANCE_VERSION_MISMATCH');assert.equal(request.run.artifactDigest,candidate.artifactDigest,'BALANCE_ARTIFACT_MISMATCH');
  assert.ok(request.run.externalEvidence?.some(item=>item.operation==='getAccountBalance'&&item.status===200),'BALANCE_MOCK_EVIDENCE_MISSING');
  const conversationId=request.conversationId;
  let products=await business(`/agent-api/agents/${draft.id}/messages`,'POST',{clientRequestId:randomUUID(),conversationId,input:'请查询当前全部理财产品目录，列出产品编号、名称、状态和最低金额。'},grant);
  products=await pollBusiness(`/agent-api/requests/${products.requestId}`,grant);evidence.productsRequest=products;
  assert.equal(products.run.status,'succeeded','PRODUCTS_APP_RUN_FAILED');assert.equal(products.agentVersion,version.id,'PRODUCTS_VERSION_MISMATCH');assert.equal(products.run.artifactDigest,candidate.artifactDigest,'PRODUCTS_ARTIFACT_MISMATCH');
  assert.ok(products.run.externalEvidence?.some(item=>item.operation==='listWealthProducts'&&item.status===200),'PRODUCTS_MOCK_EVIDENCE_MISSING');
  const text=JSON.stringify(products.run.result);assert.ok(text.includes('SIM-W001')&&text.includes('SIM-W002'),'PRODUCT_DIRECTORY_RESULT_INCOMPLETE');
  evidence.branches={'app-balance':true,'app-products':true,'request-run-version':true};evidence.verdict='passed';
}catch(error){evidence.verdict='failed';evidence.error=error instanceof Error?error.stack??error.message:String(error);process.exitCode=1;}
finally{evidence.finishedAt=new Date().toISOString();try{evidence.finalTargetImageIds=imageIds();}catch{evidence.finalTargetImageIds=null;}if(cookie&&csrf)await fetch(`${base}/api/auth/session`,{method:'DELETE',headers:{origin,cookie,'x-csrf-token':csrf}}).catch(()=>{});await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({verdict:evidence.verdict,evidencePath,draftId:evidence.draftId,validationId:evidence.validationId}));}
