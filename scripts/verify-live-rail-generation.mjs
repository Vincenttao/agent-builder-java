import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const baseUrl = (process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const goal = '查询设备状态，并要求每次运行最多 3 次工具调用。';
const origin = process.env.APP_ORIGIN ?? baseUrl;
const composeProject = process.env.TD15_ACCEPTANCE_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const containers = execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', composeProject, 'ps', '-q', 'app', 'runner'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
if (containers.length !== 2) throw new Error('FIXED_APP_RUNNER_TARGET_REQUIRED');
const targetImageIds = execFileSync('docker', ['inspect', '--format', '{{.Image}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
if (!process.env.LOCAL_BOOTSTRAP_TOKEN) throw new Error('LOCAL_BOOTSTRAP_TOKEN_REQUIRED');
const login = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: process.env.LOCAL_BOOTSTRAP_TOKEN }) });
if (!login.ok) throw new Error(`LOGIN_FAILED_${login.status}`);
const csrf = (await login.json()).csrfToken;
const cookie = login.headers.get('set-cookie')?.match(/builder_session=[^;]+/)?.[0];
if (!csrf || !cookie) throw new Error('LOGIN_RESPONSE_INVALID');
const headers = { cookie, origin, 'x-csrf-token': csrf, 'content-type': 'application/json' };
async function request(path, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: method === 'GET' ? { cookie } : headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`API_${method}_${response.status}`);
  return response.status === 204 ? null : response.json();
}
let task;
try {
  const draft = await request('/api/drafts', 'POST', { name: `TDD-023 live Rail ${randomUUID().slice(0, 8)}`, brief: {
    audience: { value: '企业设备平台测试人员', source: 'user', confirmed: true },
    goal: { value: goal, source: 'user', confirmed: true },
    output: { value: '设备状态与受限调用执行证据', source: 'user', confirmed: true }
  } });
  const assembly = { agentType: 'DeepAgent', systemPrompt: `你是设备运维助手。${goal} 缺少设备编号时追问；有编号时通过 get_equipment 查询，不得编造事实。`, maxIterations: 4, railIds: ['audit@1', 'tool-allowlist@1'], toolIds: ['equipment-status@1'] };
  const snapshot = await request(`/api/drafts/${draft.id}/snapshots`, 'POST', { expectedRevision: 1, assembly });
  const preview = await request(`/api/drafts/${draft.id}/baseline-preview?templateId=equipment-read%401`);
  const baseline = await request(`/api/drafts/${draft.id}/baselines`, 'POST', { expectedRevision: 1, templateId: 'equipment-read@1', expectedDigest: preview.digest, confirmed: true });
  task = await request(`/api/snapshots/${snapshot.id}/development`, 'POST', { clientRequestId: randomUUID(), baselineId: baseline.id,
    generation: { profileVersion: 'equipment-java@3', scope: ['tool', 'skill', 'rail'], dependencies: ['openjiuwen-core@0.1.17', 'agent-builder-bridge@0.1.0'], connectionProfile: 'mock-equipment@1' }, maxSeconds: 900 });
  const deadline = Date.now() + 16 * 60 * 1000;
  while (Date.now() < deadline && !['built', 'failed', 'cancelled', 'reconciling'].includes(task.status)) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    task = await request(`/api/development/${task.id}`);
  }
  const evidence = { schemaVersion: 1, verifiedAt: new Date().toISOString(), baseUrl, composeProject, targetImageIds, goal, snapshotId: snapshot.id, baselineId: baseline.id,
    jobId: task.id, taskStatus: task.status, diagnostic: task.diagnostic ?? null, roles: task.roles,
    ...(task.bundle ? { bundle: { digest: task.bundle.digest, artifactDigest: task.bundle.artifactDigest, profileDigest: task.bundle.profileDigest,
      planDigest: task.bundle.planDigest, railDefinition: task.bundle.railDefinition, runtimeSpec: task.bundle.runtimeSpec,
      files: task.bundle.files.map(({ path, digest, size }) => ({ path, digest, size })) } } : {}) };
  if (task.status === 'built') {
    const [definitionFile, planFile] = await Promise.all([
      request(`/api/development/${task.id}/file?path=rails%2Fdefinition.json`),
      request(`/api/development/${task.id}/file?path=test-plan.json`)
    ]);
    const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
    evidence.files = { railDefinitionDigest: definitionFile.digest, railDefinitionMatchesBundle: stable(JSON.parse(definitionFile.content)) === stable(task.bundle.railDefinition), testPlanDigest: planFile.digest };
  }
  await mkdir('docs/implementation/evidence', { recursive: true });
  const evidencePath = `docs/implementation/evidence/TDD-023-live-rail-generation-${task.id}.json`;
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ jobId: task.id, status: task.status, diagnostic: task.diagnostic ?? null,
    roles: task.roles.map(({ role, status }) => ({ role, status })), railDefinition: task.bundle?.railDefinition ?? null,
    runtimeRails: task.bundle?.runtimeSpec?.agent.rails ?? null, evidence: evidencePath }, null, 2) + '\n');
  if (task.status !== 'built') process.exitCode = 1;
} finally {
  await fetch(`${baseUrl}/api/auth/session`, { method: 'DELETE', headers }).catch(() => {});
}
