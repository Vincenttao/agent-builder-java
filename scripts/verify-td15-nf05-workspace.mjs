import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';

const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
    : JSON.stringify(value);
const contentDigest = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

const sourceBase = (process.env.NF05_SOURCE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const sourceOrigin = process.env.NF05_SOURCE_ORIGIN ?? 'http://127.0.0.1:8080';
const targetPort = Number(process.env.NF05_TARGET_PORT ?? 18081);
const targetBase = `http://127.0.0.1:${targetPort}`;
const project = process.env.NF05_COMPOSE_PROJECT ?? 'agent-builder-td15-nf05';
const envPath = 'test-results/td15-nf05-target.env';
const reportPath = 'docs/implementation/evidence/TD15-NF05-workspace.json';
const local = parseEnv(await readFile('.env.local', 'utf8'));
assert.ok(local.LOCAL_BOOTSTRAP_TOKEN && local.DEEPSEEK_API_KEY, 'SOURCE_LOCAL_ENV_REQUIRED');
const randomSecret = () => randomBytes(32).toString('hex');
const targetEnv = {
  POSTGRES_PASSWORD: randomSecret(), MOCK_DB_PASSWORD: randomSecret(), LOCAL_BOOTSTRAP_TOKEN: randomSecret(),
  RUNNER_CONTROL_TOKEN: randomSecret(), TOOL_PROXY_TOKEN: randomSecret(), MOCK_CONTROL_TOKEN: randomSecret(),
  MOCK_SERVICE_TOKEN: randomSecret(), DEEPSEEK_API_KEY: local.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: local.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  DEEPSEEK_MODEL: local.DEEPSEEK_MODEL ?? 'deepseek-v4-flash', APP_PORT: String(targetPort),
  APP_ORIGIN: targetBase
};
const sensitiveValues = Object.entries(targetEnv).filter(([key]) => /TOKEN|KEY|PASSWORD/.test(key)).map(([, value]) => value);
const environment = (base, authOrigin = base) => ({ origin: base, authOrigin, cookie: '', csrf: '', readHeaders: {}, writeHeaders: {} });
let source = environment(sourceBase, sourceOrigin);
let target = environment(targetBase, targetBase);
let targetCreated = false;
let deployment;
let sourceRunnerPausedAt;
let sourceRunnerStoppedByRun = false;
let result = { schemaVersion: 1, requirement: 'TD-15/NF-05 NFR-08 fresh workspace restore', executionMode: 'isolated-live-docker', sourceBase, targetBase, composeProject: project, startedAt: new Date().toISOString() };

function compose(args) {
  try {
    return execFileSync('docker', ['compose', '--project-name', project, '--env-file', envPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...targetEnv, APP_PORT: String(targetPort), APP_ORIGIN: targetBase } }).trim();
  } catch (error) {
    const output = [error.stdout, error.stderr].map(value => value?.toString().trim()).filter(Boolean).join('\n');
    throw new Error(`NF05_COMPOSE_FAILED:${args.join(' ')}${output ? `\n${output}` : ''}`, { cause: error });
  }
}
function sourceRunner(action) {
  return execFileSync('docker', [action, 'agent-builder-td15-nf01-runner-1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function waitSourceRunnerHealthy(timeoutMs = 360000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = execFileSync('docker', ['inspect', '--format', '{{.State.Health.Status}}', 'agent-builder-td15-nf01-runner-1'], { encoding: 'utf8' }).trim();
      if (health === 'healthy') return Date.now();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('NF05_SOURCE_RUNNER_RECOVERY_TIMEOUT');
}
async function login(ctx, token) {
  const response = await fetch(`${ctx.origin}/api/auth/session`, { method: 'POST', headers: { origin: ctx.authOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(response.status, 200, `LOGIN_FAILED:${ctx.origin}:${response.status}`);
  ctx.cookie = response.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0] ?? '';
  ctx.csrf = (await response.json()).csrfToken;
  assert.ok(ctx.cookie && ctx.csrf, 'SESSION_COOKIE_OR_CSRF_MISSING');
  ctx.readHeaders = { cookie: ctx.cookie };
  ctx.writeHeaders = { origin: ctx.authOrigin, cookie: ctx.cookie, 'x-csrf-token': ctx.csrf, 'content-type': 'application/json' };
}
async function api(ctx, path, method = 'GET', body, headers) {
  const requestHeaders = headers ?? (method === 'GET' ? ctx.readHeaders : ctx.writeHeaders);
  const response = await fetch(`${ctx.origin}${path}`, { method, headers: requestHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${path}:${value?.code ?? 'UNKNOWN'}`);
  return value;
}
async function waitReady() {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    try { if ((await fetch(`${targetBase}/health/ready`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('NF05_TARGET_APP_NOT_READY');
}
async function mockCalls(environmentId, runId) {
  const script = `const p='/control/environments/${environmentId}/calls?runId=${runId}';const r=await fetch('http://127.0.0.1:8082'+p,{headers:{authorization:'Bearer '+process.env.MOCK_CONTROL_TOKEN}});if(!r.ok)process.exit(2);const j=await r.json();console.log(JSON.stringify(j.items.map(x=>x.operation)));`;
  return JSON.parse(compose(['exec', '-T', 'mock-services', 'node', '--input-type=module', '-e', script]));
}

try {
  await mkdir('test-results', { recursive: true });
  await mkdir('docs/implementation/evidence', { recursive: true });
  await writeFile(envPath, Object.entries(targetEnv).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  assert.equal(compose(['ps', '-q']), '', `TARGET_COMPOSE_PROJECT_ALREADY_EXISTS:${project}`);

  await login(source, local.LOCAL_BOOTSTRAP_TOKEN);
  const draftPage = await api(source, '/api/drafts');
  let sourceDraft;
  let sourceJob;
  let sourceArchive;
  for (const item of draftPage.items) {
    const page = await api(source, `/api/drafts/${item.id}/development`);
    const found = page.items.find(job => job.status === 'built' && job.bundle);
    if (!found) continue;
    const exported = await api(source, `/api/drafts/${item.id}/export`);
    const portable = exported.automation.jobs.find(job => job.id === found.id && job.generation.profileVersion === 'equipment-java@3');
    if (portable) { sourceDraft = item; sourceJob = found; sourceArchive = exported; break; }
  }
  assert.ok(sourceDraft && sourceJob, 'SOURCE_BUILT_EQUIPMENT_JOB_REQUIRED');
  const sourceCandidate = await api(source, '/api/candidates', 'POST', { snapshotId: sourceJob.snapshotId, developmentJobId: sourceJob.id });
  const archive = sourceArchive;
  assert.equal(archive.packageKind, 'agent-builder-project');
  assert.ok(archive.automation.jobs.some(job => job.id === sourceJob.id && job.files.length > 0), 'EXPORTED_GENERATED_SOURCE_MISSING');
  assert.ok(archive.automation.candidates.some(candidate => candidate.id === sourceCandidate.id && candidate.generated), `EXPORTED_GENERATED_CANDIDATE_MISSING:${JSON.stringify({ requested: sourceCandidate, exported: archive.automation.candidates })}`);
  const knownSecrets = Object.values(local).filter(value => typeof value === 'string' && value.length >= 24 && /TOKEN|KEY|PASSWORD/.test(value));
  sensitiveValues.push(...knownSecrets);
  const serialized = JSON.stringify(archive);
  const secretAbsent = knownSecrets.every(secret => !serialized.includes(secret));
  assert.ok(secretAbsent, 'PROJECT_EXPORT_CONTAINS_LOCAL_CREDENTIAL');
  result.sourceDraftId = sourceDraft.id;
  result.sourceDevelopmentJobId = sourceJob.id;
  result.sourceCandidateId = sourceCandidate.id;
  result.exportedGeneratedFiles = archive.automation.jobs.find(job => job.id === sourceJob.id).files.map(file => ({ path: file.path, digest: file.digest }));
  result.exportedMockScene = { version: archive.mockScene?.sceneVersion ?? null, contracts: archive.mockScene?.contracts.length ?? 0, seeds: archive.mockScene?.seeds.map(seed => seed.id) ?? [] };
  result.credentialsAbsent = secretAbsent;

  result.projectPackageSha256 = createHash('sha256').update(JSON.stringify(archive)).digest('hex');
  const sourceRunnerStatus = execFileSync('docker', ['inspect', '--format', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', 'agent-builder-td15-nf01-runner-1'], { encoding: 'utf8' }).trim();
  result.sourceRunnerStatusBeforeTargetBuild = sourceRunnerStatus;
  if (sourceRunnerStatus === 'running|healthy') {
    sourceRunnerPausedAt = Date.now();
    sourceRunner('stop');
    sourceRunnerStoppedByRun = true;
    result.sourceRunnerPausedForTargetBuild = true;
  } else {
    // Do not stop/start a source Runner that was already unhealthy before this run.
    // The isolated target still exercises import, rebuild, deployment and business calls.
    result.sourceRunnerPauseSkipped = true;
  }
  targetCreated = true;
  compose(['up', '-d', '--no-build']);
  await waitReady();
  result.targetComposeRunningServices = compose(['ps', '--status', 'running', '-q']).split(/\r?\n/).filter(Boolean).length;
  assert.equal(result.targetComposeRunningServices, 4, 'FRESH_WORKSPACE_COMPOSE_SERVICES_NOT_RUNNING');
  const targetContainerIds = compose(['ps', '-q']).split(/\r?\n/).filter(Boolean);
  result.targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...targetContainerIds], { encoding: 'utf8' }).trim().split(/\r?\n/);
  await login(target, targetEnv.LOCAL_BOOTSTRAP_TOKEN);
  const imported = await api(target, '/api/projects/import', 'POST', archive);
  const importedDraft = imported.draft;
  assert.ok(importedDraft.id !== archive.source.projectId, 'IMPORT_REUSED_SOURCE_PROJECT_ID');
  assert.equal(imported.needsRequirementConfirmation, false, 'SOURCE_REQUIREMENTS_SHOULD_REMAIN_CONFIRMED');
  assert.ok(imported.snapshots.length > 0, 'SNAPSHOT_NOT_RESTORED');
  assert.ok(imported.mockSceneToRestore && imported.mockSceneToRestore.digest === archive.mockScene.digest, 'MOCK_SCENE_NOT_RESTORED');
  assert.ok(imported.connectionsToRebind.length > 0, 'CONNECTION_REBIND_NOT_REQUIRED');
  assert.ok(imported.artifactsToRebuild.some(item => item.sourceJobId === sourceJob.id), 'GENERATED_ARTIFACT_REBUILD_NOT_REQUIRED');
  const recoveredPackage = await api(target, `/api/drafts/${importedDraft.id}/recovery-package`);
  assert.equal(recoveredPackage.packageDigest, archive.packageDigest, 'RECOVERY_PACKAGE_DIGEST_CHANGED');
  result.importedDraftId = importedDraft.id;
  result.importedSnapshotId = imported.snapshots[0].id;
  result.needsRequirementConfirmation = imported.needsRequirementConfirmation;
  result.connectionRebindRequired = imported.connectionsToRebind;
  result.generatedArtifactsToRebuild = imported.artifactsToRebuild;

  const sourcePortable = archive.automation.jobs.find(job => job.id === sourceJob.id);
  const templateId = archive.baselines[0]?.templateId ?? 'equipment-read@1';
  const preview = await api(target, `/api/drafts/${importedDraft.id}/baseline-preview?templateId=${encodeURIComponent(templateId)}`);
  const baseline = await api(target, `/api/drafts/${importedDraft.id}/baselines`, 'POST', { expectedRevision: importedDraft.revision, templateId, expectedDigest: preview.digest, confirmed: true });
  const newJob = await api(target, `/api/snapshots/${imported.snapshots[0].id}/development`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id, generation: sourcePortable.generation, maxSeconds: 600 });
  const buildDeadline = Date.now() + 620000;
  let built = newJob;
  while (Date.now() < buildDeadline && !['built', 'failed', 'cancelled', 'reconciling'].includes(built.status)) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    built = await api(target, `/api/development/${newJob.id}`);
  }
  if (built.status !== 'built') {
    const buildEvents = await api(target, `/api/development/${newJob.id}/events`);
    result.restoredBuildFailure = { status: built.status, diagnostic: built.diagnostic ?? null,
      roles: built.roles, events: buildEvents.items.map(event => ({ sequence: event.sequence, role: event.role, type: event.type,
        commandId: event.data.commandId ?? null, status: event.data.status ?? null, exitCode: event.data.exitCode ?? null,
        output: typeof event.data.output === 'string' ? event.data.output.slice(-1500) : undefined })) };
  }
  assert.equal(built.status, 'built', `RESTORED_PROJECT_BUILD_FAILED:${built.diagnostic ?? built.status}`);
  assert.ok(built.bundle?.digest, 'RESTORED_PROJECT_BUNDLE_MISSING');
  const candidate = await api(target, '/api/candidates', 'POST', { snapshotId: imported.snapshots[0].id, developmentJobId: built.id });
  assert.equal(candidate.provenance, 'generated-component');
  result.restoredDevelopmentJobId = built.id;
  result.restoredBundleDigest = built.bundle.digest;
  result.restoredCandidateId = candidate.id;
  result.restoredArtifactDigest = candidate.artifactDigest;

  const suiteDigest = contentDigest(baseline.content.cases);
  deployment = await api(target, '/api/test-deployments', 'POST', { clientRequestId: randomUUID(), candidateId: candidate.id, requirementBaselineId: baseline.id, suiteDigest, purpose: 'test', ttlSeconds: 300 });
  const deployDeadline = Date.now() + 90000;
  while (deployment.status === 'preparing' && Date.now() < deployDeadline) { await new Promise(resolve => setTimeout(resolve, 1000)); deployment = await api(target, `/api/test-deployments/${deployment.id}`); }
  assert.equal(deployment.status, 'ready', `RESTORED_TEST_DEPLOYMENT_NOT_READY:${deployment.diagnostic ?? deployment.status}`);
  const grant = await api(target, `/api/test-deployments/${deployment.id}/sessions`, 'POST', { actorId: 'U1001' });
  const bearer = { origin: targetBase, authorization: `Bearer ${grant.token}`, 'content-type': 'application/json' };
  const invocation = await api(target, `/test-api/deployments/${deployment.id}/messages`, 'POST', { clientRequestId: randomUUID(), input: '请查询 PUMP-001 的状态、温度和来源。' }, bearer);
  let request;
  const runDeadline = Date.now() + 120000;
  while (Date.now() < runDeadline) {
    request = await api(target, `/api/test-deployments/${deployment.id}/requests/${invocation.requestId}`);
    if (request.run && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(request.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(request?.run?.status, 'succeeded', `RESTORED_AGENT_SMOKE_FAILED:${request?.run?.diagnostic ?? request?.run?.status}`);
  const operations = await mockCalls(deployment.environmentId, request.run.id);
  assert.equal(operations.filter(operation => operation === 'equipment-status').length, 1, 'RESTORED_MOCK_CALL_COUNT_MISMATCH');
  assert.equal(operations.length, 1, 'UNEXPECTED_EXTERNAL_CALLS_AFTER_RESTORE');
  result.smokeRunId = request.run.id;
  result.mockOperations = operations;
  result.restoreVerdict = 'passed';

  await api(target, `/api/test-deployments/${deployment.id}/stop`, 'POST', {});
  const stopDeadline = Date.now() + 60000;
  while (Date.now() < stopDeadline) {
    deployment = await api(target, `/api/test-deployments/${deployment.id}`);
    if (deployment.status === 'stopped') break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(deployment.status, 'stopped', 'RESTORED_TEST_DEPLOYMENT_NOT_STOPPED');
  deployment = undefined;

  compose(['restart', 'app']);
  await waitReady();
  target = environment(targetBase, targetBase);
  await login(target, targetEnv.LOCAL_BOOTSTRAP_TOKEN);
  const afterRestart = await api(target, `/api/drafts/${importedDraft.id}/recovery-package`);
  assert.equal(afterRestart.packageDigest, archive.packageDigest, 'RECOVERY_PACKAGE_NOT_PERSISTED_AFTER_RESTART');
  result.recoveryPackageSurvivedAppRestart = true;
  result.targetRestarted = true;
  result.verdict = 'passed';
} catch (error) {
  result.verdict = 'failed';
  result.failure = String(error?.stack ?? error);
} finally {
  if (deployment && target.cookie) await fetch(`${targetBase}/api/test-deployments/${deployment.id}/stop`, { method: 'POST', headers: target.writeHeaders, body: '{}' }).catch(() => {});
  if (target.cookie) await fetch(`${targetBase}/api/auth/session`, { method: 'DELETE', headers: target.writeHeaders }).catch(() => {});
  if (source.cookie) await fetch(`${sourceBase}/api/auth/session`, { method: 'DELETE', headers: source.writeHeaders }).catch(() => {});
  if (targetCreated && result.verdict !== 'passed') {
    try {
      const ids = compose(['ps', '-q']).split(/\r?\n/).filter(Boolean);
      result.targetContainerLogs = ids.map(id => {
        let tail = execFileSync('docker', ['logs', '--tail', '160', id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).slice(-12000);
        for (const secret of sensitiveValues) if (secret) tail = tail.replaceAll(secret, '[REDACTED]');
        tail = tail.replace(/((?:api[_-]?key|token|password)\s*[:=]\s*|authorization\s*[:=]\s*(?:Bearer\s+)?)[^\s,"]+/gi, '$1[REDACTED]');
        return { id: id.slice(0, 12), service: execFileSync('docker', ['inspect', '--format', '{{.Config.Labels.com.docker.compose.service}}', id], { encoding: 'utf8' }).trim(), tail };
      });
    } catch (error) { result.targetLogCaptureFailure = String(error); }
  }
  if (targetCreated) {
    try { compose(['down', '-v', '--remove-orphans']); result.targetStackRemoved = true; }
    catch (error) { result.targetStackRemoved = false; result.cleanupFailure = String(error); }
  }
  if (sourceRunnerPausedAt && sourceRunnerStoppedByRun) {
    try {
      sourceRunner('start');
      const recoveredAt = await waitSourceRunnerHealthy();
      result.sourceRunnerRecoveryMs = recoveredAt - sourceRunnerPausedAt;
      result.sourceRunnerRestoredHealthy = true;
    } catch (error) {
      result.sourceRunnerRestoredHealthy = false;
      result.sourceRunnerRecoveryFailure = String(error?.stack ?? error);
      result.verdict = 'failed';
    }
  }
  await rm(envPath, { force: true });
  if (targetCreated && result.targetStackRemoved !== true) result.verdict = 'failed';
  result.finishedAt = new Date().toISOString();
  await mkdir('docs/implementation/evidence', { recursive: true });
  const outputPath = result.verdict === 'passed' ? reportPath : reportPath.replace(/\.json$/, `-failed-${Date.now()}.json`);
  result.evidencePath = outputPath;
  await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
  if (result.verdict === 'passed') {
    const manifestBytes = await readFile('tests/acceptance/manifest.json');
    const manifest = JSON.parse(manifestBytes.toString());
    const artifactIdentity = { schemaVersion: 1, composeProject: project, imageIds: result.targetImageIds, generatedArtifactDigest: result.restoredArtifactDigest, projectPackageSha256: result.projectPackageSha256 };
    const artifactPath = 'test-results/acceptance/td15-nf05-target-artifact.json';
    await mkdir('test-results/acceptance/evidence', { recursive: true });
    const identityBytes = Buffer.from(JSON.stringify(artifactIdentity, null, 2) + '\n');
    await writeFile(artifactPath, identityBytes);
    const artifactDigest = createHash('sha256').update(identityBytes).digest('hex');
    const compatibilityKey = createHash('sha256').update(JSON.stringify({ platform: process.platform, arch: process.arch, imageIds: result.targetImageIds })).digest('hex');
    const targetIdentity = { artifactPath, artifactDigest, compatibilityKey };
    await writeFile('test-results/acceptance/td15-nf05-target.json', JSON.stringify(targetIdentity, null, 2) + '\n');
    const managedEvidencePath = 'test-results/acceptance/evidence/TD15-NF05-workspace.json';
    const evidenceBytes = await readFile(reportPath);
    await writeFile(managedEvidencePath, evidenceBytes);
    const evidenceDigest = createHash('sha256').update(evidenceBytes).digest('hex');
    const binding = { baselineDigest: manifest.baselineDigest, artifactDigest, testSetDigest: createHash('sha256').update(manifestBytes).digest('hex'), compatibilityKey };
    const branchAssertions = {
      'export-no-secrets': [{ name: 'credential_scan_clean', passed: result.credentialsAbsent }, { name: 'generated_source_exported', passed: result.exportedGeneratedFiles?.length > 0 }],
      'fresh-directory-import': [{ name: 'fresh_compose_started', passed: result.targetComposeRunningServices === 4 }, { name: 'candidate_rebuilt_from_imported_project', passed: Boolean(result.restoredDevelopmentJobId && result.restoredArtifactDigest) }, { name: 'restored_agent_run_succeeded', passed: result.restoreVerdict === 'passed' }, { name: 'recovery_survived_app_restart', passed: result.recoveryPackageSurvivedAppRestart === true }],
      'rebind-required': [{ name: 'connection_rebind_reported', passed: result.connectionRebindRequired?.length > 0 }]
    };
    const results = Object.entries(branchAssertions).map(([branchId, assertions]) => ({ caseId: 'AC-18', branchId, binding, executionMode: 'live-mock', status: 'passed', artifactDigestAfter: artifactDigest, assertions,
      evidence: ['assertions', 'execution-record'].map(kind => ({ kind, path: managedEvidencePath.replace('test-results/', ''), sha256: evidenceDigest })) }));
    result.acceptanceResultsPath = 'test-results/acceptance/td15-nf05-results.json';
    await writeFile(result.acceptanceResultsPath, JSON.stringify({ binding, results }, null, 2) + '\n');
    await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n');
    await writeFile(managedEvidencePath, await readFile(reportPath));
    const refreshedEvidence = await readFile(managedEvidencePath);
    const refreshedDigest = createHash('sha256').update(refreshedEvidence).digest('hex');
    const packageResults = JSON.parse(await readFile(result.acceptanceResultsPath, 'utf8'));
    for (const branch of packageResults.results) for (const evidence of branch.evidence) evidence.sha256 = refreshedDigest;
    await writeFile(result.acceptanceResultsPath, JSON.stringify(packageResults, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (result.verdict !== 'passed') process.exitCode = 1;
