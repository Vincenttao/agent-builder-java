import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { RuntimeSpec } from '../../packages/contracts/src/index.js';
import { JavaDeploymentManager } from '../../apps/runner/src/runtime/deployment-manager.js';

// Real JVM/AgentServer; deterministic OpenAI-compatible model is explicitly a test fixture.
const model = createServer(async (req, res) => {
  let bytes = ''; for await (const chunk of req) bytes += chunk;
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  const input = JSON.parse(bytes);
  const text = JSON.stringify(input.messages).includes('VERSION_TWO') ? 'VERSION_TWO' : 'VERSION_ONE';
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ id: 'deterministic-model', model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }));
});
let manager: JavaDeploymentManager;
let root: string;
beforeAll(async () => {
  await new Promise<void>(r => model.listen(0, '127.0.0.1', r));
  const address = model.address(); if (!address || typeof address === 'string') throw new Error('Missing model port');
  root = resolve('.cache/runner-tests', randomUUID());
  manager = new JavaDeploymentManager({ root, artifactPath: resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar'),
    modelKey: 'fake-runner-model-key', modelBase: `http://127.0.0.1:${address.port}/v1`, proxyBase: 'http://127.0.0.1:1', proxyToken: 'fake-proxy-token' });
  await manager.initialize();
});
afterAll(async () => { if (manager) await manager.shutdown(); await new Promise<void>(r => model.close(() => r())); });
const spec = (id: string, marker: string): RuntimeSpec => ({ agent: { id, type: 'DeepAgent', systemPrompt: `Answer ${marker}`, maxIterations: 3, rails: ['audit', 'tool-allowlist'] }, tools: [] });

describe('TD-08/09 real Java deployment adapter', () => {
  it('pins two independent JVMs, deduplicates deployment input and never routes to the other version', async () => {
    const digest = manager.artifactDigest;
    const firstId = randomUUID(); const secondId = randomUUID();
    const firstSpec = spec('adapter-one', 'VERSION_ONE');
    const first = await manager.start(firstId, firstSpec, digest);
    const second = await manager.start(secondId, spec('adapter-two', 'VERSION_TWO'), digest);
    expect(first.status).toBe('ready'); expect(second.status).toBe('ready');
    expect(first.modelProfile).toEqual(manager.modelProfile); expect(first.modelProfile?.executionMode).toBe('simulated');
    expect(first.port).not.toBe(second.port);
    expect(first.specDigest).not.toBe(second.specDigest);
    expect(await manager.start(firstId, firstSpec, digest)).toEqual(first);
    await expect(manager.start(firstId, spec('changed', 'VERSION_TWO'), digest)).rejects.toMatchObject({ code: 'DEPLOYMENT_INPUT_CONFLICT' });
    const [v1, v2] = await Promise.all([manager.query(firstId, randomUUID(), 'version?'), manager.query(secondId, randomUUID(), 'version?')]);
    expect(JSON.stringify(v1)).toContain('VERSION_ONE'); expect(JSON.stringify(v2)).toContain('VERSION_TWO');
    const stopped = await manager.stop(secondId);
    expect(stopped.status).toBe('stopped');
    await expect(manager.query(secondId, randomUUID(), 'version?')).rejects.toMatchObject({ code: 'DEPLOYMENT_NOT_READY' });
    expect(JSON.stringify(await manager.query(firstId, randomUUID(), 'version?'))).toContain('VERSION_ONE');
    expect(await manager.events(secondId)).not.toHaveLength(0);
  });
  it('rejects path traversal and wrong artifact identity without starting a JVM', async () => {
    await expect(manager.start('../escape', spec('bad', 'VERSION_ONE'), manager.artifactDigest)).rejects.toMatchObject({ code: 'INVALID_DEPLOYMENT_ID' });
    await expect(manager.start(randomUUID(), spec('bad', 'VERSION_ONE'), 'wrong-digest')).rejects.toMatchObject({ code: 'ARTIFACT_MISMATCH' });
  });
  it('rejects a changed spec before invocation and retains the terminal state across manager restart', async () => {
    const id = randomUUID();
    await manager.start(id, spec('tamper-check', 'VERSION_ONE'), manager.artifactDigest);
    const path = resolve(root, 'deployments', id, 'spec.json');
    const original = await readFile(path, 'utf8');
    await writeFile(path, original.replace('VERSION_ONE', 'VERSION_TWO'));
    await expect(manager.query(id, randomUUID(), 'version?')).rejects.toMatchObject({ code: 'ARTIFACT_MISMATCH' });
    expect((await manager.get(id)).status).toBe('failed');
    await manager.shutdown();
    const restored = new JavaDeploymentManager(manager.options);
    await restored.initialize();
    expect((await restored.get(id)).status).toBe('failed');
    expect(await restored.events(id)).toEqual(await manager.events(id));
    await restored.shutdown();
  });
});
