import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app.js';
import { DraftService } from '../../apps/server/src/drafts/application/draft-service.js';
import { MemoryDraftRepository } from '../support/memory-drafts.js';
import { draftInput } from '../support/fixtures.js';
import { randomUUID } from 'node:crypto';
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const origin = 'http://127.0.0.1:8080';
const token = 'test-bootstrap-token-32-characters';
function setup(overrides = {}) {
  const options = {
    drafts: new DraftService(new MemoryDraftRepository(), { now: () => '2026-10-22T01:00:00Z' }, { next: randomUUID }),
    databaseReady: async () => true, now: () => '2026-10-22T01:00:00Z', bootstrapToken: token, origin, modelConfigured: false,
    ...overrides
  };
  const app = createApp(options); apps.push(app); return app;
}
async function login(app: ReturnType<typeof createApp>) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin }, payload: { token } });
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  return { cookie, origin, 'x-csrf-token': response.json().csrfToken as string };
}
describe('TD-01 HTTP 契约与本地工作台保护', () => {
  it('release admission accepts only an explicit target and returns an asynchronous operation',async()=>{
    let calls=0;const id=crypto.randomUUID();const body={clientRequestId:crypto.randomUUID(),snapshotId:crypto.randomUUID(),validationId:crypto.randomUUID(),expectedRevision:0};
    const releases={start:async(agentId:string,input:unknown)=>{calls++;expect(agentId).toBe(id);expect(input).toEqual(body);return{id:'operation',status:'queued'};}} as unknown as NonNullable<Parameters<typeof createApp>[0]['releases']>;
    const app=setup({releases});const headers=await login(app);
    expect((await app.inject({method:'POST',url:`/api/drafts/${id}/releases`,headers,payload:{...body,status:'succeeded',verdict:'passed'}})).statusCode).toBe(400);expect(calls).toBe(0);
    const response=await app.inject({method:'POST',url:`/api/drafts/${id}/releases`,headers,payload:body});expect(response.statusCode).toBe(202);expect(response.json().status).toBe('queued');expect(calls).toBe(1);
    expect((await app.inject({method:'POST',url:`/api/drafts/${id}/releases`,headers:{cookie:headers.cookie,origin},payload:body})).statusCode).toBe(403);
  });
  it('未登录无法读取草稿', async () => {
    const r = await setup().inject({ method: 'GET', url: '/api/drafts' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ code: 'UNAUTHENTICATED', correlationId: expect.any(String), details: null });
  });
  it('错误本地令牌不得创建会话', async () => {
    const r = await setup().inject({ method: 'POST', url: '/api/auth/session', headers: { origin }, payload: { token: 'wrong' } });
    expect(r.statusCode).toBe(401);
  });
  it('AC-01: 未配置模型仍能保存和恢复完整草稿', async () => {
    const app = setup(); const headers = await login(app);
    const r = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: draftInput });
    expect(r.statusCode).toBe(201);
    const saved = r.json();
    const restored = await app.inject({ method: 'GET', url: `/api/drafts/${saved.id}`, headers });
    expect(restored.json()).toMatchObject({ ...draftInput, revision: 1 });
  });
  it('AC-01/42a: 环境说明无沙箱，运行被阻塞并定位模型和 Runtime', async () => {
    const app = setup(); const headers = await login(app);
    const status = await app.inject({ method: 'GET', url: '/api/environment', headers });
    expect(status.json()).toMatchObject({ executionMode: 'trusted-local', sandboxEnabled: false, canSaveDraft: true, canRun: false, checkedAt: expect.any(String) });
    const saved = (await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: draftInput })).json();
    const run = await app.inject({ method: 'POST', url: `/api/drafts/${saved.id}/runs`, headers, payload: {} });
    expect(run.statusCode).toBe(409);
    expect(run.json().details.blockers.map((b: {code: string}) => b.code)).toEqual(expect.arrayContaining(['MODEL_NOT_CONFIGURED', 'RUNTIME_NOT_IMPLEMENTED']));
    expect(run.json()).not.toHaveProperty('runId');
  });
  it('有模型凭据不表示实际连通，更不表示 Runtime 可运行', async () => {
    const app = setup({ modelConfigured: true }); const headers = await login(app);
    const status = (await app.inject({ method: 'GET', url: '/api/environment', headers })).json();
    expect(status).toMatchObject({ model: 'configured_unverified', runtime: 'not_implemented', canRun: false });
  });
  it.each(['production', 'unknown'])('AC-42a: 拒绝 %s 业务连接类型', async kind => {
    const app = setup(); const headers = await login(app);
    const r = await app.inject({ method: 'POST', url: '/api/connection-bindings', headers, payload: { kind, profile: 'anything' } });
    expect(r.statusCode).toBe(422); expect(r.json().code).toBe('CONNECTION_TYPE_NOT_ALLOWED');
  });
  it('Mock 尚未接入时不虚构已连接的资产', async () => {
    const app = setup(); const headers = await login(app);
    const r = await app.inject({ method: 'POST', url: '/api/connection-bindings', headers, payload: { kind: 'mock', profile: 'finance' } });
    expect(r.statusCode).toBe(409); expect(r.json().code).toBe('MOCK_NOT_IMPLEMENTED');
  });
  it('不静默删除未知字段或把类型错误转换为有效输入', async () => {
    const app = setup(); const headers = await login(app);
    for (const payload of [{ ...draftInput, apiKey: 'must-not-echo' }, { ...draftInput, name: 100 }, { ...draftInput, name: '   ' }]) {
      const r = await app.inject({ method: 'POST', url: '/api/drafts', headers, payload });
      expect(r.statusCode).toBe(400); expect(r.json().code).toBe('INVALID_REQUEST');
      expect(r.body).not.toContain('must-not-echo');
    }
  });
  it('旧修订更新返回 409，保留最新草稿', async () => {
    const app = setup(); const headers = await login(app);
    const saved = (await app.inject({ method: 'POST', url: '/api/drafts', headers, payload: draftInput })).json();
    const url = `/api/drafts/${saved.id}`;
    const first = await app.inject({ method: 'PUT', url, headers, payload: { ...draftInput, name: 'new', expectedRevision: 1 } });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({ method: 'PUT', url, headers, payload: { ...draftInput, expectedRevision: 1 } });
    expect(stale.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url, headers })).json().name).toBe('new');
  });
  it('跨来源和缺 CSRF 的写入均拒绝', async () => {
    const app = setup(); const headers = await login(app);
    for (const invalid of [{ ...headers, origin: 'https://evil.example' }, { ...headers, 'x-csrf-token': '' }]) {
      const r = await app.inject({ method: 'POST', url: '/api/drafts', headers: invalid, payload: draftInput });
      expect(r.statusCode).toBe(403);
    }
  });
  it('退出后旧会话失效', async () => {
    const app = setup(); const headers = await login(app);
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/session', headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/drafts', headers })).statusCode).toBe(401);
  });
  it('数据库故障应显示未就绪；错误不泄露底层凭据', async () => {
    const app = setup({ databaseReady: async () => false }); const headers = await login(app);
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: '/api/environment', headers })).json()).toMatchObject({ database: 'unavailable', canSaveDraft: false });
  });
  it('内部异常不把连接字符串或密钥返回给浏览器', async () => {
    const service = new DraftService(new MemoryDraftRepository(), { now: () => '' }, { next: randomUUID });
    service.list = async () => { throw new Error('postgres://secret-credential'); };
    const app = setup({ drafts: service }); const headers = await login(app);
    const r = await app.inject({ method: 'GET', url: '/api/drafts', headers });
    expect(r.statusCode).toBe(500); expect(r.json().code).toBe('INTERNAL_ERROR');
    expect(r.body).not.toContain('secret-credential');
  });
});
