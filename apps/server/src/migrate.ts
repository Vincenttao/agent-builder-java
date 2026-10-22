import { Pool } from './db/pool.js';
import { migrate } from './db/migrations.js';
import { provisionMockDatabase } from './db/mock-database.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await migrate(pool);
  if (process.env.MOCK_DATABASE_URL && process.env.MOCK_DB_PASSWORD) await provisionMockDatabase(pool, process.env.MOCK_DB_PASSWORD, process.env.MOCK_DATABASE_URL);
  console.log('Database migrations applied');
}
catch { console.error('DATABASE_MIGRATION_FAILED'); process.exitCode = 1; }
finally { await pool.end(); }
