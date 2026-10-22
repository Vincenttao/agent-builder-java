import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '../../../../packages/contracts/src/canonical.js';
import { RunnerError } from '../runtime/deployment-manager.js';
import {ExecutionFence} from './fence.js';

export interface ExecutionRuntime {
  query(deploymentId: string, sessionId: string, message: string): Promise<unknown>;
  resume?(deploymentId: string, sessionId: string, toolCallId: string, approved: boolean): Promise<unknown>;
  events(deploymentId: string): Promise<unknown[]>;
  stop(deploymentId: string): Promise<unknown>;
  cancelSession(deploymentId: string, sessionId: string): Promise<{ status: 'cancelling' | 'cancelled' }>;
}
export interface ExecutionRequest { deploymentId: string; sessionId: string; message: string }
export interface ResumeRequest { resumeId: string; toolCallId: string; approved: boolean }
export interface ExecutionRecord {
  id: string; deploymentId: string; sessionId: string; inputDigest: string;
  status: 'running' | 'waiting_confirmation' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'interrupted';
  createdAt: string; updatedAt: string; result?: unknown; events: unknown[]; error?: string;
  resumes?: Record<string, ResumeRequest>;
}
interface Entry { record: ExecutionRecord; saving: Promise<void>; work?: Promise<void> }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Durable admission before work; a disconnected caller can poll/retry the same execution key. */
export class ExecutionJournal {
  private entries = new Map<string, Entry>();
  private queues = new Map<string, Promise<void>>();
  private readonly fence:ExecutionFence;
  constructor(private readonly root: string, private readonly runtime: ExecutionRuntime) {this.fence=new ExecutionFence(join(root,'claims'));}
  async initialize() {
    await mkdir(this.root, { recursive: true });
    await this.fence.initialize();
    for (const name of await readdir(this.root)) {
      if (!name.endsWith('.json') || !uuid.test(name.slice(0, -5))) continue;
      const record = JSON.parse(await readFile(join(this.root, name), 'utf8')) as ExecutionRecord;
      if (`${record.id}.json` !== name) throw new RunnerError('EXECUTION_STATE_CORRUPT', 503);
      const interrupted = ['running', 'waiting_confirmation', 'cancelling'].includes(record.status);
      if (interrupted) {
        record.status = 'interrupted'; record.error = 'RUNNER_RESTART_REQUIRES_RECONCILIATION';
      }
      const entry = { record, saving: Promise.resolve() }; this.entries.set(record.id, entry);
      if (interrupted) await this.persist(entry);
    }
  }
  private persist(entry: Entry) {
    entry.record.updatedAt = new Date().toISOString();
    entry.saving = entry.saving.then(async () => {
      const file = join(this.root, `${entry.record.id}.json`); const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(entry.record)); await rename(temporary, file);
    });
    return entry.saving;
  }
  async claim(id:string,token:string){return this.fence.claim(id,token);}
  async begin(id:string,request:ExecutionRequest,token?:string){return this.fence.command(id,token,'start',()=>this.beginOwned(id,request));}
  private async beginOwned(id: string, request: ExecutionRequest) {
    if (!uuid.test(id) || !uuid.test(request.deploymentId) || !uuid.test(request.sessionId) || !request.message.trim() || request.message.length > 8000) throw new RunnerError('INVALID_EXECUTION_REQUEST', 422);
    const inputDigest = createHash('sha256').update(canonicalJson(request)).digest('hex');
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.record.inputDigest !== inputDigest) throw new RunnerError('EXECUTION_INPUT_CONFLICT');
      await existing.saving; return structuredClone(existing.record);
    }
    const now = new Date().toISOString();
    const entry: Entry = { record: { id, deploymentId: request.deploymentId, sessionId: request.sessionId, inputDigest,
      status: 'running', createdAt: now, updatedAt: now, events: [] }, saving: Promise.resolve() };
    this.entries.set(id, entry);
    try { await this.persist(entry); }
    catch (error) { this.entries.delete(id); throw error; }
    entry.work = this.enqueue(entry, () => this.runtime.query(request.deploymentId, request.sessionId, request.message));
    return structuredClone(entry.record);
  }
  async resume(id:string,request:ResumeRequest,token?:string){return this.fence.command(id,token,'resume',()=>this.resumeOwned(id,request));}
  private async resumeOwned(id: string, request: ResumeRequest) {
    const entry = this.require(id);
    if (!uuid.test(request.resumeId) || !request.toolCallId || request.toolCallId.length > 200 || typeof request.approved !== 'boolean') throw new RunnerError('INVALID_RESUME', 422);
    const old = entry.record.resumes?.[request.resumeId];
    if (old) { if (canonicalJson(old) !== canonicalJson(request)) throw new RunnerError('RESUME_INPUT_CONFLICT'); await entry.saving; return structuredClone(entry.record); }
    if (entry.record.status !== 'waiting_confirmation' || !this.runtime.resume) throw new RunnerError('EXECUTION_NOT_WAITING');
    const pending = (entry.record.result as { result?: { _interrupt?: { toolCallId?: string } } })?.result?._interrupt;
    if (pending?.toolCallId !== request.toolCallId) throw new RunnerError('RESUME_CALL_MISMATCH');
    (entry.record.resumes ??= {})[request.resumeId] = { ...request }; entry.record.status = 'running';
    await this.persist(entry);
    entry.work = this.enqueue(entry, () => this.runtime.resume!(entry.record.deploymentId, entry.record.sessionId, request.toolCallId, request.approved));
    return structuredClone(entry.record);
  }
  private enqueue(entry: Entry, invoke: () => Promise<unknown>) {
    const previous = this.queues.get(entry.record.deploymentId) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(() => this.execute(entry, invoke));
    this.queues.set(entry.record.deploymentId, work);
    void work.finally(() => { if (this.queues.get(entry.record.deploymentId) === work) this.queues.delete(entry.record.deploymentId); }).catch(() => {});
    return work;
  }
  private async execute(entry: Entry, invoke: () => Promise<unknown>) {
    try {
      if (entry.record.status !== 'running') return;
      const before = (await this.runtime.events(entry.record.deploymentId)).length;
      if (entry.record.status !== 'running') return;
      const result = await invoke();
      const events = (await this.runtime.events(entry.record.deploymentId)).slice(before).filter(value => {
        const session = (value as { event?: { sessionId?: string } } | null)?.event?.sessionId;
        return !session || session === entry.record.sessionId;
      });
      const interrupted = Boolean((result as { result?: { _interrupt?: unknown } } | null)?.result?._interrupt);
      if (entry.record.status === 'running') { entry.record.status = interrupted ? 'waiting_confirmation' : 'succeeded'; entry.record.result = result; entry.record.events.push(...events); }
    } catch (error) {
      if (entry.record.status === 'running') { entry.record.status = 'failed'; entry.record.error = error instanceof RunnerError ? error.code : 'EXECUTION_FAILED'; }
    } finally {
      await this.persist(entry).catch(() => { entry.record.status = 'interrupted'; entry.record.error = 'EXECUTION_PERSISTENCE_FAILED'; });
    }
  }
  private require(id: string) {
    const entry = this.entries.get(id); if (!entry) throw new RunnerError('EXECUTION_NOT_FOUND', 404); return entry;
  }
  async get(id: string) { const entry = this.require(id); await entry.saving; return structuredClone(entry.record); }
  async cancel(id:string,token?:string){return this.fence.command(id,token,'cancel',async()=>{
    if(!this.entries.has(id)&&token!==undefined)return{id,status:'cancelled' as const,events:[]};
    return this.cancelOwned(id);
  });}
  private async cancelOwned(id: string) {
    const entry = this.require(id);
    if (['succeeded', 'failed', 'cancelled'].includes(entry.record.status)) return this.get(id);
    if (entry.record.status === 'interrupted') throw new RunnerError('EXECUTION_REQUIRES_RECONCILIATION');
    entry.record.status = 'cancelling'; await this.persist(entry);
    try {
      const stopped = await this.runtime.cancelSession(entry.record.deploymentId, entry.record.sessionId);
      if (stopped.status === 'cancelled') { entry.record.status = 'cancelled'; await this.persist(entry); }
    } catch {
      // A transport failure cannot prove the native invocation stopped. Poll again without killing other sessions.
      entry.record.error = 'STOP_UNCONFIRMED'; await this.persist(entry);
    }
    return this.get(id);
  }
  async drain() { await Promise.all([...this.entries.values()].map(entry => entry.work)); }
  hasActiveDeployment(id: string) { return [...this.entries.values()].some(entry => entry.record.deploymentId === id && ['running','waiting_confirmation','cancelling','interrupted'].includes(entry.record.status)); }
}
