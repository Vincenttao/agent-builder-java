import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const project = process.env.NF04_COMPOSE_PROJECT ?? 'agent-builder-td15-nf01';
const base = process.env.NF04_BASE_URL ?? 'http://127.0.0.1:18080';
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, ...args], { encoding: 'utf8' }).trim();
const ids = compose('ps', '-aq').split(/\r?\n/).filter(Boolean);
if (!ids.length) throw new Error('NF04_COMPOSE_CONTAINERS_REQUIRED');
const inspected = JSON.parse(execFileSync('docker', ['inspect', ...ids], { encoding: 'utf8' }));
const containers = inspected.map(item => ({
  service: item.Config.Labels['com.docker.compose.service'],
  status: item.State.Status,
  imageId: item.Image,
  driver: item.HostConfig.LogConfig.Type,
  options: item.HostConfig.LogConfig.Config
})).sort((a, b) => a.service.localeCompare(b.service));
const required = ['app', 'migrate', 'mock-services', 'postgres', 'runner'];
const allContainersConfigured = required.every(service => {
  const item = containers.find(container => container.service === service);
  return item?.driver === 'json-file' && item.options['max-size'] === '10m' && item.options['max-file'] === '3';
});
const readiness = await fetch(`${base}/health/ready`).then(response => response.ok ? 'ready' : `http-${response.status}`).catch(() => 'unavailable');
const evidence = { schemaVersion: 1, requirement: 'TD-15/NF-04 configured container log retention', executionMode: 'isolated-live-docker', measuredAt: new Date().toISOString(), composeProject: project,
  policy: { driver: 'json-file', maxSize: '10m', maxFiles: '3', perContainerMaximumApproxBytes: 30 * 1024 * 1024 }, containers, appReadiness: readiness, allContainersConfigured,
  boundary: 'Docker container logs have bounded rotation. Business Run events use separate persistence and are not shown to have a TTL by this evidence.',
  verdict: allContainersConfigured && readiness === 'ready' ? 'passed' : 'failed' };
await mkdir('docs/implementation/evidence', { recursive: true });
await writeFile('docs/implementation/evidence/TD15-NF04-retention-config.json', JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(JSON.stringify(evidence) + '\n');
if (evidence.verdict !== 'passed') process.exitCode = 1;
