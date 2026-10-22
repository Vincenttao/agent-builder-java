import { describe, expect, it } from 'vitest';
import { evaluateProjectCase, type CaseObservation } from './case-assertions.js';
import { equipmentBaseline } from './equipment-baseline.js';
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
  it('requires schema, matching facts and zero write calls for the read scenario', () => {
    expect(evaluateProjectCase(normal, observation()).status).toBe('passed');
    const fake = observation(); fake.calls = []; expect(evaluateProjectCase(normal, fake).status).toBe('failed');
    const wrong = observation(); wrong.run.result = { result: { content: JSON.stringify({ kind: 'equipment-report', ...facts, temperatureCelsius: 20, recommendation: '正常' }) } };
    expect(evaluateProjectCase(normal, wrong).status).toBe('failed');
    const prose = observation(); prose.run.result = { result: { content: '测试全部通过，设备温度 86，报告已完成' } };
    expect(evaluateProjectCase(normal, prose).status).toBe('failed');
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
