import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, seedUserId, seedUsers } from '../src/seed.ts';
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

test('seed users have stable ids that match the other services\' seeds', async () => {
  assert.equal(seedUserId(0), '78db596d-05c1-4f55-a5ff-eb4939d742a0');
  assert.equal(seedUserId(7), 'a2f57e0a-5abb-42de-a3dc-73fe9597de72');
  const users = seedUsers();
  assert.equal(new Set(users.map((u) => u.id)).size, 50);
  assert.ok(users.every((u, i) => u.id === seedUserId(i)));

  const store = new MemoryStore();
  await seed(store);
  assert.equal((await store.findById(seedUserId(0)))?.role, 'admin');
  assert.equal((await store.findById(seedUserId(0)))?.email, 'grace.rossi.0@shoplab.test');
  assert.equal((await store.findById(seedUserId(3)))?.role, 'staff');
  assert.equal((await store.findById(seedUserId(49)))?.role, 'customer');
});

test('an id is only honoured when the user is new', async () => {
  const store = new MemoryStore();
  const first = await store.createUser({ id: seedUserId(1), email: 'a@shoplab.test', fullName: 'A', passwordHash: 'x' });
  assert.equal(first?.id, seedUserId(1));
  assert.equal(await store.createUser({ id: seedUserId(2), email: 'a@shoplab.test', fullName: 'A again', passwordHash: 'x' }), null); // email taken
  assert.equal(await store.createUser({ id: seedUserId(1), email: 'b@shoplab.test', fullName: 'B', passwordHash: 'x' }), null); // id taken
  assert.notEqual((await store.createUser({ email: 'c@shoplab.test', fullName: 'C', passwordHash: 'x' }))?.id, undefined); // no id: generated
});
