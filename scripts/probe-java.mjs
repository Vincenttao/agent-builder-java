import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing');
const runId = `java-live-${Date.now()}`;
const directory = resolve('.cache', runId);
await mkdir(directory, { recursive: true });
const evidenceDirectory = resolve('test-results', runId);
await mkdir(evidenceDirectory, { recursive: true });
const runtimeToken = randomBytes(32).toString('hex');
const proxyToken = randomBytes(32).toString('hex');
const key = process.env.DEEPSEEK_API_KEY;
const redact = text => [key, runtimeToken, proxyToken].reduce((v, secret) => v.replaceAll(secret, '[REDACTED]'), text);
const observations = [];
const mock = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/operations/equipment-status') { response.writeHead(404).end(); return; }
  if (request.headers.authorization !== `Bearer ${proxyToken}`) { response.writeHead(401).end(); return; }
  let body = ''; for await (const chunk of request) body += chunk;
  let input;
  try { input = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
  if (Object.keys(input).length !== 1 || typeof input.equipmentId !== 'string') { response.writeHead(422).end(); return; }
  const output = input.equipmentId === 'PUMP-001'
    ? { equipmentId: 'PUMP-001', status: 'warning', temperatureCelsius: 86, source: 'mock-maintenance-v1' } : null;
  observations.push({ at: new Date().toISOString(), operation: 'equipment-status', input, output });
  response.writeHead(output ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(output ?? { code: 'EQUIPMENT_NOT_FOUND' }));
});
await new Promise(resolveListen => mock.listen(0, '127.0.0.1', resolveListen));
// Reserve a loopback port before launch. No other running service is stopped.
const reservation = createServer();
await new Promise(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen));
const port = reservation.address().port;
await new Promise(resolveClose => reservation.close(resolveClose));
const jar = resolve('java/runtime-bridge/target/runtime-bridge-0.1.0.jar');
const spec = resolve('java/templates/equipment-readonly.json');
const eventsPath = join(directory, 'events.jsonl');
const startedAt = new Date().toISOString();
let logs = '';
let child;
let outcome;
try {
  child = spawn('java', ['-jar', jar, `--server.port=${port}`, `--builder.spec=${spec}`, `--builder.workspace=${join(directory, 'workspace')}`,
    `--builder.events=${eventsPath}`, `--builder.proxy-base=http://127.0.0.1:${mock.address().port}`], {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|SYSTEMROOT|WINDIR|JAVA_HOME|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(name))),
      DEEPSEEK_API_KEY: key, BUILDER_RUNTIME_TOKEN: runtimeToken, BUILDER_PROXY_TOKEN: proxyToken }
  });
  child.stdout.on('data', chunk => { logs = (logs + redact(chunk.toString())).slice(-200000); });
  child.stderr.on('data', chunk => { logs = (logs + redact(chunk.toString())).slice(-200000); });
  let startupError;
  child.on('error', error => { startupError = error; });
  const headers = { authorization: `Bearer ${runtimeToken}`, 'content-type': 'application/json' };
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (startupError || child.exitCode !== null) throw new Error('JAVA_STARTUP_FAILED');
    try { ready = (await fetch(base + '/health', { headers, signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (!ready) throw new Error('JAVA_READINESS_TIMEOUT');
  const loaded = await (await fetch(base + '/bridge/manifest', { headers, signal: AbortSignal.timeout(5000) })).json();
  const artifactDigest = createHash('sha256').update(await readFile(jar)).digest('hex');
  const specDigest = createHash('sha256').update(await readFile(spec)).digest('hex');
  assert.equal(loaded.artifactDigest, artifactDigest, 'JVM loaded artifact must match the actual JAR');
  assert.equal(loaded.specDigest, specDigest, 'JVM loaded specification must match immutable input');
  const response = await fetch(base + '/v1/query', { method: 'POST', headers, signal: AbortSignal.timeout(90000), body: JSON.stringify({ message: '查询设备 PUMP-001 的状态，必须先调用设备工具，并列明温度和来源。', conversation_id: runId, stream: false }) });
  const body = await response.text();
  assert.equal(response.status, 200, 'AgentServer query failed');
  assert.ok(observations.length > 0, 'Model must actually call the HTTP tool');
  assert.ok(observations.every(o => o.input.equipmentId === 'PUMP-001'));
  assert.match(body, /86/);
  assert.match(body, /mock-maintenance-v1/);
  const events = await readFile(eventsPath, 'utf8');
  assert.match(events, /tool-allowlist/);
  assert.match(events, /after_tool_call/);
  for (const secret of [key, runtimeToken, proxyToken]) assert.ok(!(body + events).includes(secret), 'Secret in evidence');
  await writeFile(join(evidenceDirectory, 'events.jsonl'), events);
  await writeFile(join(evidenceDirectory, 'response.json'), body);
  await writeFile(join(evidenceDirectory, 'observations.json'), JSON.stringify(observations, null, 2));
  await writeFile(join(evidenceDirectory, 'loaded-manifest.json'), JSON.stringify(loaded, null, 2));
  outcome = { status: 'passed', executionMode: 'live-mock', runId, startedAt, finishedAt: new Date().toISOString(),
    requestedModel: 'deepseek-v4-flash', artifactDigest, specDigest, sdk: JSON.parse(await readFile(resolve('deploy/java-sdk.lock.json'), 'utf8')),
    actualHttpCalls: observations.length, assertions: ['actual Model/Core/AgentServer', 'tool HTTP observation', 'response contains observed temperature and source', 'two rail events', 'no configured credentials in response/events'] };
} catch (error) {
  outcome = { status: 'failed', executionMode: 'live-mock', runId, startedAt, finishedAt: new Date().toISOString(), error: redact(error.message) };
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.pid) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
  await new Promise(resolveClose => mock.close(resolveClose));
  await writeFile(join(evidenceDirectory, 'process.log'), redact(logs));
  await writeFile(join(evidenceDirectory, 'result.json'), JSON.stringify(outcome, null, 2));
  console.log(JSON.stringify({ status: outcome.status, runId, evidenceDirectory }));
}
