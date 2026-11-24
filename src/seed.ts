import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { loadConfig } from './config.ts';
import { migrate } from './migrate.ts';
import { PgStore, type Role, type Store } from './store.ts';

/** Deterministic PRNG so every environment gets the same 50 users. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ada', 'Ben', 'Chloe', 'Dev', 'Elena', 'Farid', 'Grace', 'Hugo', 'Ines', 'Jon'];
const LAST = ['Nguyen', 'Okafor', 'Silva', 'Kim', 'Rossi', 'Haddad', 'Novak', 'Tanaka', 'Meyer', 'Lopez'];

export const SEED_PASSWORD = 'password123';

/**
 * Stable id for the i-th seed user. The orders, payments, invoices and notifications seeds derive the same ids,
 * so a seeded shopper is the same person in every service. Seed a fresh database: users that already exist keep their ids.
 */
export const seedUserId = (i: number) => {
  const h = createHash('sha1').update(`shoplab-seed-user-${i}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export function seedUsers(count = 50, seed = 42) {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST[Math.floor(rnd() * FIRST.length)];
    const last = LAST[Math.floor(rnd() * LAST.length)];
    const role: Role = i === 0 ? 'admin' : i < 4 ? 'staff' : 'customer';
    return { id: seedUserId(i), email: `${first}.${last}.${i}@shoplab.test`.toLowerCase(), fullName: `${first} ${last}`, role };
  });
}

export async function seed(store: Store, rounds = 4) {
  const hash = await bcrypt.hash(SEED_PASSWORD, rounds);
  let created = 0;
  for (const u of seedUsers()) if (await store.createUser({ ...u, passwordHash: hash })) created++;
  return created;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  await migrate(pool, resolve(import.meta.dirname, '../migrations'));
  console.log(`seeded ${await seed(new PgStore(pool))} users`);
  await pool.end();
}
