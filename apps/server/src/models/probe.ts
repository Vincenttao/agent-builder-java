import { AppError } from '../shared/errors.js';
export interface ProbeConfig { apiKey: string; baseUrl: string; model: string }
export interface ProbeResult { requestedModel: string; servedModel: string; toolCalling: boolean; checkedAt: string }
export async function probeModel(config: ProbeConfig, fetcher: typeof fetch = fetch): Promise<ProbeResult> {
  if (config.baseUrl !== 'https://api.deepseek.com' && config.baseUrl !== 'https://api.deepseek.com/v1') {
    throw new AppError('MODEL_ENDPOINT_REJECTED', 'DeepSeek 凭据只能发送到已指定的服务端点', 422);
  }
  if (!config.apiKey) throw new AppError('MODEL_NOT_CONFIGURED', '模型凭据未配置', 409);
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model, messages: [{ role: 'user', content: 'Call report_probe once with status ok.' }],
        tools: [{ type: 'function', function: { name: 'report_probe', description: 'Report the connectivity probe result.', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } }, required: ['status'], additionalProperties: false } } }],
        tool_choice: { type: 'function', function: { name: 'report_probe' } },
        thinking: { type: 'disabled' }, stream: false, max_tokens: 128
      })
    });
  } catch { throw new AppError('MODEL_UNAVAILABLE', '模型服务连接失败或超时', 503); }
  if (response.status === 401 || response.status === 403) throw new AppError('MODEL_AUTH_FAILED', '模型鉴权失败', 502);
  if (!response.ok) throw new AppError('MODEL_HTTP_ERROR', '模型服务拒绝探测请求', 502, { upstreamStatus: response.status });
  try {
    const body = await response.json() as { model?: unknown; choices?: { message?: { tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[] } }[] };
    const calls = body.choices?.[0]?.message?.tool_calls;
    const call = calls?.[0]?.function;
    if (calls?.length !== 1 || call?.name !== 'report_probe' || typeof call.arguments !== 'string' || typeof body.model !== 'string' || body.model.length > 200) throw new Error('Invalid probe response');
    const args = JSON.parse(call.arguments) as Record<string, unknown>;
    if (args.status !== 'ok' || Object.keys(args).length !== 1) throw new Error('Invalid tool arguments');
    return { requestedModel: config.model, servedModel: body.model, toolCalling: true, checkedAt: new Date().toISOString() };
  } catch { throw new AppError('MODEL_TOOL_PROBE_FAILED', '模型未按契约生成工具调用', 502); }
}
