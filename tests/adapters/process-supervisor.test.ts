import { describe, expect, it } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startManagedProcess } from '../../apps/runner/src/processes/supervisor.js';

describe('TD-08 managed process adapter', () => {
  it('confirms parent and managed descendant stop before returning cancelled', async () => {
    const directory = resolve('.cache/process-tests', randomUUID()); await mkdir(directory, { recursive: true });
    const output = resolve(directory, 'child-output.txt');
    const code = `const {spawn}=require('node:child_process'); const p=spawn(process.execPath,['-e',${JSON.stringify(`const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(output)},'.'),25)`)}],{stdio:'inherit'}); console.log('child-started');setInterval(()=>{},1000);`;
    const logs: string[] = [];
    const process = startManagedProcess({ executable: globalThis.process.execPath, args: ['-e', code], cwd: directory,
      env: {}, secrets: [], onLine: line => logs.push(line) });
    try {
      await expect.poll(async () => (await readFile(output, 'utf8').catch(() => '')).length, { timeout: 5000 }).toBeGreaterThan(1);
      await process.stop();
      expect(process.state()).toBe('stopped');
      const before = await readFile(output, 'utf8');
      await new Promise(r => setTimeout(r, 150));
      expect(await readFile(output, 'utf8')).toBe(before);
      await process.stop(); // Idempotent; cannot kill another unrelated PID.
    } finally { await process.stop(); }
  });
  it('redacts credentials split across stdout chunks and reports actual nonzero exit', async () => {
    const logs: string[] = [];
    const process = startManagedProcess({ executable: globalThis.process.execPath,
      args: ['-e', `process.stdout.write('fake-sec');setTimeout(()=>{process.stdout.write('ret-sentinel\\n');process.stderr.write('failure fake-secret-sentinel\\n');process.exitCode=7},40)`],
      cwd: resolve('.'), env: {}, secrets: ['fake-secret-sentinel'], onLine: line => logs.push(line) });
    const exit = await process.exited;
    expect(exit.code).toBe(7);
    expect(logs.join('\n')).not.toContain('fake-secret-sentinel');
    expect(logs.join('\n')).toContain('[REDACTED]');
  });
  it('does not count a missing executable as a successfully stopped process', async () => {
    const process = startManagedProcess({ executable: 'agent-builder-nonexistent-executable', args: [], cwd: resolve('.'), env: {}, secrets: [], onLine: () => {} });
    expect(await process.exited).toMatchObject({ code: null, error: 'PROCESS_START_FAILED' });
    expect(process.state()).toBe('failed');
  });
});
