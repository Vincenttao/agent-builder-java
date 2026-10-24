import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

const base = (process.env.TD15_FINANCE_BASE_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
const origin = process.env.TD15_FINANCE_ORIGIN ?? base;
const project = process.env.TD15_FINANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const evidencePath = process.env.TD15_FINANCE_EVIDENCE_PATH ?? 'docs/implementation/evidence/TDD-073/finance-generation-live.json';
const resumeJobId = process.env.TD15_FINANCE_RESUME_JOB;
const requestedScope = process.env.TD15_FINANCE_GENERATION_SCOPE ?? 'tool-skill';
const generationByScope = {
  tool: { profileVersion: 'wealth-balance-tool-java@1', scope: ['tool'] },
  skill: { profileVersion: 'wealth-balance-skill-java@1', scope: ['skill'] },
  'tool-skill': { profileVersion: 'wealth-balance-java@1', scope: ['tool', 'skill'] },
};
assert.ok(generationByScope[requestedScope], 'INVALID_TD15_FINANCE_GENERATION_SCOPE');
const generationProfile = generationByScope[requestedScope];
const evidence = { startedAt: new Date().toISOString(), base, composeProject: project, requestedScope,
  profileVersion: generationProfile.profileVersion, expectedGeneratedScope: generationProfile.scope, verdict: 'running' };
if (resumeJobId) {
  const previous = JSON.parse(await readFile(evidencePath, 'utf8'));
  Object.assign(evidence, previous);
  if (evidence.error) { evidence.recoveredError = evidence.error; delete evidence.error; }
}
let cookie, csrf;

function imageIds() {
  const containers = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(containers.length, 2, 'APP_RUNNER_TARGET_REQUIRED');
  return execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
}

const tokenLine = (await readFile('.env.local', 'utf8')).split(/\r?\n/).find(line => line.startsWith('LOCAL_BOOTSTRAP_TOKEN='));
const token = tokenLine?.slice('LOCAL_BOOTSTRAP_TOKEN='.length).replace(/^['"]|['"]$/g, '');
assert.ok(token, 'LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const login = await fetch(`${base}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
assert.equal(login.status, 200, 'LOGIN_FAILED');
cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
csrf = (await login.json()).csrfToken;
assert.ok(cookie && csrf, 'LOGIN_RESPONSE_INVALID');
const readHeaders = { cookie };
const writeHeaders = { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, { method, headers: method === 'GET' ? readHeaders : writeHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `HTTP_${method}_${response.status}:${value?.code ?? path}`);
  return value;
}
async function poll(path, terminal, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    const value = await api(path);
    const state = JSON.stringify({ status: value.status, verdict: value.verdict,
      cases: value.cases?.map(item => [item.caseId, item.state]) });
    if (state !== last) { console.log(JSON.stringify({ stage: label, ...JSON.parse(state) })); last = state; }
    if (terminal.includes(value.status)) return value;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`${label.toUpperCase()}_TIMEOUT`);
}

try {
  if (resumeJobId) evidence.validationTargetImageIds = imageIds();
  else evidence.targetImageIds = imageIds();
  let snapshot;
  let baseline;
  let job;
  if (resumeJobId) {
    evidence.developmentJobId = resumeJobId;
    snapshot = await api(`/api/snapshots/${evidence.snapshotId}`);
    baseline = await api(`/api/baselines/${evidence.baselineId}`);
    job = await api(`/api/development/${resumeJobId}`);
  } else {
  const draft = await api('/api/drafts', 'POST', { name: `TD-15 wealth balance live ${randomUUID().slice(0, 8)}`,
    brief: {
      audience: { value: '企业手机银行用户', source: 'user', confirmed: true },
      goal: { value: '通过受限生成创建只读余额查询 Agent，缺少账户号时追问，接口错误时不编造余额。', source: 'user', confirmed: true },
      output: { value: requestedScope === 'tool' ? '只生成 AccountBalanceTool，Skill 使用平台固定审阅版本。' : requestedScope === 'skill' ? '只生成余额查询 Skill，Tool 使用平台固定审阅版本。' : '生成 AccountBalanceTool 与余额查询 Skill，输出账户、币种、可用余额分、更新时间。', source: 'user', confirmed: true }
    } });
  evidence.draftId = draft.id;
  const assembly = { agentType: 'DeepAgent', maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: [],
    generationProfileVersion: generationProfile.profileVersion,
    systemPrompt: '你是企业理财账户查询助手。缺少账户编号时不得猜测或调用工具，必须追问，并仅输出 JSON：{"kind":"clarification","missingFields":["accountId"],"message":"请提供账户编号"}。有账户编号时，必须先调用 skill_tool 读取 balance-query 的 SKILL.md（skill_name 为 balance-query，relative_file_path 为 SKILL.md），再按 Skill 调用 get_account_balance 获取当前模拟账户事实。成功后仅输出一个 JSON 对象：kind 固定 account-balance；accountId、currency、asOf 为 JSON 字符串，availableBalanceFen 为 JSON 整数，值原样取自工具结果。工具报错、超时或数据缺失时不编造余额、币种或时间，仅输出 JSON：kind 固定 tool-error，code 原样取 TOOL_TIMEOUT 或 TOOL_UNAVAILABLE，message 必须明确余额未知。Agent 只读，不得申购、转账或更改账户数据。' };
  evidence.requestFixture = { source: 'verifier request definition (reconstructed; not a captured HTTP request)', assembly: { agentType: assembly.agentType,
    railIds: assembly.railIds, toolIds: assembly.toolIds, generationProfileVersion: generationProfile.profileVersion,
    generationScope: generationProfile.scope, connectionProfile: 'mock-finance@1' } };
  snapshot = await api(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: draft.revision, assembly });
  evidence.snapshotId = snapshot.id;
  const preview = await api(`/api/drafts/${draft.id}/baseline-preview?templateId=wealth-balance-read%401`);
  assert.equal(preview.content.cases.length, 3, 'WEALTH_BASELINE_CASE_COUNT');
  baseline = await api(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: draft.revision,
    templateId: 'wealth-balance-read@1', expectedDigest: preview.digest, confirmed: true });
  evidence.baselineId = baseline.id;
  evidence.baselineDigest = baseline.digest;
  evidence.baselineCases = baseline.content.cases.map(item => ({ id: item.id, scenario: item.scenario, fault: item.fault }));

  const generation = { profileVersion: generationProfile.profileVersion, scope: generationProfile.scope,
    dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-finance@1' };
  job = await api(`/api/snapshots/${snapshot.id}/development`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id, generation, maxSeconds: 900 });
  evidence.developmentJobId = job.id;
  }
  const built = resumeJobId ? job : await poll(`/api/development/${job.id}`, ['built', 'failed', 'cancelled'], 15 * 60 * 1000, 'generation');
  evidence.development = built;
  const events = (await api(`/api/development/${job.id}/events`)).items;
  evidence.developmentEvents = events;
  const bundle = built.bundle;
  const redEvent = events.find(item => item.type === 'command.completed' && item.data.id === bundle?.unitRedId);
  const greenEvent = events.find(item => item.type === 'command.completed' && item.data.id === bundle?.unitGreenId);
  const commands = [];
  const missingCommandEvidence = [];
  for (const event of events.filter(item => item.type === 'command.completed')) {
    const id = event.data.id ?? event.data.commandId;
    if (id) {
      try { commands.push(await api(`/api/development/${job.id}/commands/${id}`)); }
      catch (error) {
        if (![bundle?.unitRedId, bundle?.unitGreenId].includes(id)) throw error;
        missingCommandEvidence.push(id);
      }
    }
  }
  evidence.firstRed = commands.find(item => item.id === bundle?.unitRedId)
    ?? (redEvent ? { id: bundle.unitRedId, status: redEvent.data.status, exitCode: redEvent.data.exitCode } : null);
  evidence.unitGreen = commands.find(item => item.id === bundle?.unitGreenId)
    ?? (greenEvent ? { id: bundle.unitGreenId, status: greenEvent.data.status, exitCode: greenEvent.data.exitCode } : null);
  evidence.commandEvidenceUnavailableFor = missingCommandEvidence;
  assert.ok(evidence.firstRed, 'TEST_FIRST_RED_EVENT_MISSING');
  assert.ok(evidence.unitGreen, 'UNIT_GREEN_EVENT_MISSING');
  const redact = value => typeof value === 'string' ? value.slice(-4000)
    .replace(/((?:api[_-]?key|token|password)\s*[:=]\s*|authorization\s*[:=]\s*(?:Bearer\s+)?)[^\s,"]+/gi, '$1[REDACTED]') : undefined;
  evidence.commands = commands.map(({ id, commandId, executable, args, exitCode, status, output }) => ({ id, commandId, executable, args, exitCode, status,
    outputTail: redact(output) }));
  assert.equal(built.status, 'built', `GENERATION_${built.diagnostic ?? built.status}`);
  assert.ok(built.bundle, 'GENERATED_BUNDLE_MISSING');
  const relevant = requestedScope === 'skill' ? ['skills/balance-query/SKILL.md', 'src/generated/AccountBalanceTool.java']
    : ['src/generated/AccountBalanceTool.java', 'skills/balance-query/SKILL.md'];
  evidence.generatedFiles = [];
  for (const path of relevant) {
    const file = await api(`/api/development/${job.id}/file?path=${encodeURIComponent(path)}`);
    evidence.generatedFiles.push(file);
  }
  assert.equal(evidence.firstRed.exitCode, 1, 'TEST_FIRST_RED_NOT_PROVEN');
  assert.equal(evidence.unitGreen.exitCode, 0, 'UNIT_GREEN_NOT_PROVEN');
  assert.ok(commands.some(item => item.commandId === 'unit-test' && item.executable === 'java' && item.exitCode === 0)
    || evidence.unitGreen.status === 'passed', 'JAVA_UNIT_TEST_NOT_PROVEN');
  for (const commandId of [bundle.contractCheckId, bundle.buildId]) {
    const result = commands.find(item => item.id === commandId);
    assert.ok(result, `COMMAND_EVIDENCE_MISSING:${commandId}`);
    assert.equal(result.exitCode, 0, `BUILD_STAGE_FAILED:${commandId}`);
  }
  const toolFile = evidence.generatedFiles.find(file => file.path.endsWith('AccountBalanceTool.java'));
  const skillFile = evidence.generatedFiles.find(file => file.path.endsWith('SKILL.md'));
  assert.ok(toolFile?.content.includes('class AccountBalanceTool')
    && toolFile.content.includes('accountId')
    && toolFile.content.includes('transport.invoke('), 'BALANCE_TOOL_INVALID');
  assert.ok(skillFile?.content.length > 50, 'BALANCE_SKILL_EMPTY');
  if (requestedScope === 'tool') assert.equal(bundle.profileVersion, 'wealth-balance-tool-java@1', 'TOOL_ONLY_PROFILE_MISMATCH');
  if (requestedScope === 'skill') assert.equal(bundle.profileVersion, 'wealth-balance-skill-java@1', 'SKILL_ONLY_PROFILE_MISMATCH');
  assert.equal(bundle.runtimeSpec.tools[0]?.operationId, 'getAccountBalance', 'RUNTIME_TOOL_OPERATION_MISMATCH');
  assert.equal(bundle.runtimeSpec.tools[0]?.name, 'get_account_balance', 'RUNTIME_TOOL_NAME_MISMATCH');

  const candidate = await api('/api/candidates', 'POST', { snapshotId: snapshot.id, developmentJobId: job.id });
  evidence.candidate = candidate;
  assert.equal(candidate.provenance, 'generated-component', 'CANDIDATE_NOT_GENERATED');
  assert.equal(candidate.runtimeSpec.tools[0]?.operationId, 'getAccountBalance');
  const validation = await api(`/api/snapshots/${snapshot.id}/validations`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id,
    allowMockWrites: false, candidateId: candidate.id });
  evidence.validationId = validation.id;
  const report = await poll(`/api/validations/${validation.id}`, ['completed'], 10 * 60 * 1000, 'acceptance');
  evidence.validation = report;
  const finalReport = await api(`/api/validations/${validation.id}/report`);
  evidence.report = finalReport;
  evidence.validationEvidence = [];
  for (const item of finalReport.cases ?? []) {
    if (item.evidenceId) evidence.validationEvidence.push(await api(`/api/validations/${validation.id}/evidence/${item.evidenceId}`));
  }
  const observedScopes = [...new Set(evidence.validationEvidence.flatMap(item => item.candidateEvidence ?? [])
    .map(item => item.loadedManifest?.generated?.generatedScope?.join(','))
    .filter(Boolean))].map(scope => scope.split(',').sort());
  evidence.observedGeneratedScopes = observedScopes;
  assert.ok(observedScopes.length > 0 && observedScopes.every(scope => JSON.stringify(scope) === JSON.stringify([...generationProfile.scope].sort())), 'RUNTIME_GENERATED_SCOPE_MISMATCH');
  assert.equal(finalReport.verdict, 'passed', `WEALTH_VALIDATION_${finalReport.verdict}`);
  assert.equal(finalReport.cases.length, 3, 'WEALTH_VALIDATION_CASE_COUNT');
  assert.ok(finalReport.cases.every(item => item.status === 'passed'), 'WEALTH_CASE_FAILURE');
  delete evidence.error;
  evidence.verdict = 'passed';
} catch (error) {
  evidence.verdict = 'failed';
  evidence.error = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ stage: 'failed', error: evidence.error }));
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.finalTargetImageIds = (() => { try { return imageIds(); } catch { return null; } })();
  if (cookie && csrf) await fetch(`${base}/api/auth/session`, { method: 'DELETE', headers: { origin, cookie, 'x-csrf-token': csrf } }).catch(() => {});
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: evidence.verdict, evidencePath, jobId: evidence.developmentJobId, validationId: evidence.validationId }));
}
