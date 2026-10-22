import { resolve, join } from 'node:path';
import { createRunnerApp } from './app.js';
import { JavaDeploymentManager } from './runtime/deployment-manager.js';
import { ExecutionJournal } from './executions/journal.js';
import {EngineeringTaskManager} from './engineering/task-manager.js';
import {OpenCodeTaskExecutor} from './engineering/task-executor.js';
import {resolveOpenCodeExecutable} from './engineering/engine-binary.js';

const root = resolve(process.env.RUNNER_DATA_ROOT ?? '.cache/runner');
const token = process.env.RUNNER_CONTROL_TOKEN ?? '';
const runtime = new JavaDeploymentManager({ root, artifactPath: resolve(process.env.JAVA_BRIDGE_JAR ?? 'java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),
  modelKey: process.env.DEEPSEEK_API_KEY ?? '', proxyBase: process.env.TOOL_PROXY_BASE ?? 'http://127.0.0.1:8080/internal/tool-proxy', proxyToken: process.env.TOOL_PROXY_TOKEN ?? '' });
await runtime.initialize();
const journal = new ExecutionJournal(join(root, 'executions'), runtime); await journal.initialize();
const engineBinary=process.env.OPENCODE_EXECUTABLE??resolveOpenCodeExecutable();
const engineering=new EngineeringTaskManager(join(root,'engineering'),directory=>new OpenCodeTaskExecutor({root:directory,sdkJar:resolve(process.env.JAVA_BRIDGE_JAR??'java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),executable:engineBinary,modelKey:process.env.DEEPSEEK_API_KEY??''}));await engineering.initialize();
const app = createRunnerApp({ token, runtime, journal,engineering, modelConfigured: Boolean(process.env.DEEPSEEK_API_KEY) });
const engineeringWorker=setInterval(()=>{void engineering.tick().catch(()=>console.error(JSON.stringify({code:'ENGINEERING_WORKER_UNAVAILABLE'})));},750);
let closing = false;
const shutdown = async () => {
  if (closing) return; closing = true;
  clearInterval(engineeringWorker);await engineering.close();await runtime.shutdown(); await journal.drain(); await app.close();
};
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void shutdown().catch(() => { console.error(JSON.stringify({ code: 'RUNNER_STOP_UNCONFIRMED' })); process.exitCode = 1; }); });
try {
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.RUNNER_PORT ?? 8081) });
  console.log(JSON.stringify({ event: 'runner.ready', bootId: runtime.bootId, artifactDigest: runtime.artifactDigest }));
} catch { await shutdown(); throw new Error('RUNNER_START_FAILED'); }
