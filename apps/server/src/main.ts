import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { Pool } from './db/pool.js';
import { createApp } from './app.js';
import { DraftService } from './drafts/application/draft-service.js';
import { PostgresDraftRepository } from './drafts/adapters/postgres-drafts.js';
import { PostgresSnapshotRepository } from './snapshots/adapters/postgres-snapshots.js';
import { SnapshotService } from './snapshots/application/snapshot-service.js';
import { RunService } from './runs/run-service.js';
import { HttpMock, HttpRunner } from './runs/http-ports.js';
import { PostgresActions } from './actions/postgres-actions.js';
import { ActionService } from './actions/action-service.js';
import { BaselineService } from './acceptance/application/baseline-service.js';
import { ValidationService } from './acceptance/application/validation-service.js';
import { RunValidationDriver } from './acceptance/adapters/run-validation-driver.js';
import {ReleaseService} from './releases/release-service.js';
import {ProjectReleaseGate} from './releases/project-release-gate.js';
import {ProjectReleaseDriver} from './releases/project-release-driver.js';
import {InvocationService} from './invocations/invocation-service.js';
import {CandidateService} from './candidates/candidate-service.js';
import {TestDeploymentService} from './candidates/test-deployment-service.js';
import {DevelopmentService} from './development/development-service.js';
import {HttpEngineering} from './development/http-engineering.js';
import {ValidationLeaseTokens} from './shared/validation-lease-tokens.js';
import {TestApiClient} from './acceptance/adapters/test-api-client.js';
import {CandidateValidationDriver} from './acceptance/adapters/candidate-validation-driver.js';
import {ValidationWriteFault} from './acceptance/adapters/validation-write-fault.js';
import {PostgresProjectPackageStore} from './projects/project-package-store.js';
import {RunEventRetention} from './runs/event-retention.js';

const databaseUrl = process.env.DATABASE_URL;
const bootstrapToken = process.env.LOCAL_BOOTSTRAP_TOKEN;
if (!databaseUrl || !bootstrapToken) throw new Error('DATABASE_URL and LOCAL_BOOTSTRAP_TOKEN are required');
const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
pool.on('error', () => console.error(JSON.stringify({ code: 'DATABASE_CONNECTION_ERROR' })));
const clock = { now: () => new Date().toISOString() };
const eventRetention = RunEventRetention.fromEnvironment(pool);
const drafts = new DraftService(new PostgresDraftRepository(pool), clock, { next: randomUUID });
const snapshots = new SnapshotService(drafts, new PostgresSnapshotRepository(pool), clock, { next: randomUUID });
const executionConfigured = Boolean(process.env.RUNNER_BASE_URL && process.env.RUNNER_CONTROL_TOKEN && process.env.MOCK_BASE_URL && process.env.MOCK_CONTROL_TOKEN && process.env.MOCK_SERVICE_TOKEN && process.env.TOOL_PROXY_TOKEN);
const mock = executionConfigured ? new HttpMock(process.env.MOCK_BASE_URL!, process.env.MOCK_CONTROL_TOKEN!, process.env.MOCK_SERVICE_TOKEN!) : undefined;
const actions = new PostgresActions(pool, clock); const writes = mock ? new ActionService(actions, mock) : undefined;
const validationWrites=writes?new ValidationWriteFault(pool,writes):undefined;
const runtime=executionConfigured?new HttpRunner(process.env.RUNNER_BASE_URL!,process.env.RUNNER_CONTROL_TOKEN!):undefined;
const runs = mock&&runtime ? new RunService(pool, snapshots, runtime, mock, actions, writes) : undefined;
const baselines = new BaselineService(pool, clock, { next: randomUUID });
const invocations=runs&&runtime&&mock?new InvocationService(pool,snapshots,runs,runtime,actions,mock):undefined;
const candidates=runtime?new CandidateService(pool,snapshots,runtime,baselines):undefined;
const testDeployments=candidates&&runs&&runtime&&mock?new TestDeploymentService(pool,candidates,baselines,snapshots,runs,runtime,mock):undefined;
let localTestApiBase='';const validationLeaseTokens=new ValidationLeaseTokens();
const validationDriver=runs&&mock&&runtime&&candidates?new CandidateValidationDriver(new RunValidationDriver(runs,mock,actions),candidates,runtime,mock,runs,actions,
  new TestApiClient(()=>localTestApiBase,process.env.APP_ORIGIN??'http://127.0.0.1:8080',bootstrapToken,validationLeaseTokens)):undefined;
const validations=validationDriver?new ValidationService(pool,baselines,snapshots,validationDriver,clock,candidates):undefined;
const releases=validations&&validationDriver&&runs&&runtime&&mock?new ReleaseService(pool,new ProjectReleaseGate(validations,baselines,snapshots,validationDriver,candidates),
  new ProjectReleaseDriver(pool,snapshots,baselines,validations,runs,runtime,mock,actions)):undefined;
const development=process.env.RUNNER_BASE_URL&&process.env.RUNNER_CONTROL_TOKEN?new DevelopmentService(pool,snapshots,baselines,new HttpEngineering(process.env.RUNNER_BASE_URL,process.env.RUNNER_CONTROL_TOKEN),validations&&candidates?{validations,candidates}:undefined):undefined;
const projectPackages=new PostgresProjectPackageStore(pool);
const app = createApp({
  drafts, snapshots, baselines,validationLeaseTokens, ...(validations ? { validations } : {}),
  projectPackages,
  ...(mock?{projectScene:()=>mock.scene()}:{}),
  ...(development?{development}:{}),
  ...(releases?{releases}:{}),
  ...(invocations?{invocations}:{}),
  ...(candidates&&testDeployments?{candidates,testDeployments}:{}),
  ...(runs && mock && validationWrites ? { runs, actions, toolProxy: { token: process.env.TOOL_PROXY_TOKEN!, context: (id: string) => runs.context(id), invoke: mock.invoke.bind(mock), mcp: mock.mcp.bind(mock), write: validationWrites.invoke.bind(validationWrites) } } : {}),
  databaseReady: async () => { await pool.query('SELECT id FROM drafts LIMIT 0'); await pool.query('SELECT id FROM snapshots LIMIT 0'); return true; },
  now: clock.now, bootstrapToken, origin: process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080',
  modelConfigured: Boolean(process.env.DEEPSEEK_API_KEY)
});
const worker = runs ? setInterval(() => { void runs.tick().catch(() => console.error(JSON.stringify({ code: 'RUN_WORKER_UNAVAILABLE' }))); }, 750) : undefined;
const validator = validations ? setInterval(() => { void validations.tick().catch(() => console.error(JSON.stringify({ code: 'VALIDATION_WORKER_UNAVAILABLE' }))); }, 1000) : undefined;
const publisher=releases?setInterval(()=>{void releases.tick().catch(()=>console.error(JSON.stringify({code:'RELEASE_WORKER_UNAVAILABLE'})));},1000):undefined;
const admission=invocations?setInterval(()=>{void invocations.tick().catch(()=>console.error(JSON.stringify({code:'INVOCATION_WORKER_UNAVAILABLE'})));},750):undefined;
const testing=testDeployments?setInterval(()=>{void testDeployments.tick().catch(()=>console.error(JSON.stringify({code:'TEST_DEPLOYMENT_WORKER_UNAVAILABLE'})));},1000):undefined;
const developing=development?setInterval(()=>{void development.tick().catch(()=>console.error(JSON.stringify({code:'DEVELOPMENT_WORKER_UNAVAILABLE'})));},1000):undefined;
const retention= runs ? setInterval(()=>{void eventRetention.prune().then(result=>{if(result.eventCount)console.log(JSON.stringify({event:'run.event_retention_pruned',...result}));}).catch(()=>console.error(JSON.stringify({code:'RUN_EVENT_RETENTION_UNAVAILABLE'})));},6*60*60*1000) : undefined;
if(runs)void eventRetention.prune().then(result=>{if(result.eventCount)console.log(JSON.stringify({event:'run.event_retention_pruned',...result}));}).catch(()=>console.error(JSON.stringify({code:'RUN_EVENT_RETENTION_UNAVAILABLE'})));
app.addHook('onClose',async()=>{if(developing)clearInterval(developing);});
app.addHook('onClose', async () => { if (worker) clearInterval(worker); if (validator) clearInterval(validator); if(publisher)clearInterval(publisher); if(admission)clearInterval(admission);if(testing)clearInterval(testing);if(retention)clearInterval(retention); });
const webRoot = resolve('apps/web/dist');
if (existsSync(webRoot)) await app.register(fastifyStatic, { root: webRoot });
app.addHook('onClose', async () => { await pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
try {
  const address = await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 8080) });
  localTestApiBase=`http://127.0.0.1:${new URL(address).port}`;
  console.log(JSON.stringify({ event: 'server.ready', address, executionMode: 'trusted-local' }));
} catch { console.error(JSON.stringify({ code: 'STARTUP_FAILED' })); await app.close(); process.exitCode = 1; }
