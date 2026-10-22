import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {workOrderHarness} from '../support/workorder-harness.js';
let harness:Awaited<ReturnType<typeof workOrderHarness>>;
const model=createServer(async(req,res)=>{
  let body='';for await(const bytes of req)body+=bytes;const request=JSON.parse(body) as {messages:{role:string;content?:unknown;tool_call_id?:string}[]};
  const user=JSON.stringify(request.messages.find(m=>m.role==='user')?.content),read=request.messages.find(m=>m.role==='tool'&&m.tool_call_id==='read'),written=request.messages.find(m=>m.role==='tool'&&m.tool_call_id==='write');
  const workorder=user.includes('工单'),missing=!user.includes('PUMP-001'),failed=read&&!JSON.stringify(read.content).includes('86');
  const complete=missing||failed||Boolean(written)||Boolean(read&&!workorder);
  const result=missing?{kind:'clarification',missingFields:['equipmentId'],message:'请提供设备编号'}:failed?{kind:'tool-error',code:'TOOL_UNAVAILABLE',message:'工具超时，设备状态未知'}:written?{message:'已返回实际工单结果',result:written.content}:{kind:'equipment-report',equipmentId:'PUMP-001',status:'warning',temperatureCelsius:86,source:'seed-equipment-001@1',recommendation:'检查温度告警'};
  const message=complete?{role:'assistant',content:JSON.stringify(result)}:{role:'assistant',content:read?'设备温度 86°C，状态 warning，来源 seed-equipment-001@1，建议检查后创建工单。':'正在查询',tool_calls:[{id:read?'write':'read',type:'function',function:{name:read?'create_work_order':'get_equipment',arguments:JSON.stringify(read?{equipmentId:'PUMP-001',description:'检查温度告警',priority:'normal'}:{equipmentId:'PUMP-001'})}}]};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'workorder-fixture',model:'fixture',choices:[{index:0,message,finish_reason:complete?'stop':'tool_calls'}]}));
});
beforeAll(async()=>{await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));const address=model.address();if(!address||typeof address==='string')throw new Error('MODEL_PORT');harness=await workOrderHarness({modelKey:'fixture',modelBase:`http://127.0.0.1:${address.port}/v1`});});
afterAll(async()=>{await harness?.close();await new Promise<void>(done=>model.close(()=>done()));});
for(const fixedCandidate of [false,true])it(`all eight workorder cases execute with actual gates and external state (${fixedCandidate?'candidate HTTP':'snapshot'})`,async()=>{
  const target=await harness.target(fixedCandidate),deadline=Date.now()+180_000;let accelerated=false;
  while(Date.now()<deadline){
    const execution=await harness.validations.get(target.validation.id);if(execution.status==='completed')break;
    const expired=execution.cases.find(c=>c.caseId==='TC-006');
    if(!accelerated&&expired?.beforeApprovalCalls){harness.advanceActionClock(300_001);accelerated=true;}
    await harness.pump();await new Promise(r=>setTimeout(r,100));
  }
  const report=await harness.validations.report(target.validation.id),proof=await Promise.all(report.cases.map(c=>c.evidenceId?harness.validations.evidence(report.executionId,c.evidenceId):null));
  await writeFile(join(harness.root,`${fixedCandidate?'candidate':'snapshot'}.json`),JSON.stringify({scope:'Real JVM, HTTP and PostgreSQL; deterministic model; test-only action clock advancement for expiry',target,report,proof,ingress:harness.ingress},null,2));
  expect(report.cases.map(c=>({id:c.caseId,status:c.status})),JSON.stringify(report.cases)).toEqual(Array.from({length:8},(_,i)=>({id:`TC-00${i+1}`,status:'passed'})));
  expect(report.verdict).toBe('unverified');expect(report.reasons).toEqual(['REAL_MODEL_REQUIRED']);
  expect(proof[6]!.actions[0]!.status).toBe('invalidated');expect(proof[6]!.calls.filter(c=>c.operation==='work-order-create')).toHaveLength(0);
  if(fixedCandidate){expect(harness.ingress.some(e=>e.path.startsWith('/test-api/')&&e.path.endsWith('/decision'))).toBe(true);expect(proof.every(p=>p!.candidateEvidence?.testDeployment.status==='stopped')).toBe(true);}
},210_000);
