import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { migrate } from '../src/migrate.ts';

// Runs against a real, empty Postgres. CI provides TEST_DATABASE_URL; locally the test is skipped.
const url = process.env.TEST_DATABASE_URL;

test('all migrations apply to an empty database, once', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const dir = resolve(import.meta.dirname, '../migrations');
    assert.deepEqual(await migrate(pool, dir), ['001_create_users.sql', '002_create_refresh_tokens.sql', '003_create_password_resets.sql']);
    assert.deepEqual(await migrate(pool, dir), []);
    const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY column_name");
    assert.ok(['email', 'full_name', 'role', 'tenant'].every((c) => cols.rows.some((r) => r.column_name === c)));
  } finally {
    await pool.end();
  }
});
