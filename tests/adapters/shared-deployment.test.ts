import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { JavaDeploymentManager } from '../../apps/runner/src/runtime/deployment-manager.js';
import { ExecutionJournal } from '../../apps/runner/src/executions/journal.js';
import { equipmentAssembly } from '../../packages/contracts/src/equipment-template.js';
import { assemble } from '../../apps/server/src/snapshots/domain/assembly.js';

let releaseModel: (() => void) | undefined; let firstEntered = false; let calls = 0; let tools = 0;
const external = createServer(async (req, res) => {
  if (req.url?.startsWith('/operations/')) { tools++; res.setHeader('content-type', 'application/json'); res.end('{"equipmentId":"PUMP-001","status":"warning","temperatureCelsius":86,"source":"fixture"}'); return; }
  let body = ''; for await (const part of req) body += part;
  const paused = body.includes('PAUSE_FIRST'); calls++;
  if (paused) { firstEntered = true; await new Promise<void>(r => { releaseModel = r; }); }
  if (res.destroyed) return;
  const message = paused ? { role: 'assistant', content: '', tool_calls: [{ id: 'must-not-call', type: 'function', function: { name: 'get_equipment', arguments: '{"equipmentId":"PUMP-001"}' } }] } : { role: 'assistant', content: 'SECOND_SESSION_COMPLETED' };
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'shared-fixture', model: 'fixture', choices: [{ index: 0, message, finish_reason: paused ? 'tool_calls' : 'stop' }] }));
});
let runtime: JavaDeploymentManager; let journal: ExecutionJournal;
const deploymentId = randomUUID();
beforeAll(async () => {
  await new Promise<void>(r => external.listen(0, '127.0.0.1', r)); const address = external.address(); if (!address || typeof address === 'string') throw new Error('MISSING_PORT');
  const root = resolve('test-results', `shared-runtime-${Date.now()}`);
  runtime = new JavaDeploymentManager({ root, artifactPath: resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'), modelKey: 'fixture', modelBase: `http://127.0.0.1:${address.port}/v1`, proxyBase: `http://127.0.0.1:${address.port}`, proxyToken: 'fixture-proxy' });
  await runtime.initialize(); journal = new ExecutionJournal(resolve(root, 'executions'), runtime); await journal.initialize();
  const spec = assemble('shared-deployment', equipmentAssembly()); await runtime.start(deploymentId, spec, runtime.artifactDigest);
});
afterAll(async () => { releaseModel?.(); await runtime?.shutdown(); await new Promise<void>(r => external.close(() => r())); });
it('cancels only the requested execution and leaves queued sessions and the deployment usable', async () => {
  const first = randomUUID(); const second = randomUUID();
  await journal.begin(first, { deploymentId, sessionId: first, message: 'PAUSE_FIRST' });
  await expect.poll(() => firstEntered, { timeout: 15000 }).toBe(true);
  await journal.begin(second, { deploymentId, sessionId: second, message: 'SECOND_SESSION' });
  const cancellation = await journal.cancel(first);
  expect(['cancelling', 'cancelled']).toContain(cancellation.status); expect((await runtime.get(deploymentId)).status).toBe('ready');
  await expect.poll(async () => (await journal.cancel(first)).status, { timeout: 15000 }).toBe('cancelled');
  await expect.poll(async () => (await journal.get(second)).status, { timeout: 15000 }).toBe('succeeded');
  // Both complete while the first provider response is still blocked. A late tool call must be ignored.
  expect(calls).toBe(2); releaseModel!(); await new Promise(r => setTimeout(r, 100));
  expect(JSON.stringify((await journal.get(second)).result)).toContain('SECOND_SESSION_COMPLETED'); expect(tools).toBe(0);
  expect((await runtime.get(deploymentId)).status).toBe('ready');
  await expect(runtime.resume(deploymentId, first, 'must-not-call', true)).rejects.toBeDefined();
  expect((await runtime.get(deploymentId)).status).toBe('ready');
  await writeFile(resolve('test-results/tdd-008/shared-session-evidence.json'),JSON.stringify({modelMode:'deterministic-fixture',artifactDigest:runtime.artifactDigest,deployment:await runtime.get(deploymentId),cancelled:await journal.get(first),otherSession:await journal.get(second),modelCalls:calls,toolCalls:tools,events:await runtime.events(deploymentId)},null,2));
});
