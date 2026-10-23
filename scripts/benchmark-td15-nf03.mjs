import { randomUUID } from 'node:crypto';
import { cpus, totalmem, platform, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const baseUrl = (process.env.BENCH_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const composeProject = process.env.BENCH_COMPOSE_PROJECT;
const composeArgs = ['compose', '--env-file', '.env.local', ...(composeProject ? ['-p', composeProject] : [])];
const compose = (...args) => execFileSync('docker', [...composeArgs, ...args], { stdio: 'ignore' });
const samples = Number(process.env.BENCH_SAMPLES ?? 100);
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 5);
if (!Number.isInteger(samples) || samples < 20 || samples > 500 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) throw new Error('BENCH_CONFIGURATION_INVALID');
const prefix = `td15-nf03-${randomUUID()}`;
const ids = [];
const saveMs = [];
const listMs = [];
let failures = 0;
const failureStatuses = {};
let csrfToken;
let cookie;
const origin = process.env.BENCH_ORIGIN ?? baseUrl;
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? null;
async function timed(url, init) {
  const start = performance.now();
  try {
    const response = await fetch(url, init);
    const elapsed = performance.now() - start;
    if (!response.ok) { failures++; failureStatuses[response.status] = (failureStatuses[response.status] ?? 0) + 1; return { elapsed, ok: false, status: response.status }; }
    return { elapsed, ok: true, body: await response.json() };
  } catch {
    failures++;
    failureStatuses.network = (failureStatuses.network ?? 0) + 1;
    return { elapsed: performance.now() - start, ok: false, status: 'network-error' };
  }
}
async function pool(items, width, work) {
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (next < items.length) { const index = next++; await work(items[index], index); } }));
}
let cleanupError;
try {
  const health = await fetch(`${baseUrl}/health/ready`);
  if (!health.ok) throw new Error(`APP_NOT_READY_${health.status}`);
  if (!process.env.LOCAL_BOOTSTRAP_TOKEN) throw new Error('LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
  if (!sessionResponse.ok) throw new Error(`AUTHENTICATION_FAILED_${sessionResponse.status}`);
  csrfToken = (await sessionResponse.json()).csrfToken;
  cookie = sessionResponse.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
  if (!csrfToken || !cookie) throw new Error('AUTHENTICATION_RESPONSE_INVALID');
  const authHeaders = { cookie };
  const jobs = Array.from({ length: samples }, (_, i) => i);
  await pool(jobs, concurrency, async (_, i) => {
    const result = await timed(`${baseUrl}/api/drafts`, { method: 'POST', headers: { ...authHeaders, origin, 'x-csrf-token': csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({
      name: `${prefix}-${String(i).padStart(4, '0')}`,
      brief: {
        audience: { value: 'TD-15 NF-03 benchmark', source: 'user', confirmed: true },
        goal: { value: 'Measure local mock platform draft save latency', source: 'user', confirmed: true },
        output: { value: 'P95 measurements only; no model call', source: 'template', confirmed: false }
      }
    }) });
    saveMs.push(result.elapsed);
    if (result.ok && result.body?.id) ids.push(result.body.id);
  });
  await pool(jobs, concurrency, async () => {
    const result = await timed(`${baseUrl}/api/drafts`, { headers: authHeaders });
    listMs.push(result.elapsed);
    if (result.ok && (!Array.isArray(result.body?.items) || result.body.items.length === 0)) failures++;
  });
} finally {
  if (/^td15-nf03-[0-9a-f-]{36}$/i.test(prefix)) {
    try {
      compose('exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'builder', '-d', 'builder', '-c', `BEGIN; DELETE FROM draft_revisions WHERE draft_id IN (SELECT id FROM drafts WHERE name LIKE '${prefix}-%'); DELETE FROM drafts WHERE name LIKE '${prefix}-%'; COMMIT;`);
    } catch { cleanupError = 'BENCHMARK_DATA_CLEANUP_FAILED'; }
  }
  if (process.env.LOCAL_BOOTSTRAP_TOKEN && typeof csrfToken === 'string' && typeof cookie === 'string') {
    try { await fetch(`${baseUrl}/api/auth/session`, { method: 'DELETE', headers: { cookie, origin, 'x-csrf-token': csrfToken } }); } catch { /* session expiry also removes it */ }
  }
}
const appContainer = execFileSync('docker', [...composeArgs, 'ps', '-q', 'app'], { encoding: 'utf8' }).trim();
if (!appContainer) throw new Error('APP_CONTAINER_NOT_FOUND');
const imageId = execFileSync('docker', ['inspect', appContainer, '--format', '{{.Image}}'], { encoding: 'utf8' }).trim();
const report = {
  schemaVersion: 1, benchmark: 'TD-15/NF-03', measuredAt: new Date().toISOString(), baseUrl,
  runtime: { platform: platform(), release: release(), cpuModel: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, totalMemoryBytes: totalmem(), appImageId: imageId },
  workload: { sampleCount: samples, concurrency, listPageLimit: 100, modelCalls: 0, externalBusinessCalls: 0 },
  save: { count: saveMs.length, p50Ms: percentile(saveMs, .50), p95Ms: percentile(saveMs, .95), maxMs: Math.max(...saveMs, 0) },
  list: { count: listMs.length, p50Ms: percentile(listMs, .50), p95Ms: percentile(listMs, .95), maxMs: Math.max(...listMs, 0) },
  failures, failureStatuses, savedRecords: ids.length, cleanup: cleanupError ? 'failed' : ids.length === samples ? 'complete' : 'incomplete', targetP95Ms: 1000,
  verdict: cleanupError ? 'blocked' : failures || ids.length !== samples ? 'failed' : percentile(saveMs, .95) < 1000 && percentile(listMs, .95) < 1000 ? 'passed' : 'failed'
};
await mkdir('docs/implementation/evidence', { recursive: true });
const output = 'docs/implementation/evidence/TD15-NF03-benchmark.json';
await writeFile(output, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ ...report, output }, null, 2) + '\n');
if (report.verdict !== 'passed') process.exitCode = 1;
