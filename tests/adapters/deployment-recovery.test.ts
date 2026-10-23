import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { JavaDeploymentManager } from '../../apps/runner/src/runtime/deployment-manager.js';
import { ExecutionJournal } from '../../apps/runner/src/executions/journal.js';
import type { RuntimeSpec } from '../../packages/contracts/src/index.js';

const model = createServer(async (_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ id: 'recovery-model', model: 'fixture', choices: [{ index: 0,
    message: { role: 'assistant', content: 'RECOVERED_DEPLOYMENT_OK' }, finish_reason: 'stop' }] }));
});
await new Promise<void>(resolveListen => model.listen(0, '127.0.0.1', resolveListen));
const address = model.address();
if (!address || typeof address === 'string') throw new Error('RECOVERY_MODEL_PORT_MISSING');
const spec: RuntimeSpec = { agent: { id: 'recovery-agent', type: 'DeepAgent', systemPrompt: 'Answer with the test fixture.',
  maxIterations: 2, rails: ['audit', 'tool-allowlist'] }, tools: [] };
const roots:string[]=[];
const options = async () => {const root=await mkdtemp(join(tmpdir(), 'agent-builder-recovery-'));roots.push(root);return{root,artifactPath:resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),
  modelKey:'fixture-key',modelBase:`http://127.0.0.1:${address.port}/v1`,proxyBase:'http://127.0.0.1:1',proxyToken:'fixture-token'};};
afterAll(async () => { await Promise.all(roots.map(root=>rm(root, { recursive: true, force: true }))); await new Promise<void>(resolveClose => model.close(() => resolveClose())); });

it('restores an idle non-retired deployment after graceful Runner replacement', async () => {
  const id = randomUUID();
  const config=await options();const old = new JavaDeploymentManager(config);
  await old.initialize();
  const first = await old.start(id, spec, old.artifactDigest);
  expect(first.status).toBe('ready');
  const oldEvents = await old.events(id);
  await old.shutdown();
  const statePath=join(config.root,'deployments',id,'state.json');
  const persisted=JSON.parse(await readFile(statePath,'utf8')) as {status:string};persisted.status='ready';
  await writeFile(statePath,JSON.stringify(persisted)); // Simulate Runner loss while the deployment state still said ready.

  const current = new JavaDeploymentManager(config);
  await current.initialize();
  const journal = new ExecutionJournal(join(config.root, 'executions'), current);
  await journal.initialize();
  const report = await current.restoreAfterRestart(journal.restartUnsafeDeployments);
  expect(report).toEqual({ restored: 1, skipped: 0, failed: 0 });
  expect((await current.get(id)).status).toBe('ready');
  expect(await current.events(id)).toEqual(oldEvents);
  expect(JSON.stringify(await current.query(id, randomUUID(), 'health check'))).toContain('RECOVERED_DEPLOYMENT_OK');
  await current.shutdown();
});

it('does not restore a deployment with an execution that was active at restart', async () => {
  const id = randomUUID();
  const config=await options();const old = new JavaDeploymentManager(config);
  await old.initialize();
  await old.start(id, spec, old.artifactDigest);
  await old.shutdown();
  const executionId = randomUUID();
  const executionsRoot = join(config.root, 'active-executions');
  await mkdir(executionsRoot, { recursive: true });
  await writeFile(join(executionsRoot, `${executionId}.json`), JSON.stringify({ id: executionId, deploymentId: id,
    sessionId: randomUUID(), inputDigest: 'd'.repeat(64), status: 'waiting_confirmation',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [] }));

  const current = new JavaDeploymentManager(config);
  await current.initialize();
  const journal = new ExecutionJournal(executionsRoot, current);
  await journal.initialize();
  expect(journal.restartUnsafeDeployments.has(id)).toBe(true);
  const report = await current.restoreAfterRestart(journal.restartUnsafeDeployments);
  expect(report).toEqual({ restored: 0, skipped: 1, failed: 0 });
  expect((await current.get(id)).status).toBe('interrupted');
  await expect(current.query(id, randomUUID(), 'must not replay')).rejects.toMatchObject({ code: 'DEPLOYMENT_NOT_READY' });
  await current.shutdown();
});

it('retires a restart-interrupted deployment only after its persisted child PID is gone', async () => {
  const id = randomUUID();
  const config = await options(); const old = new JavaDeploymentManager(config);
  await old.initialize();
  const started = await old.start(id, spec, old.artifactDigest);
  expect(started.status).toBe('ready');
  expect(started.processId).toEqual(expect.any(Number));
  const oldPid = started.processId!;
  let recovered: JavaDeploymentManager | undefined;
  try {
    await old.shutdown(); // Owns and waits for the Java child process to exit.
    const statePath = join(config.root, 'deployments', id, 'state.json');
    const persisted = JSON.parse(await readFile(statePath, 'utf8')) as { status: string };
    persisted.status = 'ready'; // Simulate Runner SIGKILL after the child has been reaped.
    await writeFile(statePath, JSON.stringify(persisted));

    recovered = new JavaDeploymentManager(config);
    await recovered.initialize();
    expect((await recovered.get(id)).status).toBe('interrupted');
    await expect(recovered.retire(id)).resolves.toEqual({ status: 'stopped' });
    expect((await recovered.get(id)).status).toBe('stopped');
    await expect(recovered.start(id, spec, recovered.artifactDigest)).rejects.toMatchObject({ code: 'DEPLOYMENT_RETIRED' });
    expect(() => process.kill(oldPid, 0)).toThrow();
  } finally {
    await recovered?.shutdown().catch(() => {});
    await old.shutdown().catch(() => {});
  }
});

it('keeps an interrupted deployment quarantined while its persisted child PID is still alive', async () => {
  const id = randomUUID();
  const config = await options(); const old = new JavaDeploymentManager(config);
  await old.initialize();
  let recovered: JavaDeploymentManager | undefined;
  try {
    const started = await old.start(id, spec, old.artifactDigest);
    expect(started.processId).toEqual(expect.any(Number));
    recovered = new JavaDeploymentManager(config);
    await recovered.initialize();
    expect((await recovered.get(id)).status).toBe('interrupted');
    await expect(recovered.retire(id)).rejects.toMatchObject({ code: 'STOP_UNCONFIRMED' });
    expect((await recovered.get(id)).status).toBe('interrupted');
    await expect(recovered.start(id, spec, recovered.artifactDigest)).rejects.toMatchObject({ code: 'DEPLOYMENT_RETIRED' });
  } finally {
    await recovered?.shutdown().catch(() => {});
    await old.shutdown().catch(() => {});
  }
});

it('does not replay an in-flight real JVM model request after Runner state recovery', async () => {
  let modelCalls = 0; let requestEntered!: () => void; let releaseResponse!: () => void;
  const entered = new Promise<void>(resolveEntered => { requestEntered = resolveEntered; });
  const released = new Promise<void>(resolveReleased => { releaseResponse = resolveReleased; });
  const delayedModel = createServer(async (_request, response) => {
    modelCalls++;
    requestEntered();
    await released;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: 'delayed-recovery-model', model: 'fixture', choices: [{ index: 0,
      message: { role: 'assistant', content: 'RECOVERED_IN_FLIGHT_REQUEST' }, finish_reason: 'stop' }] }));
  });
  await new Promise<void>(resolveListen => delayedModel.listen(0, '127.0.0.1', resolveListen));
  const address = delayedModel.address();
  if (!address || typeof address === 'string') throw new Error('DELAYED_MODEL_PORT_MISSING');
  const config = await options(); config.modelBase = `http://127.0.0.1:${address.port}/v1`;
  const old = new JavaDeploymentManager(config); await old.initialize();
  let current: JavaDeploymentManager | undefined;
  const deploymentId = randomUUID(); const sessionId = randomUUID(); const executionId = randomUUID();
  await old.start(deploymentId, spec, old.artifactDigest);
  const journalRoot = join(config.root, 'executions'); const oldJournal = new ExecutionJournal(journalRoot, old); await oldJournal.initialize();
  try {
    await oldJournal.begin(executionId, { deploymentId, sessionId, message: 'Wait for a model response.' });
    await entered;
    expect(modelCalls).toBe(1);
    expect(JSON.parse(await readFile(join(journalRoot, `${executionId}.json`), 'utf8')).status).toBe('running');

    // Preserve the durable in-flight record as a second Runner boot would see it.
    const recoveredJournalRoot = await mkdtemp(join(tmpdir(), 'agent-builder-active-recovery-')); roots.push(recoveredJournalRoot);
    await writeFile(join(recoveredJournalRoot, `${executionId}.json`), await readFile(join(journalRoot, `${executionId}.json`)));
    current = new JavaDeploymentManager(config); await current.initialize();
    const recoveredJournal = new ExecutionJournal(recoveredJournalRoot, current); await recoveredJournal.initialize();
    expect((await recoveredJournal.get(executionId)).status).toBe('interrupted');
    expect(recoveredJournal.restartUnsafeDeployments.has(deploymentId)).toBe(true);
    expect(await current.restoreAfterRestart(recoveredJournal.restartUnsafeDeployments)).toEqual({ restored: 0, skipped: 1, failed: 0 });
    expect((await current.get(deploymentId)).status).toBe('interrupted');
    await expect(recoveredJournal.begin(executionId, { deploymentId, sessionId, message: 'Wait for a model response.' })).resolves.toMatchObject({ status: 'interrupted' });
    await expect(current.query(deploymentId, randomUUID(), 'This must not be replayed.')).rejects.toMatchObject({ code: 'DEPLOYMENT_NOT_READY' });
    expect(modelCalls).toBe(1);

    releaseResponse();
    await expect.poll(async () => (await oldJournal.get(executionId)).status).toBe('succeeded');
    await current.shutdown();
  } finally {
    releaseResponse();
    await current?.shutdown().catch(() => {});
    await old.shutdown();
    await new Promise<void>(resolveClose => delayedModel.close(() => resolveClose()));
  }
});
