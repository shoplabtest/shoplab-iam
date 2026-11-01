import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from './config.ts';
import { migrate } from './migrate.ts';

const pool = new Pool({ connectionString: loadConfig().databaseUrl });
const applied = await migrate(pool, resolve(import.meta.dirname, '../migrations'));
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await pool.end();
