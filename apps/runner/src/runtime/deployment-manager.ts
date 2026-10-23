import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile, appendFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { RuntimeSpec } from '../../../../packages/contracts/src/index.js';
import { canonicalJson } from '../../../../packages/contracts/src/canonical.js';
import { startManagedProcess } from '../processes/supervisor.js';
import { runtimeModelProfile } from './model-profile.js';
import type { RuntimeModelProfile } from '../../../../packages/contracts/src/model-profile.js';
import {RuntimeArtifactRegistry} from './artifact-registry.js';
import type {GeneratedComponentManifest} from '../../../../packages/contracts/src/artifacts.js';
import {PolicyError} from '../engineering/profile.js';

export class RunnerError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
export interface DeploymentRecord {
  id: string; bootId: string; status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'interrupted'; processId?: number;
  artifactDigest: string; specDigest: string; createdAt: string; updatedAt: string; port?: number; error?: string;
  modelProfile?: RuntimeModelProfile;
  generated?: GeneratedComponentManifest;
}
export interface DeploymentOptions {
  root: string; artifactPath: string; modelKey: string; proxyBase: string; proxyToken: string;
  modelBase?: string; startupTimeoutMs?: number; queryTimeoutMs?: number;
}
interface Entry {
  record: DeploymentRecord; token: string; stopRequested: boolean; querying: boolean;
  cancelledSessions: Set<string>;
  process?: ReturnType<typeof startManagedProcess>; starting?: Promise<DeploymentRecord>; saving: Promise<void>; logging: Promise<void>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bytesDigest = (data: string) => createHash('sha256').update(data).digest('hex');
async function fileDigest(path: string) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
}
async function freePort() {
  const server = createServer(); await new Promise<void>((r, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', r); });
  const address = server.address(); if (!address || typeof address === 'string') throw new RunnerError('PORT_ALLOCATION_FAILED', 503);
  await new Promise<void>((r, reject) => server.close(error => error ? reject(error) : r())); return address.port;
}

/** One immutable JVM per deployment, one active invocation per JVM in the initial execution profile. */
export class JavaDeploymentManager {
  readonly bootId = randomUUID();
  artifactDigest = '';
  readonly modelProfile: RuntimeModelProfile;
  readonly artifacts: RuntimeArtifactRegistry;
  private entries = new Map<string, Entry>();
  private retired = new Set<string>();
  private restartCandidates = new Set<string>();
  constructor(readonly options: DeploymentOptions) { this.modelProfile = runtimeModelProfile(options.modelBase); this.artifacts=new RuntimeArtifactRegistry(options.root,options.artifactPath); }
  async initialize() {
    await mkdir(join(this.options.root, 'deployments'), { recursive: true });
    await mkdir(join(this.options.root, 'artifacts'), { recursive: true });
    const retirementRoot = join(this.options.root, 'retired'); await mkdir(retirementRoot, { recursive: true });
    for (const name of await readdir(retirementRoot)) {
      if (!name.endsWith('.json') || !uuid.test(name.slice(0,-5))) continue;
      const item = JSON.parse(await readFile(join(retirementRoot,name),'utf8')) as {id:string};
      if (`${item.id}.json` !== name) throw new RunnerError('RETIREMENT_STATE_CORRUPT');
      this.retired.add(item.id);
    }
    await this.artifacts.initialize();this.artifactDigest=this.artifacts.defaultDigest;
    for (const name of await readdir(join(this.options.root, 'deployments'))) {
      if (!uuid.test(name)) continue;
      const path = join(this.options.root, 'deployments', name, 'state.json');
      let record: DeploymentRecord;
      try { record = JSON.parse(await readFile(path, 'utf8')) as DeploymentRecord; }
      catch { throw new RunnerError('DEPLOYMENT_STATE_CORRUPT', 503); }
      if (record.id !== name) throw new RunnerError('DEPLOYMENT_STATE_CORRUPT', 503);
      const desiredPath=join(this.options.root,'deployments',name,'desired.json');
      let desired:'running'|'stopped';
      let hasDesiredRecord=true;
      try{desired=(JSON.parse(await readFile(desiredPath,'utf8')) as {state:'running'|'stopped'}).state;}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new RunnerError('DEPLOYMENT_STATE_CORRUPT',503);hasDesiredRecord=false;desired=this.retired.has(name)||record.status!=='ready'?'stopped':'running';}
      if(!['running','stopped'].includes(desired))throw new RunnerError('DEPLOYMENT_STATE_CORRUPT',503);
      const interrupted = ['starting', 'ready', 'stopping'].includes(record.status)||(record.status==='stopped'&&desired==='running');
      if (interrupted) {
        record.status = 'interrupted'; record.error = 'RUNNER_RESTART_REQUIRES_RECONCILIATION';
      }
      if(desired==='running'&&!this.retired.has(name)&&(['starting','ready','stopping','interrupted'].includes(record.status)||(hasDesiredRecord&&record.status==='stopped')))this.restartCandidates.add(name);
      const entry: Entry = { record, token: '', stopRequested: false, querying: false, cancelledSessions: new Set(), saving: Promise.resolve(), logging: Promise.resolve() };
      this.entries.set(name, entry); if (interrupted) await this.persist(entry);
    }
  }
  async start(id: string, spec: RuntimeSpec, expectedArtifactDigest: string) {
    if (!uuid.test(id)) throw new RunnerError('INVALID_DEPLOYMENT_ID', 422);
    if (this.retired.has(id)) throw new RunnerError('DEPLOYMENT_RETIRED');
    const artifact=await this.artifact(expectedArtifactDigest);
    const serialized = canonicalJson(spec); const specDigest = bytesDigest(serialized);
    if(artifact.kind==='generated-component'&&artifact.generated.specDigest!==specDigest)throw new RunnerError('GENERATED_SPEC_MISMATCH');
    const old = this.entries.get(id);
    if (old) {
      if (old.record.specDigest !== specDigest || old.record.artifactDigest !== expectedArtifactDigest) throw new RunnerError('DEPLOYMENT_INPUT_CONFLICT');
      if (old.starting) await old.starting;
      if(old.record.status==='ready')return structuredClone(old.record);
      const recoverable=old.record.status==='stopped'||old.record.status==='interrupted'||old.record.status==='failed'&&old.record.error==='DEPLOYMENT_RESTORE_FAILED';
      if(!recoverable)return structuredClone(old.record);
      old.record.status='starting';old.record.bootId=this.bootId;delete old.record.port;delete old.record.error;
      old.token=randomBytes(32).toString('hex');old.stopRequested=false;old.querying=false;old.cancelledSessions.clear();old.saving=Promise.resolve();
      await this.writeDesired(id,'running');old.starting=this.launch(old,serialized,true);return old.starting;
    }
    const now = new Date().toISOString();
    const entry: Entry = { record: { id, bootId: this.bootId, status: 'starting', artifactDigest: expectedArtifactDigest, specDigest, modelProfile: this.modelProfile,...(artifact.kind==='generated-component'?{generated:artifact.generated}:{}), createdAt: now, updatedAt: now },
      token: randomBytes(32).toString('hex'), stopRequested: false, querying: false, cancelledSessions: new Set(), saving: Promise.resolve(), logging: Promise.resolve() };
    this.entries.set(id, entry);
    entry.starting = this.launch(entry, serialized);
    return entry.starting;
  }
  private directory(entry: Entry) { return join(this.options.root, 'deployments', entry.record.id); }
  private persist(entry: Entry) {
    entry.record.updatedAt = new Date().toISOString();
    entry.saving = entry.saving.then(async () => {
      const path = join(this.directory(entry), 'state.json');
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(entry.record, null, 2)); await rename(temporary, path);
    });
    return entry.saving;
  }
  private async writeDesired(id:string,state:'running'|'stopped'){
    const directory=join(this.options.root,'deployments',id);await mkdir(directory,{recursive:true});
    const path=join(directory,'desired.json'),temporary=`${path}.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify({state}));await rename(temporary,path);
  }
  private async launch(entry: Entry, serialized: string, reuseFiles=false): Promise<DeploymentRecord> {
    const directory = this.directory(entry);
    try {
      await mkdir(directory, { recursive: true }); await mkdir(join(directory, 'workspace'), { recursive: true });
      const specPath=join(directory,'spec.json');
      if(reuseFiles){if(await readFile(specPath,'utf8')!==serialized)throw new RunnerError('ARTIFACT_MISMATCH');}
      else await writeFile(specPath, serialized, { flag: 'wx' });
      if(!reuseFiles)await writeFile(join(directory, 'events.jsonl'), '', { flag: 'wx' });
      else try{await readFile(join(directory,'events.jsonl'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeFile(join(directory,'events.jsonl'),'');}
      await this.persist(entry);
      if(!reuseFiles)await this.writeDesired(entry.record.id,'running');
      await this.verifyBytes(entry);
      if (!entry.stopRequested) {
        entry.record.port = await freePort();
        entry.process = startManagedProcess({ executable: 'java', cwd: directory,
          args: ['-Xmx512m', '-jar', this.artifacts.path(entry.record.artifactDigest), `--server.port=${entry.record.port}`, `--builder.spec=${resolve(directory, 'spec.json')}`,
            `--builder.workspace=${resolve(directory, 'workspace')}`, `--builder.events=${resolve(directory, 'events.jsonl')}`,
            `--builder.proxy-base=${this.options.proxyBase}`, `--builder.model-base=${this.modelProfile.model.baseUrl}`],
          env: { DEEPSEEK_API_KEY: this.options.modelKey, BUILDER_RUNTIME_TOKEN: entry.token, BUILDER_PROXY_TOKEN: this.options.proxyToken },
          secrets: [this.options.modelKey, entry.token, this.options.proxyToken], onLine: (line, stream) => {
            entry.logging = entry.logging.then(() => appendFile(join(directory, 'process.jsonl'), JSON.stringify({ at: new Date().toISOString(), stream, line }) + '\n'));
          } });
        if (entry.process.pid !== undefined) entry.record.processId = entry.process.pid;
        await this.persist(entry);
        void entry.process.exited.then(async () => {
          if (entry.record.status === 'ready') { entry.record.status = 'failed'; entry.record.error = 'JVM_EXITED'; await this.persist(entry); }
        }).catch(() => { entry.record.status = 'failed'; entry.record.error = 'STATE_WRITE_FAILED'; });
        const deadline = Date.now() + (this.options.startupTimeoutMs ?? 60000);
        let ready = false;
        while (Date.now() < deadline && !entry.stopRequested) {
          if (['failed', 'exited', 'stopped'].includes(entry.process.state())) throw new RunnerError('JVM_START_FAILED', 503);
          try { ready = (await fetch(this.base(entry) + '/health', { headers: this.headers(entry), redirect: 'error', signal: AbortSignal.timeout(1000) })).ok; } catch {}
          if (ready) break;
          await new Promise(r => setTimeout(r, 150));
        }
        if (!entry.stopRequested) {
          if (!ready) throw new RunnerError('JVM_READINESS_TIMEOUT', 503);
          const response = await fetch(this.base(entry) + '/bridge/manifest', { headers: this.headers(entry), redirect: 'error', signal: AbortSignal.timeout(3000) });
          if (!response.ok) throw new RunnerError('JVM_MANIFEST_UNAVAILABLE', 503);
          const loaded = await response.json() as { artifactDigest?: string; specDigest?: string; modelProfile?: unknown; generated?:unknown };
          if (loaded.artifactDigest !== entry.record.artifactDigest || loaded.specDigest !== entry.record.specDigest) throw new RunnerError('ARTIFACT_MISMATCH');
          if(canonicalJson(loaded.generated??null)!==canonicalJson(entry.record.generated??null))throw new RunnerError('GENERATED_MANIFEST_MISMATCH');
          if (!loaded.modelProfile || canonicalJson(loaded.modelProfile) !== canonicalJson(this.modelProfile.model)) throw new RunnerError('MODEL_PROFILE_MISMATCH');
          entry.record.status = 'ready';
        }
      }
      if (entry.process?.pid !== undefined) entry.record.processId = entry.process.pid;
      if (entry.stopRequested) { await entry.process?.stop(); entry.record.status = 'stopped'; }
      await this.persist(entry); return structuredClone(entry.record);
    } catch (error) {
      await entry.process?.stop(); entry.record.status = 'failed';
      entry.record.error = error instanceof RunnerError ? error.code : 'DEPLOYMENT_START_FAILED';
      await this.persist(entry);
      throw error instanceof RunnerError ? error : new RunnerError('DEPLOYMENT_START_FAILED', 503);
    }
  }
  private base(entry: Entry) { return `http://127.0.0.1:${entry.record.port}`; }
  private headers(entry: Entry) { return { Authorization: `Bearer ${entry.token}`, 'Content-Type': 'application/json' }; }
  private require(id: string) {
    const entry = this.entries.get(id); if (!entry) throw new RunnerError('DEPLOYMENT_NOT_FOUND', 404); return entry;
  }
  private async verifyBytes(entry: Entry) {
    await this.artifact(entry.record.artifactDigest);
    if (await fileDigest(join(this.directory(entry), 'spec.json')) !== entry.record.specDigest) throw new RunnerError('ARTIFACT_MISMATCH');
  }
  async artifact(digest:string){try{return await this.artifacts.get(digest);}catch(error){if(error instanceof PolicyError)throw new RunnerError(error.code,error.code==='ARTIFACT_NOT_FOUND'?404:409);throw error;}}
  async query(id: string, sessionId: string, message: string) {
    if (!uuid.test(sessionId) || !message.trim() || message.length > 8000) throw new RunnerError('INVALID_QUERY', 422);
    return this.invoke(id, sessionId, '/v1/query', { conversation_id: sessionId, message, stream: false });
  }
  async resume(id: string, sessionId: string, toolCallId: string, approved: boolean) {
    if (!uuid.test(sessionId) || !toolCallId || toolCallId.length > 200 || typeof approved !== 'boolean') throw new RunnerError('INVALID_RESUME', 422);
    return this.invoke(id, sessionId, '/bridge/resume', { sessionId, toolCallId, approved });
  }
  async cancelSession(id: string, sessionId: string): Promise<{ status: 'cancelling' | 'cancelled' }> {
    if (!uuid.test(sessionId)) throw new RunnerError('INVALID_SESSION_ID', 422);
    const entry = this.require(id); entry.cancelledSessions.add(sessionId);
    if (entry.record.status === 'stopped' || entry.process && ['failed','exited','stopped'].includes(entry.process.state())) return { status: 'cancelled' };
    if (entry.record.status === 'interrupted' || !entry.process) throw new RunnerError('STOP_UNCONFIRMED');
    const response = await fetch(this.base(entry) + '/bridge/cancel', { method: 'POST', headers: this.headers(entry), redirect: 'error', signal: AbortSignal.timeout(3000), body: JSON.stringify({ sessionId }) });
    if (!response.ok) throw new RunnerError('STOP_UNCONFIRMED');
    const body = await response.json() as { status?: unknown };
    if (body.status !== 'cancelled' && body.status !== 'cancelling') throw new RunnerError('STOP_UNCONFIRMED');
    return { status: body.status };
  }
  private async invoke(id: string, sessionId: string, path: string, body: unknown) {
    const entry = this.require(id);
    if (entry.record.status !== 'ready') throw new RunnerError('DEPLOYMENT_NOT_READY');
    if (entry.cancelledSessions.has(sessionId)) throw new RunnerError('RUN_CANCELLED');
    if (entry.querying) throw new RunnerError('DEPLOYMENT_BUSY');
    entry.querying = true;
    try {
      await this.verifyBytes(entry);
      const response = await fetch(this.base(entry) + path, { method: 'POST', headers: this.headers(entry), redirect: 'error',
        signal: AbortSignal.timeout(this.options.queryTimeoutMs ?? 90000), body: JSON.stringify(body) });
      if (!response.ok) throw new RunnerError('JVM_QUERY_FAILED', 502);
      const result: unknown = await response.json();
      await this.verifyBytes(entry);
      return result;
    } catch (error) {
      if (!entry.stopRequested && !(error instanceof RunnerError && error.code === 'JVM_QUERY_FAILED')) {
        if (error instanceof RunnerError && error.code === 'ARTIFACT_MISMATCH') await entry.process?.stop();
        else {
          // Unknown transport outcome: quarantine new invocations and request target cancellation.
          // Never terminate other sessions merely because one HTTP request failed.
          await this.cancelSession(id, sessionId).catch(() => {});
        }
        entry.record.status = 'failed'; entry.record.error = error instanceof RunnerError ? error.code : 'JVM_QUERY_UNAVAILABLE'; await this.persist(entry);
      }
      throw error instanceof RunnerError ? error : new RunnerError('JVM_QUERY_UNAVAILABLE', 502);
    } finally { entry.querying = false; }
  }
  async get(id: string) { return structuredClone(this.require(id).record); }
  async restoreAfterRestart(unsafeDeployments:ReadonlySet<string>):Promise<{restored:number;skipped:number;failed:number}>{
    let restored=0,skipped=0,failed=0;
    for(const id of this.restartCandidates){
      const entry=this.entries.get(id)!;
      if(unsafeDeployments.has(id)||this.retired.has(id)){skipped++;continue;}
      try{
        const serialized=await readFile(join(this.directory(entry),'spec.json'),'utf8');
        if(bytesDigest(serialized)!==entry.record.specDigest)throw new RunnerError('ARTIFACT_MISMATCH');
        entry.record.status='starting';entry.record.bootId=this.bootId;delete entry.record.port;delete entry.record.error;
        entry.token=randomBytes(32).toString('hex');entry.stopRequested=false;entry.querying=false;entry.cancelledSessions.clear();entry.saving=Promise.resolve();
        entry.starting=this.launch(entry,serialized,true);
        const result=await entry.starting;
        if(result.status==='ready')restored++;else failed++;
      }catch(error){entry.record.status='failed';entry.record.error=error instanceof RunnerError?error.code:'DEPLOYMENT_RESTORE_FAILED';await this.persist(entry).catch(()=>{});failed++;}
    }
    this.restartCandidates.clear();return{restored,skipped,failed};
  }
  async retire(id: string): Promise<{ status: 'stopped' }> {
    if (!uuid.test(id)) throw new RunnerError('INVALID_DEPLOYMENT_ID', 422);
    if(this.entries.has(id))await this.writeDesired(id,'stopped');
    this.retired.add(id);
    const path = join(this.options.root,'retired',`${id}.json`); const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify({id})); await rename(temporary,path);
    if (this.entries.has(id)) {
      const stopped = await this.stop(id);
      if (!['stopped','failed'].includes(stopped.status)) throw new RunnerError('STOP_UNCONFIRMED');
    }
    return {status:'stopped'};
  }
  async stop(id: string) {
    await this.writeDesired(id,'stopped');
    const entry = this.require(id);
    if (entry.record.status === 'stopped' || entry.record.status === 'failed' && (!entry.process || ['failed','exited','stopped'].includes(entry.process.state()))) return structuredClone(entry.record);
    if (entry.record.status === 'interrupted') {
      const pid = entry.record.processId;
      if (!Number.isInteger(pid) || pid! <= 0) throw new RunnerError('STOP_UNCONFIRMED');
      try { process.kill(pid!, 0); throw new RunnerError('STOP_UNCONFIRMED'); }
      catch (error) {
        if (error instanceof RunnerError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new RunnerError('STOP_UNCONFIRMED');
      }
      // The deployment's persisted child PID is confirmed absent. Do not claim
      // successful retirement when older records have no process identity or
      // when the PID still exists (including an inaccessible process).
      entry.record.status = 'stopped'; delete entry.record.error; await this.persist(entry);
      return structuredClone(entry.record);
    }
    entry.stopRequested = true; entry.record.status = 'stopping';
    if (entry.process) await entry.process.stop();
    if (entry.starting) await entry.starting.catch(() => {});
    entry.record.status = 'stopped'; await this.persist(entry); await entry.logging;
    return structuredClone(entry.record);
  }
  async events(id: string) {
    const entry = this.require(id);
    const text = await readFile(join(this.directory(entry), 'events.jsonl'), 'utf8');
    return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line) as unknown);
  }
  async shutdown() {
    const active=[...this.entries.values()].filter(e => ['starting', 'ready', 'stopping'].includes(e.record.status) || e.process && ['starting','running','stopping'].includes(e.process.state()));
    await Promise.all(active.filter(e=>!this.retired.has(e.record.id)).map(e=>this.writeDesired(e.record.id,'running')));
    const results = await Promise.allSettled(active.map(e => this.stopForShutdown(e)));
    if (results.some(r => r.status === 'rejected')) throw new RunnerError('STOP_UNCONFIRMED');
  }
  private async stopForShutdown(entry:Entry){
    if(entry.record.status==='interrupted')throw new RunnerError('STOP_UNCONFIRMED');
    entry.stopRequested=true;entry.record.status='stopping';if(entry.process)await entry.process.stop();if(entry.starting)await entry.starting.catch(()=>{});
    entry.record.status='stopped';await this.persist(entry);await entry.logging;return structuredClone(entry.record);
  }
}
