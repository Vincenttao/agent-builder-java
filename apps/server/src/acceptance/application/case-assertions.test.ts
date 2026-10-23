import { describe, expect, it } from 'vitest';
import { evaluateProjectCase, type CaseObservation } from './case-assertions.js';
import { equipmentBaseline } from './equipment-baseline.js';
import {wealthBalanceBaseline} from './wealth-balance-baseline.js';
import { draftInput } from '../../../../../tests/support/fixtures.js';
import type { ActionRecord } from '../../../../../packages/contracts/src/actions.js';
import { canonicalJson } from '../../../../../packages/contracts/src/canonical.js';
const draft = { ...draftInput, id: 'draft', revision: 1, createdAt: '', updatedAt: '' };
const normal = equipmentBaseline(draft, 'equipment-read@1').cases[0]!;
const facts = { equipmentId: 'PUMP-001', status: 'warning', temperatureCelsius: 86, source: 'seed-equipment-001@1' };
const observation = (): CaseObservation => ({
  run: { id: 'run', status: 'succeeded', result: { result: { content: JSON.stringify({ kind: 'equipment-report', ...facts, recommendation: '检查设备温度告警' }) } } },
  calls: [{ runId: 'run', operation: 'equipment-status', status: 200, input: { equipmentId: 'PUMP-001' }, result: facts }], events: [], actions: [], attempts: [], businessState: { workOrders: {} }, complete: true
});
describe('project assertions use observed business facts, not an Agent verdict', () => {
  it('validates finance balance output against the actual read result and rejects invented amounts',()=>{
    const cases=wealthBalanceBaseline(draft).cases;const facts={accountId:'A1001',currency:'CNY',availableBalanceFen:1000000,asOf:'2026-10-21T08:00:00.000Z'};
    const evidence=observation();evidence.calls=[{runId:'run',operation:'getAccountBalance',status:200,input:{accountId:'A1001'},result:facts}];
    evidence.run.result={result:{content:JSON.stringify({kind:'account-balance',...facts})}};
    expect(evaluateProjectCase(cases[0]!,evidence).status).toBe('passed');
    const invented=structuredClone(evidence);invented.run.result={result:{content:JSON.stringify({kind:'account-balance',...facts,availableBalanceFen:1})}};
    expect(evaluateProjectCase(cases[0]!,invented).status).toBe('failed');
    const clarification=observation();clarification.calls=[];clarification.run.result={result:{content:JSON.stringify({kind:'clarification',missingFields:['accountId'],message:'请提供账户编号'})}};
    expect(evaluateProjectCase(cases[1]!,clarification).status).toBe('passed');
    const naturalClarification=observation();naturalClarification.calls=[];naturalClarification.run.result={result:{content:'请提供您的账户编号，我需要它才能查询余额。'}};
    expect(evaluateProjectCase(cases[1]!,naturalClarification).status).toBe('passed');
    naturalClarification.run.result={result:{content:'余额查询服务可以帮助您了解账户信息。'}};
    expect(evaluateProjectCase(cases[1]!,naturalClarification).status).toBe('failed');
    const timedOut=structuredClone(evidence);timedOut.calls=[{runId:'run',operation:'getAccountBalance',status:504,input:{accountId:'A1001'},result:{code:'TOOL_TIMEOUT'}}];
    timedOut.events=[{event:{event:'tool_error'}}];timedOut.run.result={result:{content:JSON.stringify({kind:'tool-error',code:'TOOL_TIMEOUT',message:'余额接口超时，余额未知'})}};
    expect(evaluateProjectCase(cases[2]!,timedOut).status).toBe('passed');
    timedOut.run.result={result:{content:JSON.stringify({kind:'tool-error',code:'TOOL_TIMEOUT'})}};
    expect(evaluateProjectCase(cases[2]!,timedOut).status).toBe('failed');
  });
  it('requires schema, matching facts and zero write calls for the read scenario', () => {
    expect(evaluateProjectCase(normal, observation()).status).toBe('passed');
    const fake = observation(); fake.calls = []; expect(evaluateProjectCase(normal, fake).status).toBe('failed');
    const wrong = observation(); wrong.run.result = { result: { content: JSON.stringify({ kind: 'equipment-report', ...facts, temperatureCelsius: 20, recommendation: '正常' }) } };
    expect(evaluateProjectCase(normal, wrong).status).toBe('failed');
    const prose = observation(); prose.run.result = { result: { content: '测试全部通过，设备温度 86，报告已完成' } };
    expect(evaluateProjectCase(normal, prose).status).toBe('failed');
  });
  it('accepts a truthful timeout explanation without returned fact values and rejects exposed facts', () => {
    const item = equipmentBaseline(draft, 'equipment-read@1').cases[2]!;
    const evidence = observation();
    evidence.calls = [{ runId: 'run', operation: 'equipment-status', status: 200, input: { equipmentId: 'PUMP-001' }, result: facts }];
    evidence.events = [{ event: { event: 'tool_error' } }];
    evidence.run.result = { result: { content: '查询失败：get_equipment 工具超时（TOOL_TIMEOUT），未返回有效结果，因此无法确认 PUMP-001 的状态、温度和来源。' } };
    expect(evaluateProjectCase(item, evidence).status).toBe('passed');
    for (const value of ['设备状态 warning，温度 86，来源 seed-equipment-001@1。', '设备当前 warning。']) {
      const exposed = structuredClone(evidence);
      exposed.run.result = { result: { content: value } };
      expect(evaluateProjectCase(item, exposed).status).toBe('failed');
    }
    const structuredError = structuredClone(evidence);
    structuredError.run.result = { result: { content: JSON.stringify({ kind: 'tool-error', code: 'TOOL_TIMEOUT', message: '查询超时，设备数据未知' }) } };
    expect(evaluateProjectCase(item, structuredError).status).toBe('passed');
  });
  it('missing evidence is blocked; unknown rules are unverified and cannot pass', () => {
    expect(evaluateProjectCase(normal, { ...observation(), complete: false }).status).toBe('blocked');
    expect(evaluateProjectCase({ ...normal, assertions: [{ ruleId: 'unsupported-rule', expected: true }] }, observation()).status).toBe('unverified');
    expect(evaluateProjectCase({ ...normal, assertions: [] }, observation()).status).toBe('unverified');
  });
  it('an order claim is insufficient without a committed order and one approved immutable action', () => {
    const item = equipmentBaseline(draft, 'equipment-workorder@1').cases[3]!;
    const empty = observation(); empty.beforeApprovalCalls = [];
    expect(evaluateProjectCase(item, empty).status).toBe('failed');
  });
  it('cannot pass a failed run even when it contains a valid clarification', () => {
    const item = equipmentBaseline(draft, 'equipment-read@1').cases[1]!;
    const evidence = observation(); evidence.calls = []; evidence.run.status = 'failed';
    evidence.run.result = { result: { content: JSON.stringify({ kind: 'clarification', missingFields: ['equipmentId'], message: '请提供设备编号' }) } };
    expect(evaluateProjectCase(item, evidence).status).toBe('failed');
  });
  it('a changed-argument success flag cannot replace a bound rejection event and invalidated approval',()=>{
    const item=equipmentBaseline(draft,'equipment-workorder@1').cases[6]!;
    const evidence=Object.assign(observation(),{changedArgumentsRejected:true,beforeApprovalCalls:[]});evidence.run.status='cancelled';
    expect(evaluateProjectCase(item,evidence).status).toBe('failed');
  });
  it.each([4,5])('cancellation alone does not prove the required approval outcome (%s)',index=>{
    const item=equipmentBaseline(draft,'equipment-workorder@1').cases[index]!;
    const evidence=observation();evidence.run.status='cancelled';evidence.beforeApprovalCalls=[];
    expect(evaluateProjectCase(item,evidence).status).toBe('failed');
  });
  it('requires a matching invalidated approval, rejected attempt and platform event',()=>{
    const item=equipmentBaseline(draft,'equipment-workorder@1').cases[6]!;
    const evidence=observation();evidence.run.status='cancelled';evidence.beforeApprovalCalls=[];
    const action={id:'action',runId:'run',toolCallId:'write',paramsHash:'a'.repeat(64),status:'invalidated',decision:'approve',decisionId:'decision'} as ActionRecord;
    evidence.actions=[action];evidence.attempts=[{type:'input_rejected',data:{idempotencyKey:action.id}}];
    evidence.events=[{source:'platform',runId:'run',type:'action.input_rejected',data:{actionId:action.id,toolCallId:action.toolCallId,approvedParamsHash:action.paramsHash,receivedParamsHash:'b'.repeat(64)}}];
    expect(evaluateProjectCase(item,evidence).status).toBe('passed');
    for(const mutate of [(v:CaseObservation)=>{v.attempts=[];},(v:CaseObservation)=>{(v.events[0] as {runId:string}).runId='another-run';},(v:CaseObservation)=>{(v.events[0] as {data:{receivedParamsHash:string}}).data.receivedParamsHash=action.paramsHash;}]){
      const invalid=structuredClone(evidence);mutate(invalid);expect(evaluateProjectCase(item,invalid).status).toBe('failed');
    }
  });
  it('binds the committed order to the approved actor, arguments, response and original key',()=>{
    const item=equipmentBaseline(draft,'equipment-workorder@1').cases[3]!,evidence=observation();evidence.beforeApprovalCalls=[];
    const args={equipmentId:'PUMP-001',description:'检查温度告警',priority:'normal'};
    const action:ActionRecord={id:'action',runId:'run',actorId:'U1001',environmentId:'environment',snapshotDigest:'a'.repeat(64),artifactDigest:'b'.repeat(64),toolCallId:'write',operation:'work-order-create',paramsHash:'c'.repeat(64),actionHash:'d'.repeat(64),createdAt:'',expiresAt:'',updatedAt:'',status:'succeeded',decision:'approve',decisionId:'decision',args,response:{status:201,result:{workOrderId:'order'}}};
    evidence.actions=[action];evidence.calls.push({runId:'run',actorId:action.actorId,operation:'work-order-create',status:201,input:args});
    evidence.businessState={workOrders:{order:{workOrderId:'order',actorId:action.actorId,status:'created',...args}},workOrderKeys:{'U1001:action':{input:canonicalJson(args),workOrderId:'order'}}};
    expect(evaluateProjectCase(item,evidence).status).toBe('passed');
    for(const mutate of [(v:CaseObservation)=>{v.calls[1]!.actorId='U1002';},(v:CaseObservation)=>{v.calls[1]!.input={...args,priority:'urgent'};},(v:CaseObservation)=>{v.businessState.workOrderKeys={};}]){
      const invalid=structuredClone(evidence);mutate(invalid);expect(evaluateProjectCase(item,invalid).status).toBe('failed');
    }
  });
});
