import { randomBytes } from 'node:crypto';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
let existing = {};
try { existing = parseEnv(await readFile('.env.local', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const secret = () => randomBytes(32).toString('hex');
const password = existing.POSTGRES_PASSWORD ?? secret();
const mockPassword = existing.MOCK_DB_PASSWORD ?? secret();
const defaults = {
  POSTGRES_PASSWORD: password, DATABASE_URL: `postgres://builder:${password}@127.0.0.1:15433/builder`,
  LOCAL_BOOTSTRAP_TOKEN: secret(), APP_PORT: '8080', APP_ORIGIN: 'http://127.0.0.1:8080',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_MODEL: 'deepseek-v4-flash', DEEPSEEK_API_KEY: '',
  RUNNER_CONTROL_TOKEN: secret(), TOOL_PROXY_TOKEN: secret(), MOCK_CONTROL_TOKEN: secret(), MOCK_SERVICE_TOKEN: secret(),
  MOCK_DB_PASSWORD: mockPassword, MOCK_DATABASE_URL: `postgres://builder_mock:${mockPassword}@127.0.0.1:15433/builder_mock`,
  RUNNER_BASE_URL: 'http://127.0.0.1:8081', MOCK_BASE_URL: 'http://127.0.0.1:8082'
};
const missing = Object.entries(defaults).filter(([key]) => !(key in existing));
if (missing.length) {
  const text = missing.map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  if (Object.keys(existing).length) await appendFile('.env.local', '\n' + text);
  else await writeFile('.env.local', text, { flag: 'wx', mode: 0o600 });
}
console.log(`Local configuration ready; added ${missing.length} missing entries. Existing values preserved.`);
