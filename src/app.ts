import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import type { Config } from './config.ts';
import type { Publisher } from './events.ts';
import type { Role, Store, UserRow } from './store.ts';
import { type AccessClaims, hashToken, newOpaqueToken, signAccess, verifyAccess } from './tokens.ts';

const ROLES: Role[] = ['customer', 'staff', 'admin'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, fullName: u.full_name, role: u.role });

export interface Deps {
  cfg: Config;
  store: Store;
  events: Publisher;
  bcryptRounds?: number;
}

declare module 'express-serve-static-core' {
  interface Request { claims?: AccessClaims }
}

export function createApp({ cfg, store, events, bcryptRounds = 10 }: Deps) {
  const app = express();
  app.use(express.json());

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const h = req.header('authorization');
    if (!h?.startsWith('Bearer ')) return void res.status(401).json({ error: 'unauthorized' });
    try {
      req.claims = verifyAccess(cfg, h.slice(7));
      next();
    } catch {
      res.status(401).json({ error: 'unauthorized' });
    }
  };

  const issuePair = async (u: UserRow) => {
    const refreshToken = newOpaqueToken();
    await store.saveRefresh(u.id, hashToken(refreshToken), new Date(Date.now() + cfg.refreshTtlSeconds * 1000));
    return { token: signAccess(cfg, u), refreshToken, expiresIn: cfg.accessTtlSeconds };
  };

  app.get('/healthz', (_req, res) => void res.json({ ok: true }));

  app.post('/auth/register', async (req, res) => {
    const { email, password, fullName } = req.body ?? {};
    if (typeof email !== 'string' || !EMAIL.test(email) || typeof password !== 'string' || password.length < 8 || typeof fullName !== 'string' || !fullName.trim()) {
      return void res.status(400).json({ error: 'invalid_request' });
    }
    const user = await store.createUser({ email: email.toLowerCase(), fullName: fullName.trim(), passwordHash: await bcrypt.hash(password, bcryptRounds) });
    if (!user) return void res.status(409).json({ error: 'email_taken' });
    await events.publish('user.registered', { userId: user.id, email: user.email, fullName: user.full_name });
    res.status(201).json(publicUser(user));
  });

  app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    const user = typeof email === 'string' ? await store.findByEmail(email.toLowerCase()) : null;
    if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash))) {
      return void res.status(401).json({ error: 'invalid_credentials' });
    }
    res.json(await issuePair(user));
  });

  app.post('/auth/refresh', async (req, res) => {
    const token = req.body?.refreshToken;
    const row = typeof token === 'string' ? await store.getRefresh(hashToken(token)) : null;
    if (!row || row.revoked_at || row.expires_at <= new Date()) return void res.status(401).json({ error: 'invalid_refresh_token' });
    const user = await store.findById(row.user_id);
    if (!user) return void res.status(401).json({ error: 'invalid_refresh_token' });
    await store.revokeRefresh(hashToken(token));
    res.json(await issuePair(user));
  });

  /** Session revoke: one refresh token, or every session with `all: true`. */
  app.post('/auth/logout', requireAuth, async (req, res) => {
    if (req.body?.all) await store.revokeAllRefresh(req.claims!.sub);
    else if (typeof req.body?.refreshToken === 'string') await store.revokeRefresh(hashToken(req.body.refreshToken));
    res.status(204).end();
  });

  app.post('/auth/password-reset/request', async (req, res) => {
    const user = typeof req.body?.email === 'string' ? await store.findByEmail(req.body.email.toLowerCase()) : null;
    let resetToken: string | undefined;
    if (user) {
      resetToken = newOpaqueToken();
      await store.saveReset(user.id, hashToken(resetToken), new Date(Date.now() + 3600_000));
    }
    // Always 202 so the endpoint does not reveal which emails exist. The token is only echoed in non-production for tests.
    res.status(202).json(process.env.NODE_ENV === 'production' ? {} : { resetToken });
  });

  app.post('/auth/password-reset/confirm', async (req, res) => {
    const { token, password } = req.body ?? {};
    if (typeof token !== 'string' || typeof password !== 'string' || password.length < 8) return void res.status(400).json({ error: 'invalid_request' });
    const userId = await store.consumeReset(hashToken(token));
    if (!userId) return void res.status(400).json({ error: 'invalid_token' });
    await store.setPassword(userId, await bcrypt.hash(password, bcryptRounds));
    await store.revokeAllRefresh(userId);
    res.status(204).end();
  });

  app.get('/users/:id', requireAuth, async (req, res) => {
    const { sub, role } = req.claims!;
    if (sub !== req.params.id && role === 'customer') return void res.status(403).json({ error: 'forbidden' });
    const user = await store.findById(req.params.id);
    if (!user) return void res.status(404).json({ error: 'not_found' });
    res.json(publicUser(user));
  });

  /** Profile edit: the user themself or an admin may change the display name. Email is not editable. */
  app.patch('/users/:id', requireAuth, async (req, res) => {
    const { sub, role } = req.claims!;
    if (sub !== req.params.id && role !== 'admin') return void res.status(403).json({ error: 'forbidden' });
    const fullName = req.body?.fullName;
    if (typeof fullName !== 'string' || !fullName.trim()) return void res.status(400).json({ error: 'invalid_request' });
    const user = await store.setFullName(req.params.id, fullName.trim());
    if (!user) return void res.status(404).json({ error: 'not_found' });
    res.json(publicUser(user));
  });

  app.put('/users/:id/role', requireAuth, async (req, res) => {
    if (req.claims!.role !== 'admin') return void res.status(403).json({ error: 'forbidden' });
    const role = req.body?.role;
    if (!ROLES.includes(role)) return void res.status(400).json({ error: 'invalid_role' });
    const before = await store.findById(req.params.id);
    if (!before) return void res.status(404).json({ error: 'not_found' });
    const user = (await store.setRole(before.id, role))!;
    if (before.role !== role) await events.publish('user.role_changed', { userId: user.id, oldRole: before.role, newRole: role });
    res.json(publicUser(user));
  });

  return app;
}
