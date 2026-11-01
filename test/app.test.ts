import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { NullPublisher } from '../src/events.ts';
import { MemoryStore } from '../src/store.ts';
import { verifyAccess } from '../src/tokens.ts';

const cfg = loadConfig({ JWT_SIGNING_KEY: 'test-secret' } as NodeJS.ProcessEnv);
const store = new MemoryStore();
const events = new NullPublisher();
let server: Server;
let base: string;

before(async () => {
  server = createApp({ cfg, store, events, bcryptRounds: 4 }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => void server.close());

const call = (path: string, method = 'GET', body?: unknown, token?: string) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const register = (email: string) => call('/auth/register', 'POST', { email, password: 'password123', fullName: 'Test User' });
const login = async (email: string) => (await (await call('/auth/login', 'POST', { email, password: 'password123' })).json()) as { accessToken: string; refreshToken: string };

test('register publishes user.registered and rejects duplicates', async () => {
  const r = await register('a@shoplab.test');
  assert.equal(r.status, 201);
  assert.equal(events.published.at(-1)?.key, 'user.registered');
  assert.equal((await register('a@shoplab.test')).status, 409);
});

test('register validates input', async () => {
  const r = await call('/auth/register', 'POST', { email: 'nope', password: 'short', fullName: '' });
  assert.equal(r.status, 400);
});

test('login returns a JWT with sub, role and tenant claims', async () => {
  const pair = await login('a@shoplab.test');
  const claims = verifyAccess(cfg, pair.accessToken);
  assert.deepEqual(Object.keys(claims).filter((k) => ['sub', 'role', 'tenant'].includes(k)).sort(), ['role', 'sub', 'tenant']);
  assert.equal(claims.role, 'customer');
});

test('bad password is rejected', async () => {
  const r = await call('/auth/login', 'POST', { email: 'a@shoplab.test', password: 'wrong-password' });
  assert.equal(r.status, 401);
});

test('refresh rotates the token; the old one stops working', async () => {
  const pair = await login('a@shoplab.test');
  const next = await call('/auth/refresh', 'POST', { refreshToken: pair.refreshToken });
  assert.equal(next.status, 200);
  assert.equal((await call('/auth/refresh', 'POST', { refreshToken: pair.refreshToken })).status, 401);
});

test('logout with all:true revokes every session', async () => {
  const a = await login('a@shoplab.test');
  const b = await login('a@shoplab.test');
  assert.equal((await call('/auth/logout', 'POST', { all: true }, a.accessToken)).status, 204);
  assert.equal((await call('/auth/refresh', 'POST', { refreshToken: b.refreshToken })).status, 401);
});

test('customers can read only themselves; admins can change roles', async () => {
  await register('b@shoplab.test');
  const a = await login('a@shoplab.test');
  const b = verifyAccess(cfg, (await login('b@shoplab.test')).accessToken).sub;
  assert.equal((await call(`/users/${b}`, 'GET', undefined, a.accessToken)).status, 403);

  const admin = await store.createUser({ email: 'root@shoplab.test', fullName: 'Root', passwordHash: (await import('bcryptjs')).default.hashSync('password123', 4), role: 'admin' });
  const adminToken = (await login('root@shoplab.test')).accessToken;
  const r = await call(`/users/${b}/role`, 'PUT', { role: 'staff' }, adminToken);
  assert.equal(r.status, 200);
  assert.deepEqual(events.published.at(-1), { key: 'user.role_changed', body: { userId: b, oldRole: 'customer', newRole: 'staff' } });
  assert.equal((await call(`/users/${b}/role`, 'PUT', { role: 'staff' }, a.accessToken)).status, 403);
  assert.ok(admin);
});

test('password reset: token works once and revokes sessions', async () => {
  const pair = await login('b@shoplab.test');
  const { resetToken } = (await (await call('/auth/password-reset/request', 'POST', { email: 'b@shoplab.test' })).json()) as { resetToken: string };
  assert.equal((await call('/auth/password-reset/confirm', 'POST', { token: resetToken, password: 'new-password-1' })).status, 204);
  assert.equal((await call('/auth/password-reset/confirm', 'POST', { token: resetToken, password: 'new-password-2' })).status, 400);
  assert.equal((await call('/auth/refresh', 'POST', { refreshToken: pair.refreshToken })).status, 401);
  assert.equal((await call('/auth/login', 'POST', { email: 'b@shoplab.test', password: 'new-password-1' })).status, 200);
});

test('reset request does not reveal unknown emails', async () => {
  assert.equal((await call('/auth/password-reset/request', 'POST', { email: 'ghost@shoplab.test' })).status, 202);
});

test('profile edit: self or admin can change fullName, others cannot, blank is rejected', async () => {
  await register('c@shoplab.test');
  await register('d@shoplab.test');
  const c = await login('c@shoplab.test');
  const d = await login('d@shoplab.test');
  const cId = verifyAccess(cfg, c.accessToken).sub;
  const patch = (id: string, token: string, body: unknown) => call(`/users/${id}`, 'PATCH', body, token);

  const ok = await patch(cId, c.accessToken, { fullName: '  Casey Jones ' });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { fullName: string }).fullName, 'Casey Jones');
  assert.equal((await patch(cId, d.accessToken, { fullName: 'Hacker' })).status, 403);
  assert.equal((await patch(cId, c.accessToken, { fullName: '   ' })).status, 400);
  assert.equal((await patch('00000000-0000-0000-0000-000000000000', (await login('root@shoplab.test')).accessToken, { fullName: 'X' })).status, 404);
  assert.equal((await patch(cId, (await login('root@shoplab.test')).accessToken, { fullName: 'By Admin' })).status, 200);
});
