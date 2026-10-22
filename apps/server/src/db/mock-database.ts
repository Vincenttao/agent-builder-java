import { Pool } from './pool.js';
import { migrate } from './migrations.js';
/** Installation-only provisioning. Mock runs with its own non-superuser database owner. */
export async function provisionMockDatabase(admin: Pool, password: string, connectionString: string) {
  if (!/^[a-f0-9]{48,128}$/.test(password)) throw new Error('MOCK_DB_PASSWORD must be a generated hexadecimal value');
  if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='builder_mock'")).rowCount) {
    await admin.query(`CREATE ROLE builder_mock LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
  } else await admin.query(`ALTER ROLE builder_mock LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
  if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='builder_mock'")).rowCount) await admin.query('CREATE DATABASE builder_mock OWNER builder_mock');
  const mock = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try { await migrate(mock, 'db/mock-migrations'); } finally { await mock.end(); }
}
