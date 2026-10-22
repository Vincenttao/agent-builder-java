import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ExecutionJournal, type ExecutionRuntime } from './journal.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'builder-journal-'));
  let calls = 0; let finish: (value: unknown) => void = () => {}; let reject: (error: Error) => void = () => {};
  const runtime: ExecutionRuntime = {
    query: async () => { calls++; return new Promise((resolve, fail) => { finish = resolve; reject = fail; }); },
    events: async () => [{ event: 'model_call' }], stop: async () => { reject(new Error('stopped')); },
    cancelSession: async () => { reject(new Error('cancelled')); return { status: 'cancelled' }; }
  };
  const journal = new ExecutionJournal(root, runtime); await journal.initialize();
  return { root, runtime, journal, calls: () => calls, finish: (value: unknown) => finish(value) };
}
const request = () => ({ deploymentId: randomUUID(), sessionId: randomUUID(), message: '查询设备' });
describe('persistent execution request journal', () => {
  it('retains only the current session events in its execution evidence', async () => {
    const h = await setup(); const id = randomUUID(); let done = false;
    h.runtime.events = async () => done ? [{ event: { sessionId: id, event: 'assistant_output', content: 'mine' } }, { event: { sessionId: 'another-session', event: 'assistant_output', content: 'private other output' } }] : [];
    await h.journal.begin(id, { ...request(), sessionId: id }); await expect.poll(h.calls).toBe(1);
    done = true; h.finish({ output: 'done' }); await expect.poll(async () => (await h.journal.get(id)).status).toBe('succeeded');
    const events = (await h.journal.get(id)).events; expect(events).toHaveLength(1); expect(JSON.stringify(events)).not.toContain('private other output');
  });
  it('pauses native tool calls, deduplicates resume without replaying the initial task, and preserves decisions after restart', async () => {
    const h = await setup(); const id = randomUUID(); let resumes = 0;
    h.runtime.resume = async () => { resumes++; return { result: { content: 'WO-001' } }; };
    await h.journal.begin(id, request()); await expect.poll(h.calls).toBe(1);
    h.finish({ result: { _interrupt: { toolCallId: 'call-write', toolName: 'create_work_order' } } });
    await expect.poll(async () => (await h.journal.get(id)).status).toBe('waiting_confirmation');
    const resume = { resumeId: randomUUID(), toolCallId: 'call-write', approved: true };
    await expect(h.journal.resume(id, { ...resume, toolCallId: 'another-call' })).rejects.toMatchObject({ code: 'RESUME_CALL_MISMATCH' });
    await Promise.all([h.journal.resume(id, resume), h.journal.resume(id, resume)]);
    await expect.poll(async () => (await h.journal.get(id)).status).toBe('succeeded');
    expect(h.calls()).toBe(1); expect(resumes).toBe(1);
    const recovered = new ExecutionJournal(h.root, h.runtime); await recovered.initialize();
    expect((await recovered.resume(id, resume)).status).toBe('succeeded'); expect(resumes).toBe(1);
    await expect(recovered.resume(id, { ...resume, approved: false })).rejects.toMatchObject({ code: 'RESUME_INPUT_CONFLICT' });
  });
  it('marks waiting sessions interrupted after a Runner restart rather than silently replaying the task', async () => {
    const h = await setup(); const id = randomUUID(); await h.journal.begin(id, request()); await expect.poll(h.calls).toBe(1);
    h.finish({ result: { _interrupt: { toolCallId: 'call-write' } } });
    await expect.poll(async () => (await h.journal.get(id)).status).toBe('waiting_confirmation');
    const recovered = new ExecutionJournal(h.root, h.runtime); await recovered.initialize();
    expect((await recovered.get(id)).status).toBe('interrupted'); expect(h.calls()).toBe(1);
  });
  it('concurrent identical submissions run once, retain result and recover it without replay', async () => {
    const h = await setup(); const id = randomUUID(); const input = request();
    const [first, duplicate] = await Promise.all([h.journal.begin(id, input), h.journal.begin(id, input)]);
    expect(first.id).toBe(duplicate.id);
    await expect.poll(h.calls).toBe(1);
    h.finish({ output: '设备状态已查询' });
    await expect.poll(async () => (await h.journal.get(id)).status).toBe('succeeded');
    const finished = await h.journal.get(id);
    const recovered = new ExecutionJournal(h.root, h.runtime); await recovered.initialize();
    expect(await recovered.begin(id, input)).toEqual(finished);
    expect(h.calls()).toBe(1);
    await expect(recovered.begin(id, { ...input, message: '不同输入' })).rejects.toMatchObject({ code: 'EXECUTION_INPUT_CONFLICT' });
  });
  it('persists the execution before invoking the runtime', async () => {
    const h = await setup(); const id = randomUUID();
    await h.journal.begin(id, request());
    expect(JSON.parse(await readFile(join(h.root, `${id}.json`), 'utf8')).status).toBe('running');
    h.finish({ output: 'done' });
    await expect.poll(async () => (await h.journal.get(id)).status).toBe('succeeded');
  });
  it('marks interrupted requests for reconciliation after restart and does not replay', async () => {
    const h = await setup(); const id = randomUUID(); const input = request();
    await h.journal.begin(id, input);
    const saved = JSON.parse(await readFile(join(h.root, `${id}.json`), 'utf8'));
    const restoredRoot = await mkdtemp(join(tmpdir(), 'builder-journal-restart-'));
    await writeFile(join(restoredRoot, `${id}.json`), JSON.stringify(saved));
    const recovered = new ExecutionJournal(restoredRoot, h.runtime); await recovered.initialize();
    expect((await recovered.begin(id, input)).status).toBe('interrupted');
    expect(h.calls()).toBe(1);
    h.finish({ output: 'original completes separately' });
    await expect.poll(async () => (await h.journal.get(id)).status).toBe('succeeded');
  });
  it('cancelled is only recorded after the runtime confirms stop', async () => {
    const h = await setup(); const id = randomUUID(); await h.journal.begin(id, request());
    await h.journal.cancel(id);
    expect((await h.journal.get(id)).status).toBe('cancelled');
    expect((await h.journal.get(id)).result).toBeUndefined();
  });
});
