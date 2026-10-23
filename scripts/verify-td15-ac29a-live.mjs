import { execFileSync } from 'node:child_process';

const project = 'agent-builder-td15-ac29a';
const base = 'http://127.0.0.1:18084';
const composeEnv = { ...process.env, APP_PORT: '18084', APP_ORIGIN: base };
const compose = (...args) => execFileSync('docker', ['compose', '--env-file', '.env.local', '-p', project, '-f', 'compose.yaml', ...args], {
  encoding: 'utf8', windowsHide: true, stdio: 'pipe', env: composeEnv, maxBuffer: 2 * 1024 * 1024
});
const run = (script, env = process.env) => execFileSync(process.execPath, ['--env-file-if-exists=.env.local', script], {
  windowsHide: true, stdio: 'inherit', env
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  run('scripts/verify-td15-ac29a-cancel-child-process.mjs');
  compose('up', '-d', '--no-build');
  const deadline = Date.now() + 360000;
  let healthy = false;
  while (Date.now() < deadline) {
    const containers = compose('ps', '-q', 'app', 'runner').toString().trim().split(/\r?\n/).filter(Boolean);
    if (containers.length === 2) {
      const statuses = execFileSync('docker', ['inspect', '--format', '{{.State.Health.Status}}', ...containers], { encoding: 'utf8' }).trim().split(/\r?\n/);
      if (statuses.every(status => status === 'healthy')) { healthy = true; break; }
    }
    await wait(2000);
  }
  if (!healthy) throw new Error('AC29A_ISOLATED_STACK_HEALTH_TIMEOUT');
  run('scripts/verify-td15-ac29a-budget-restart.mjs', { ...process.env, AC29A_BASE_URL: base, AC29A_ORIGIN: base,
    TD15_ACCEPTANCE_COMPOSE_PROJECT: project });
} finally {
  try { compose('down', '-v'); } catch {}
}
