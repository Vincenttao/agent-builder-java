import { spawn } from 'node:child_process';

export interface ManagedProcessOptions {
  executable: string; args: string[]; cwd: string; env: Record<string, string>;
  secrets: string[]; onLine: (line: string, stream: 'stdout' | 'stderr') => void;
}
export interface ProcessExit { code: number | null; signal: string | null; error?: string }
type ProcessState = 'starting' | 'running' | 'stopping' | 'stopped' | 'exited' | 'failed';

/** Owns the child handle and its process tree. Never kills a PID restored from a state file. */
export function startManagedProcess(options: ManagedProcessOptions) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|SYSTEMROOT|WINDIR|JAVA_HOME|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(name)));
  const child = spawn(options.executable, options.args, { cwd: options.cwd, env: { ...inherited, ...options.env },
    shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let state: ProcessState = 'starting';
  let stopRequested = false;
  let startError = false;
  let closeObserved = false;
  let stopping: Promise<void> | undefined;
  const secrets = options.secrets.filter(Boolean).sort((a, b) => b.length - a.length);
  const write = (line: string, stream: 'stdout' | 'stderr') => {
    for (const secret of secrets) line = line.replaceAll(secret, '[REDACTED]');
    options.onLine(line, stream);
  };
  const attach = (stream: 'stdout' | 'stderr') => {
    let pending = ''; let truncating = false;
    child[stream].setEncoding('utf8');
    child[stream].on('data', (chunk: string) => {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (truncating || line.length > 65536) write('[LOG_LINE_TRUNCATED]', stream); else write(line.replace(/\r$/, ''), stream);
        truncating = false;
      }
      // Drop an oversized unfinished line as a whole, never flush a partial secret.
      if (pending.length > 65536) { pending = ''; truncating = true; }
    });
    child[stream].on('end', () => {
      if (truncating) write('[LOG_LINE_TRUNCATED]', stream); else if (pending) write(pending, stream);
    });
  };
  attach('stdout'); attach('stderr');
  const started = new Promise<void>(resolve => {
    child.once('spawn', () => { state = 'running'; resolve(); });
    child.once('error', () => { startError = true; state = 'failed'; resolve(); });
  });
  const exited = new Promise<ProcessExit>(resolve => {
    child.once('close', (code, signal) => {
      closeObserved = true;
      state = startError ? 'failed' : stopRequested ? 'stopped' : code === 0 ? 'exited' : 'failed';
      resolve(startError ? { code: null, signal, error: 'PROCESS_START_FAILED' } : { code, signal });
    });
  });
  async function stopOwnedTree() {
    await started;
    if (closeObserved || startError || !child.pid) return;
    stopRequested = true; state = 'stopping';
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      const code = await new Promise<number | null>((resolve, reject) => { killer.once('close', resolve); killer.once('error', reject); });
      // Windows can report a missing process after the child has exited but before
      // Node delivers its close event. In that race, require the close evidence below.
      // A failed taskkill still fails the stop if the owned handle does not close.
      if (code !== 0 && closeObserved) return;
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (!closeObserved && (error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PROCESS_STOP_UNCONFIRMED')), 5000); })]);
    } finally { clearTimeout(timer); }
  }
  return { pid: child.pid, exited, state: () => state, stop: () => stopping ??= stopOwnedTree() };
}
