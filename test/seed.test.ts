import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, seedUsers } from '../src/seed.ts';
import { MemoryStore } from '../src/store.ts';

test('seed is deterministic: 50 unique users, one admin', async () => {
  assert.deepEqual(seedUsers(), seedUsers());
  const users = seedUsers();
  assert.equal(users.length, 50);
  assert.equal(new Set(users.map((u) => u.email)).size, 50);
  assert.equal(users.filter((u) => u.role === 'admin').length, 1);
});

test('seeding twice creates nothing the second time', async () => {
  const store = new MemoryStore();
  assert.equal(await seed(store), 50);
  assert.equal(await seed(store), 0);
});
