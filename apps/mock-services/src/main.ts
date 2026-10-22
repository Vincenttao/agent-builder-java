import { Pool } from 'pg';
import { createMockApp } from './app.js';
import { MockRepository } from './repository.js';
const pool = new Pool({ connectionString: process.env.MOCK_DATABASE_URL, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
pool.on('error', () => console.error(JSON.stringify({ code: 'MOCK_DATABASE_UNAVAILABLE' })));
if (!process.env.MOCK_DATABASE_URL) throw new Error('MOCK_DATABASE_URL is required');
const app = createMockApp({ repository: new MockRepository(pool), controlToken: process.env.MOCK_CONTROL_TOKEN ?? '', businessToken: process.env.MOCK_SERVICE_TOKEN ?? '' });
app.addHook('onClose', async () => { await pool.end(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
try { await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.MOCK_PORT ?? 8082) }); console.log(JSON.stringify({ event: 'mock.ready' })); }
catch { console.error(JSON.stringify({ code: 'MOCK_START_FAILED' })); await app.close(); process.exitCode = 1; }
