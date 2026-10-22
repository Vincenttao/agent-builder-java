import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const executable = resolve('apps/runner/node_modules/opencode-ai/bin/opencode.exe');
const directory = resolve('.cache/opencode-probe');
await mkdir(directory, { recursive: true });
const version = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
if (version.status !== 0) throw new Error('OpenCode binary unavailable; rebuild the runner toolchain');
const started = Date.now();
const child = spawn(executable, ['--print-logs', '--log-level', 'DEBUG', 'run', '--format', 'json', '--model', 'deepseek-local/deepseek-v4-flash', 'Reply exactly OPEN_CODE_PROBE_OK. Do not use tools or read any files.'], {
  cwd: directory, windowsHide: true,
  env: {
    ...process.env,
    OPENCODE_CONFIG: resolve('opencode.json'),
    XDG_CONFIG_HOME: resolve('.cache/opencode-config'),
    XDG_DATA_HOME: resolve('.cache/opencode-data'),
    XDG_CACHE_HOME: resolve('.cache/opencode-cache'),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { '*': 'deny' }, autoupdate: false })
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
let diagnostics = '';
child.stdout.on('data', chunk => { if (output.length < 2_000_000) output += chunk; });
child.stderr.on('data', chunk => { if (diagnostics.length < 2_000_000) diagnostics += chunk; });
let timedOut = false;
const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 120000);
const exitCode = await new Promise((resolveExit, reject) => { child.once('close', resolveExit); child.once('error', reject); });
clearTimeout(timeout);
const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const response = events.filter(event => event.type === 'text').map(event => event.part?.text ?? '').join('').trim();
const safeError = value => JSON.stringify(value ?? {}).replaceAll(process.env.DEEPSEEK_API_KEY ?? '__unset__', '[redacted]').replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]').slice(0, 800);
const result = {
  executionMode: 'live-engine', engineVersion: version.stdout.trim(), requestedModel: 'deepseek-local/deepseek-v4-flash',
  checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started, exitCode, timedOut,
  responseVerified: response === 'OPEN_CODE_PROBE_OK', eventTypes: [...new Set(events.map(event => event.type))],
  toolEventCount: events.filter(event => event.type === 'tool_use').length,
  errors: events.filter(event => event.type === 'error').map(event => safeError(event.error))
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/opencode-live.json', JSON.stringify(result, null, 2));
await writeFile('.cache/opencode-probe-diagnostics.log', diagnostics.replaceAll(process.env.DEEPSEEK_API_KEY ?? '__unset__', '[redacted]').replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]'));
console.log(JSON.stringify(result));
if (exitCode !== 0 || timedOut || !result.responseVerified || result.toolEventCount !== 0) process.exitCode = 1;
