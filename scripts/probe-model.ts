import { mkdir, writeFile } from 'node:fs/promises';
import { probeModel } from '../apps/server/src/models/probe.js';
import { AppError } from '../apps/server/src/shared/errors.js';
try {
  const result = await probeModel({ apiKey: process.env.DEEPSEEK_API_KEY ?? '', baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', model: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash' });
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/model-live.json', JSON.stringify({ executionMode: 'live', ...result }, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify(error instanceof AppError ? { code: error.code, message: error.message, details: error.details } : { code: 'PROBE_FAILED' }));
  process.exitCode = 1;
}
