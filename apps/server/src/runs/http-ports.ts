import type { RuntimeSpec } from '../../../../packages/contracts/src/index.js';
import type { MockControl, RunRuntime, RuntimeExecution } from './run-service.js';
import type { ToolContext } from './tool-proxy.js';
import type { WriteContext, WritePort } from '../actions/action-service.js';
import type { RunEnvironment } from '../../../../packages/contracts/src/runs.js';
import type { RuntimeModelProfile } from '../../../../packages/contracts/src/model-profile.js';
import type {MockScenePackage} from '../../../../packages/contracts/src/mock-scene.js';
import {mockBusinessPath,mockBusinessReadRoutes} from '../../../mock-services/src/scene.js';
export class DependencyError extends Error { constructor(public status: number, public code: string) { super(code); } }
const dependencyCodes=new Set(['EXECUTION_CLAIM_LOST','EXECUTION_RETIRED','RUN_RESERVATION_RETIRED','DEPLOYMENT_RETIRED','DEPLOYMENT_HAS_ACTIVE_EXECUTIONS','EXECUTION_REQUIRES_RECONCILIATION','JVM_START_FAILED','MODEL_NOT_CONFIGURED','ARTIFACT_MISMATCH']);
export class HttpPort {
  constructor(private readonly base: string, private readonly token: string, private readonly timeoutMs = 10000,private readonly extraCodes:readonly string[]=[]) {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || token.length < 24) throw new Error('Invalid service connection');
  }
  async request<T>(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, timeoutMs = this.timeoutMs): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.base.replace(/\/$/, '') + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      throw new DependencyError(503, error instanceof Error && error.name === 'TimeoutError' ? 'DEPENDENCY_TIMEOUT' : 'DEPENDENCY_UNAVAILABLE');
    }
    if (!response.ok) {const error=await response.json().catch(()=>null) as {code?:unknown}|null;throw new DependencyError(response.status,typeof error?.code==='string'&&(dependencyCodes.has(error.code)||this.extraCodes.includes(error.code))?error.code:'DEPENDENCY_REQUEST_FAILED');}
    return await response.json() as T;
  }
}
export class HttpRunner implements RunRuntime {
  private readonly port: HttpPort;
  constructor(base: string, token: string) { this.port = new HttpPort(base, token, 75000); }
  capabilities(): ReturnType<RunRuntime['capabilities']> { return this.port.request('/capabilities', 'GET', undefined, {}, 3000); }
  artifact(digest:string):ReturnType<NonNullable<RunRuntime['artifact']>>{return this.port.request(`/artifacts/${encodeURIComponent(digest)}`);}
  packageGenerated(id:string,input:{bundleDigest:string;specDigest:string}):ReturnType<NonNullable<RunRuntime['packageGenerated']>>{return this.port.request(`/engineering/tasks/${encodeURIComponent(id)}/artifact`,'POST',input);}
  deploy(id: string, artifactDigest: string, spec: RuntimeSpec): Promise<{ status: string }> { return this.port.request(`/deployments/${encodeURIComponent(id)}`, 'PUT', { artifactDigest, spec }); }
  deployment(id:string):Promise<{status:string;artifactDigest:string;specDigest:string;modelProfile?:RuntimeModelProfile}> { return this.port.request(`/deployments/${encodeURIComponent(id)}`); }
  retire(id:string):Promise<{status:string}> { return this.port.request(`/deployments/${encodeURIComponent(id)}/retire`,'POST',{}); }
  claim(id:string,fencingToken:string):Promise<unknown>{return this.port.request(`/executions/${encodeURIComponent(id)}/claim`,'POST',{fencingToken});}
  begin(id: string, request: { deploymentId: string; sessionId: string; message: string },fencingToken:string): Promise<RuntimeExecution> { return this.port.request(`/executions/${encodeURIComponent(id)}`, 'PUT', {...request,fencingToken}); }
  async execution(id: string): Promise<RuntimeExecution | null> { try { return await this.port.request(`/executions/${encodeURIComponent(id)}`); } catch (error) { if (error instanceof DependencyError && error.status === 404) return null; throw error; } }
  cancel(id: string,fencingToken:string): Promise<RuntimeExecution> { return this.port.request(`/executions/${encodeURIComponent(id)}/cancel`, 'POST', {fencingToken}); }
  resume(id: string, resumeId: string, toolCallId: string, approved: boolean,fencingToken:string): Promise<RuntimeExecution> { return this.port.request(`/executions/${encodeURIComponent(id)}/resume`, 'POST', { resumeId, toolCallId, approved,fencingToken }); }
  async events(id: string) { return (await this.port.request<{ items: unknown[] }>(`/deployments/${encodeURIComponent(id)}/events`)).items; }
  stop(id: string): Promise<{ status: string }> { return this.port.request(`/deployments/${encodeURIComponent(id)}/stop`, 'POST', {}); }
}
export class HttpMock implements MockControl, WritePort {
  private readonly control: HttpPort;
  private readonly businessToken: string;
  constructor(private readonly base: string, controlToken: string, businessToken: string) { this.control = new HttpPort(base, controlToken); this.businessToken = businessToken; }
  async ready() { return (await this.control.request<{ status: string }>('/health/ready')).status === 'ready'; }
  async identity() { return this.control.request<{ implementationDigest: string }>('/control/manifest'); }
  async scene():Promise<MockScenePackage>{return this.control.request('/control/project-scene');}
  async inspect(environmentId: string) { return this.control.request<{ id: string; revision: number; config: RunEnvironment; state: Record<string, unknown> }>(`/control/environments/${encodeURIComponent(environmentId)}`); }
  async prepare(environmentId: string, runId: string, config: RunEnvironment = { seed: 'enterprise-default@1', fault: 'normal', clock: '2026-10-21T08:00:00.000Z' }) {
    const path = `/control/environments/${encodeURIComponent(environmentId)}`;
    await this.control.request(path, 'PUT', config);
    await this.control.request(`${path}/reserve`, 'POST', { runId });
  }
  async release(environmentId: string, runId: string) { await this.control.request(`/control/environments/${encodeURIComponent(environmentId)}/release`, 'POST', { runId }); }
  async calls(environmentId: string, runId: string) {
    const all: unknown[] = []; let after = 0;
    for (let page = 0; page < 20; page++) {
      const response = await this.control.request<{ items: Array<{ seq: number }> }>(`/control/environments/${encodeURIComponent(environmentId)}/calls?runId=${encodeURIComponent(runId)}&after=${after}`);
      all.push(...response.items); if (response.items.length < 1000) return all; after = response.items.at(-1)!.seq;
    }
    throw new Error('EVIDENCE_LIMIT_REACHED');
  }
  async mcp(context: ToolContext | undefined, request: Record<string, unknown>) {
    const response = await fetch(`${this.base.replace(/\/$/, '')}/mcp`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: {
      authorization: `Bearer ${this.businessToken}`, 'content-type': 'application/json',
      ...(context ? { 'x-environment-id': context.environmentId, 'x-run-id': context.runId, 'x-actor-id': context.actorId } : {})
    }, body: JSON.stringify(request) });
    if (response.status === 202) return { status: 202, result: null };
    const result = await response.json().catch(() => null);
    return { status: response.status, result };
  }
  async invoke(context: ToolContext, operation: string, input: Record<string, unknown>) {
    const contract=mockBusinessReadRoutes.find(route=>route.operationId===operation);
    if(!contract)throw new Error('OPERATION_NOT_ALLOWED');
    if(!context.operations.includes(operation))throw new Error('OPERATION_NOT_BOUND');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!==[...contract.requestFields].sort().join(','))throw new Error('INVALID_TOOL_ARGUMENTS');
    for(const field of contract.requestFields){const value=input[field];if(typeof value!=='string'||!value.trim()||value.length>200)throw new Error('INVALID_TOOL_ARGUMENTS');}
    const path = contract.path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g,(_match,field:string)=>encodeURIComponent(input[field] as string));
    const response = await fetch(`${this.base.replace(/\/$/, '')}${path}`, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: {
      authorization: `Bearer ${this.businessToken}`, 'x-environment-id': context.environmentId, 'x-run-id': context.runId, 'x-actor-id': context.actorId
    } });
    return { status: response.status, result: await response.json() as unknown };
  }
  async write(context: WriteContext, operation: string, args: Record<string, unknown>, key: string) {
    if (operation !== 'work-order-create') throw new Error('OPERATION_NOT_ALLOWED');
    const response = await fetch(`${this.base.replace(/\/$/, '')}/mock-business/v1/work-orders`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(2000), headers: {
      authorization: `Bearer ${this.businessToken}`, 'content-type': 'application/json', 'x-environment-id': context.environmentId, 'x-run-id': context.runId, 'x-actor-id': context.actorId, 'idempotency-key': key
    }, body: JSON.stringify(args) });
    return { status: response.status, result: await response.json() as unknown };
  }
  async lookup(context: WriteContext, operation: string, key: string) {
    if (operation !== 'work-order-create') throw new Error('OPERATION_NOT_ALLOWED');
    const response = await fetch(`${this.base.replace(/\/$/, '')}/mock-business/v1/work-orders/by-key/${encodeURIComponent(key)}`, { redirect: 'error', signal: AbortSignal.timeout(2000), headers: {
      authorization: `Bearer ${this.businessToken}`, 'x-environment-id': context.environmentId, 'x-run-id': context.runId, 'x-actor-id': context.actorId
    } });
    if (response.status === 404) return null; if (!response.ok) throw new Error('LOOKUP_UNAVAILABLE'); return await response.json() as unknown;
  }
}
