import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { migrate } from '../src/migrate.ts';
import { seed, seedUserId } from '../src/seed.ts';
import { PgStore } from '../src/store.ts';

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

    // Seeded users get their stable ids in Postgres too, and seeding again changes nothing.
    const store = new PgStore(pool);
    assert.equal(await seed(store), 50);
    assert.equal(await seed(store), 0);
    const admin = await store.findById(seedUserId(0));
    assert.deepEqual([admin?.email, admin?.role], ['grace.rossi.0@shoplab.test', 'admin']);
    assert.equal((await pool.query('SELECT count(DISTINCT id)::int AS n FROM users')).rows[0].n, 50);
    const registered = await store.createUser({ email: 'new@shoplab.test', fullName: 'New', passwordHash: 'x' });
    assert.match(registered!.id, /^[0-9a-f-]{36}$/); // users without an id still get a generated one
  } finally {
    await pool.end();
  }
});
