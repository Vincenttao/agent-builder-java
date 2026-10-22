import { expect, it, vi } from 'vitest';
import { probeModel } from './probe.js';
const config = { apiKey: 'test-credential-never-log', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' };
it('模型探测使用指定模型并校验实际工具调用参数，保留返回的模型名', async () => {
  const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ model: 'served-version', choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'report_probe', arguments: '{"status":"ok"}' } }] } }] })));
  expect(await probeModel(config, fake)).toMatchObject({ requestedModel: config.model, servedModel: 'served-version', toolCalling: true });
  const [url, init] = fake.mock.calls[0]!;
  expect(url).toBe('https://api.deepseek.com/chat/completions');
  expect(JSON.parse(String(init?.body))).toMatchObject({ model: config.model, max_tokens: 128, stream: false });
});
it('鉴权失败不泄漏供应商响应和密钥', async () => {
  const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-provider-body', { status: 401 }));
  await expect(probeModel(config, fake)).rejects.toMatchObject({ code: 'MODEL_AUTH_FAILED' });
});
it('模型只说成功但没有工具调用时不可标记支持工具', async () => {
  const fake = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ model: 'x', choices: [{ message: { content: 'success' } }] })));
  await expect(probeModel(config, fake)).rejects.toMatchObject({ code: 'MODEL_TOOL_PROBE_FAILED' });
});
it('不把已提供的 DeepSeek 密钥发送到其他域名', async () => {
  const fake = vi.fn<typeof fetch>();
  await expect(probeModel({ ...config, baseUrl: 'https://other.example' }, fake)).rejects.toMatchObject({ code: 'MODEL_ENDPOINT_REJECTED' });
  expect(fake).not.toHaveBeenCalled();
});
