import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../../packages/contracts/src/canonical.js';
import type { RuntimeModelProfile } from '../../../../packages/contracts/src/model-profile.js';
export function runtimeModelProfile(base = 'https://api.deepseek.com/v1'): RuntimeModelProfile {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('MODEL_ENDPOINT_REJECTED');
  const baseUrl = url.href.replace(/\/$/, '');
  const executionMode = baseUrl === 'https://api.deepseek.com/v1' ? 'live-mock' : ['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? 'simulated' : 'unverified';
  const model: RuntimeModelProfile['model'] = { provider: 'OpenAI', baseUrl, name: 'deepseek-v4-flash', temperature: 0, maxTokens: 1024, thinking: 'disabled' };
  return { executionMode, model, digest: createHash('sha256').update(canonicalJson({ executionMode, model })).digest('hex') };
}
