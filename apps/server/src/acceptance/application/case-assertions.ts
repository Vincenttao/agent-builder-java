import type { BusinessCase } from '../../../../../packages/contracts/src/baselines.js';
import type { AssertionResult, ValidationVerdict } from '../../../../../packages/contracts/src/validations.js';
import type { ActionRecord } from '../../../../../packages/contracts/src/actions.js';
import { canonicalJson } from '../../../../../packages/contracts/src/canonical.js';
import type {ValidationCandidate} from '../../../../../packages/contracts/src/validations.js';
import type {TestDeployment} from '../../../../../packages/contracts/src/candidates.js';
export interface CaseObservation {
  run: { id: string; status: string; result?: unknown }; calls: Record<string, unknown>[]; events: unknown[];
  actions: ActionRecord[]; attempts: { type: string;data?:unknown }[]; businessState: Record<string, unknown>; complete: boolean;
  beforeApprovalCalls?: unknown[];
  candidateEvidence?:{ingress:string;requestId:string;candidate:ValidationCandidate;testDeployment:TestDeployment;loadedManifest:unknown;completionChecks?:Record<string,boolean>};
}
export const combineVerdicts = (values: ValidationVerdict[]): ValidationVerdict => values.includes('failed') ? 'failed' : values.includes('blocked') ? 'blocked' : !values.length || values.includes('unverified') ? 'unverified' : 'passed';
function output(value: unknown): Record<string, unknown> | null {
  const text = rawOutput(value);
  if (typeof text !== 'string') return null;
  try {
    // Accept a single fenced JSON block, never extract a convenient substring from arbitrary prose.
    const source = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, '$1');
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function rawOutput(value: unknown): unknown { return (value as { result?: { content?: unknown } } | null)?.result?.content; }
function failureOutputHasNoFacts(evidence: CaseObservation, answer: Record<string, unknown> | null): boolean {
  const content = rawOutput(evidence.run.result);
  if (typeof content !== 'string' || !content.trim()) return false;
  if (answer) {
    const factFields = ['status', 'temperatureCelsius', 'source', 'currency', 'availableBalanceFen', 'asOf'];
    if (factFields.some(field => Object.hasOwn(answer, field))) return false;
    if (answer.kind === 'tool-error') {
      return ['TOOL_UNAVAILABLE', 'TOOL_TIMEOUT'].includes(String(answer.code))
        && typeof answer.message === 'string' && answer.message.trim().length > 0
        && Object.keys(answer).every(key => ['kind', 'code', 'message'].includes(key));
    }
  }
  const fields = ['status', 'temperatureCelsius', 'source', 'currency', 'availableBalanceFen', 'asOf'];
  const operations = new Set(['equipment-status', 'getAccountBalance']);
  const facts = evidence.calls.filter(call => operations.has(String(call.operation)))
    .flatMap(call => {
      const result = call.result;
      return result && typeof result === 'object' && !Array.isArray(result)
        ? fields.flatMap(field => {
          const value = (result as Record<string, unknown>)[field];
          if (typeof value !== 'string' && typeof value !== 'number') return [];
          const rendered = String(value).trim();
          return rendered ? [rendered] : [];
        }) : [];
    });
  return facts.every(fact => {
    const escaped = fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = /^\d+$/.test(fact) ? `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])` : escaped;
    return !new RegExp(pattern, 'i').test(content);
  });
}
export function evaluateProjectCase(item: BusinessCase, evidence: CaseObservation) {
  if (!evidence.complete || evidence.calls.some(call => call.runId !== evidence.run.id || typeof call.operation !== 'string' || typeof call.status !== 'number')) return { caseId: item.id, status: 'blocked' as const, assertions: [], reasons: ['EVIDENCE_INCOMPLETE'] };
  const answer = output(evidence.run.result); const writes = evidence.calls.filter(c => ['work-order-create','createMockSubscription'].includes(String(c.operation)));
  const observed = evidence.calls.filter(c => c.operation === 'equipment-status' && c.status === 200);
  const orders = evidence.businessState.workOrders;
  const rules: Record<string, () => unknown> = {
    'run-status': () => evidence.run.status,
    'run-succeeded': () => evidence.run.status === 'succeeded',
    'equipment-report-schema': () => answer?.kind === 'equipment-report' && Object.keys(answer).every(k => ['kind','equipmentId','status','temperatureCelsius','source','recommendation'].includes(k)) && ['equipmentId','status','source','recommendation'].every(k => typeof answer[k] === 'string' && String(answer[k]).trim()) && Number.isSafeInteger(answer.temperatureCelsius) ? 'equipment-report@1' : null,
    'equipment-facts': () => {
      if (observed.length !== 1 || !answer) return null;
      const result = observed[0]!.result as Record<string, unknown> | null;
      if (!result || !['equipmentId','status','temperatureCelsius','source'].every(k => answer[k] === result[k])) return null;
      return Object.fromEntries(['equipmentId','status','temperatureCelsius','source'].map(k => [k, answer[k]]));
    },
    'balance-report-schema': () => answer?.kind === 'account-balance' && Object.keys(answer).every(k => ['kind','accountId','currency','availableBalanceFen','asOf'].includes(k))
      && typeof answer.accountId === 'string' && typeof answer.currency === 'string' && Number.isSafeInteger(answer.availableBalanceFen)
      && typeof answer.asOf === 'string' && !Number.isNaN(Date.parse(answer.asOf)) ? 'account-balance@1' : null,
    'balance-facts': () => {
      const reads = evidence.calls.filter(c => c.operation === 'getAccountBalance' && c.status === 200);
      if (reads.length !== 1 || !answer) return null;
      const result = reads[0]!.result as Record<string, unknown> | null;
      if (!result || !['accountId','currency','availableBalanceFen','asOf'].every(k => answer[k] === result[k])) return null;
      return Object.fromEntries(['accountId','currency','availableBalanceFen','asOf'].map(k => [k, answer[k]]));
    },
    'write-call-count': () => writes.length,
    'all-business-call-count': () => evidence.calls.length,
    'asks-for-equipment-id': () => answer?.kind === 'clarification' && Array.isArray(answer.missingFields) && answer.missingFields.includes('equipmentId') && typeof answer.message === 'string' && answer.message.trim().length > 0,
    'asks-for-account-id': () => {
      const content=(evidence.run.result as {result?:{content?:unknown}}|undefined)?.result?.content;
      const structured=answer?.kind==='clarification'&&Array.isArray(answer.missingFields)&&answer.missingFields.includes('accountId')&&typeof answer.message==='string'&&answer.message.trim().length>0;
      const natural=typeof content==='string'&&/账户(?:编号|号)/.test(content)&&/(请提供|请告诉|请告知|需要您提供)/.test(content);
      return structured||natural;
    },
    'tool-error-evidence': () => evidence.events.some(value => { const item = value as { data?: { event?: { event?: string } }; event?: { event?: string } }; return (item.data?.event ?? item.event)?.event === 'tool_error'; }),
    'failure-output-no-facts': () => failureOutputHasNoFacts(evidence, answer),
    'before-approval-write-count': () => evidence.beforeApprovalCalls?.filter(call => (call as { operation?: string }).operation === 'work-order-create').length ?? null,
    'workorder-state-count': () => orders && typeof orders === 'object' && !Array.isArray(orders) ? Object.keys(orders).length : orders === undefined ? 0 : null,
    'effective-decision-count': () => new Set(evidence.actions.filter(action => action.decision === 'approve' && action.decisionId).map(action => action.decisionId)).size,
    'action-outcome':()=>evidence.actions.length===1&&evidence.actions[0]!.runId===evidence.run.id?evidence.actions[0]!.status:null,
    'workorder-write-binding':()=>{
      if(evidence.actions.length!==1||writes.length!==1||!orders||typeof orders!=='object')return false;
      const action=evidence.actions[0]!,write=writes[0]!,key=(evidence.businessState.workOrderKeys as Record<string,{input:string;workOrderId:string}>|undefined)?.[`${action.actorId}:${action.id}`];
      const order=key?(orders as Record<string,Record<string,unknown>>)[key.workOrderId]:undefined;
      return action.runId===evidence.run.id&&action.status==='succeeded'&&action.decision==='approve'&&write.actorId===action.actorId&&canonicalJson(write.input)===canonicalJson(action.args)
        &&Boolean(order&&key?.input===canonicalJson(action.args)&&order.actorId===action.actorId&&order.status==='created'&&['equipmentId','description','priority'].every(k=>order[k]===action.args[k])
          &&(action.response?.result as {workOrderId?:string}|undefined)?.workOrderId===order.workOrderId);
    },
    'retained-analysis': () => JSON.stringify(evidence.run.result ?? null).includes('86') && observed.length >= 1,
    'original-key-reconciliation': () => evidence.attempts.some(attempt => attempt.type === 'reconcile_found') && evidence.calls.some(call => call.operation === 'work-order-by-key' && evidence.actions.some(action => (call.input as { key?: string } | null)?.key === action.id)),
    'changed-arguments-rejected': () => evidence.actions.length===1&&evidence.actions.every(action=>action.runId===evidence.run.id&&action.status==='invalidated'&&action.decision==='approve'&&Boolean(action.decisionId)
      &&evidence.attempts.some(attempt=>attempt.type==='input_rejected'&&(attempt.data as {idempotencyKey?:string}|undefined)?.idempotencyKey===action.id)
      &&evidence.events.some(value=>{const event=value as {runId?:string;source?:string;type?:string;data?:Record<string,unknown>};return event.source==='platform'&&event.runId===evidence.run.id&&event.type==='action.input_rejected'
        &&event.data?.actionId===action.id&&event.data.toolCallId===action.toolCallId&&event.data.approvedParamsHash===action.paramsHash&&typeof event.data.receivedParamsHash==='string'
        &&/^[a-f0-9]{64}$/.test(event.data.receivedParamsHash)&&event.data.receivedParamsHash!==action.paramsHash;}))
  };
  const assertions: AssertionResult[] = item.assertions.map(rule => {
    if (!rules[rule.ruleId]) return { ...rule, status: 'unverified', actual: null };
    const actual = rules[rule.ruleId]!() ?? null;
    return { ...rule, actual, status: canonicalJson(actual) === canonicalJson(rule.expected) ? 'passed' : 'failed' };
  });
  return { caseId: item.id, status: combineVerdicts(assertions.map(a => a.status)), assertions, reasons: assertions.length ? [] : ['ASSERTIONS_MISSING'] };
}
