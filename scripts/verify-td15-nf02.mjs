import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const baseUrl = (process.env.NF02_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const origin = process.env.NF02_ORIGIN ?? baseUrl;
const composeProject = process.env.NF02_COMPOSE_PROJECT;
const token = process.env.LOCAL_BOOTSTRAP_TOKEN;
if (!token) throw new Error('LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const sentinel = `NF02-SENTINEL-${randomUUID()}`;
const start = new Date(Date.now() - 1500);
const containsSecret = text => text.includes(sentinel) || /sk-[A-Za-z0-9_-]{20,}/.test(text);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const checked = {};
let session;
let cookie;
let exportBody = '';
let logs = '';
try {
  const ready = await fetch(`${baseUrl}/health/ready`);
  if (!ready.ok) throw new Error(`APP_NOT_READY_${ready.status}`);
  const login = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  if (!login.ok) throw new Error(`AUTHENTICATION_FAILED_${login.status}`);
  session = (await login.json()).csrfToken;
  cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
  if (!session || !cookie) throw new Error('AUTHENTICATION_RESPONSE_INVALID');

  const invalid = await fetch(`${baseUrl}/api/connection-bindings`, { method: 'POST', headers: { origin, cookie, 'x-csrf-token': session, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'http', profile: 'nf02-sentinel-probe', apiKey: sentinel }) });
  const invalidBody = await invalid.text();
  checked.errorResponse = { status: invalid.status, sentinelAbsent: !containsSecret(invalidBody), bodyDigest: sha256(invalidBody) };

  const draftsResponse = await fetch(`${baseUrl}/api/drafts`, { headers: { cookie } });
  if (!draftsResponse.ok) throw new Error(`DRAFT_LIST_FAILED_${draftsResponse.status}`);
  const draft = (await draftsResponse.json()).items?.[0];
  if (!draft?.id) throw new Error('NO_PROJECT_AVAILABLE_FOR_EXPORT');
  const exported = await fetch(`${baseUrl}/api/drafts/${draft.id}/export`, { headers: { cookie } });
  if (!exported.ok) throw new Error(`PROJECT_EXPORT_FAILED_${exported.status}`);
  exportBody = await exported.text();
  checked.export = { status: exported.status, sentinelAbsent: !containsSecret(exportBody), bodyDigest: sha256(exportBody) };
} finally {
  if (session && cookie) {
    try { await fetch(`${baseUrl}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': session } }); } catch { /* session expires */ }
  }
}

const composeArgs = ['compose', '--env-file', '.env.local', ...(composeProject ? ['-p', composeProject] : []), 'ps', '-q', 'app'];
const appContainer = execFileSync('docker', composeArgs, { encoding: 'utf8' }).trim();
if (!appContainer) throw new Error('APP_CONTAINER_NOT_FOUND');
const image = execFileSync('docker', ['inspect', appContainer, '--format', '{{.Image}}'], { encoding: 'utf8' }).trim();
logs = execFileSync('docker', ['logs', '--since', start.toISOString(), appContainer], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
checked.logs = { sentinelAbsent: !containsSecret(logs), scannedBytes: Buffer.byteLength(logs), digest: sha256(logs) };
checked.verdict = checked.errorResponse.sentinelAbsent && checked.export.sentinelAbsent && checked.logs.sentinelAbsent && checked.logs.scannedBytes > 0 ? 'passed' : 'unverified';
const report = { schemaVersion: 1, benchmark: 'TD-15/NF-02', measuredAt: new Date().toISOString(), baseUrl, appImageId: image, invalidCredentialField: { route: '/api/connection-bindings', status: checked.errorResponse.status }, checks: { errorResponse: checked.errorResponse.sentinelAbsent, export: checked.export.sentinelAbsent, containerLogs: checked.logs.sentinelAbsent, logChannelPresent: checked.logs.scannedBytes > 0 }, digests: { errorResponse: checked.errorResponse.bodyDigest, export: checked.export.bodyDigest, containerLogs: checked.logs.digest }, scannedLogBytes: checked.logs.scannedBytes, verdict: checked.verdict };
await mkdir('docs/implementation/evidence', { recursive: true });
const output = 'docs/implementation/evidence/TD15-NF02-live.json';
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ ...report, output }) + '\n');
if (report.verdict !== 'passed') process.exitCode = 1;
