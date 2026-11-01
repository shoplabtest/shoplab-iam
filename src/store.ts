import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export type Role = 'customer' | 'staff' | 'admin';

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  role: Role;
  tenant: string;
}

export interface TokenRow {
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface Store {
  createUser(u: { email: string; fullName: string; passwordHash: string; role?: Role; tenant?: string }): Promise<UserRow | null>;
  findByEmail(email: string): Promise<UserRow | null>;
  findById(id: string): Promise<UserRow | null>;
  setRole(id: string, role: Role): Promise<UserRow | null>;
  setPassword(id: string, passwordHash: string): Promise<void>;
  saveRefresh(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getRefresh(tokenHash: string): Promise<TokenRow | null>;
  revokeRefresh(tokenHash: string): Promise<void>;
  revokeAllRefresh(userId: string): Promise<void>;
  saveReset(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumeReset(tokenHash: string): Promise<string | null>;
}

export class PgStore implements Store {
  constructor(private pool: Pool) {}

  async createUser(u: { email: string; fullName: string; passwordHash: string; role?: Role; tenant?: string }) {
    const r = await this.pool.query<UserRow>(
      `INSERT INTO users (email, full_name, password_hash, role, tenant)
       VALUES ($1, $2, $3, COALESCE($4, 'customer'), COALESCE($5, 'default'))
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [u.email, u.fullName, u.passwordHash, u.role ?? null, u.tenant ?? null],
    );
    return r.rows[0] ?? null;
  }
  async findByEmail(email: string) {
    return (await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email])).rows[0] ?? null;
  }
  async findById(id: string) {
    return (await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])).rows[0] ?? null;
  }
  async setRole(id: string, role: Role) {
    return (await this.pool.query<UserRow>('UPDATE users SET role = $2 WHERE id = $1 RETURNING *', [id, role])).rows[0] ?? null;
  }
  async setPassword(id: string, passwordHash: string) {
    await this.pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
  }
  async saveRefresh(userId: string, tokenHash: string, expiresAt: Date) {
    await this.pool.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
  }
  async getRefresh(tokenHash: string) {
    return (await this.pool.query<TokenRow>('SELECT user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1', [tokenHash])).rows[0] ?? null;
  }
  async revokeRefresh(tokenHash: string) {
    await this.pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
  }
  async revokeAllRefresh(userId: string) {
    await this.pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }
  async saveReset(userId: string, tokenHash: string, expiresAt: Date) {
    await this.pool.query('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
  }
  async consumeReset(tokenHash: string) {
    const r = await this.pool.query<{ user_id: string }>(
      'UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id',
      [tokenHash],
    );
    return r.rows[0]?.user_id ?? null;
  }
}

/** In-memory store used by unit tests so they run without Postgres. */
export class MemoryStore implements Store {
  users: UserRow[] = [];
  refresh = new Map<string, TokenRow>();
  resets = new Map<string, { user_id: string; expires_at: Date; used: boolean }>();

  async createUser(u: { email: string; fullName: string; passwordHash: string; role?: Role; tenant?: string }) {
    if (this.users.some((x) => x.email === u.email)) return null;
    const row: UserRow = { id: randomUUID(), email: u.email, full_name: u.fullName, password_hash: u.passwordHash, role: u.role ?? 'customer', tenant: u.tenant ?? 'default' };
    this.users.push(row);
    return { ...row };
  }
  // Return copies, like a database does, so callers cannot mutate stored rows.
  async findByEmail(email: string) {
    const u = this.users.find((x) => x.email === email);
    return u ? { ...u } : null;
  }
  async findById(id: string) {
    const u = this.users.find((x) => x.id === id);
    return u ? { ...u } : null;
  }
  async setRole(id: string, role: Role) {
    const u = this.users.find((x) => x.id === id);
    if (!u) return null;
    u.role = role;
    return { ...u };
  }
  async setPassword(id: string, passwordHash: string) {
    const u = this.users.find((x) => x.id === id);
    if (u) u.password_hash = passwordHash;
  }
  async saveRefresh(userId: string, tokenHash: string, expiresAt: Date) {
    this.refresh.set(tokenHash, { user_id: userId, expires_at: expiresAt, revoked_at: null });
  }
  async getRefresh(tokenHash: string) { return this.refresh.get(tokenHash) ?? null; }
  async revokeRefresh(tokenHash: string) {
    const t = this.refresh.get(tokenHash);
    if (t && !t.revoked_at) t.revoked_at = new Date();
  }
  async revokeAllRefresh(userId: string) {
    for (const t of this.refresh.values()) if (t.user_id === userId && !t.revoked_at) t.revoked_at = new Date();
  }
  async saveReset(userId: string, tokenHash: string, expiresAt: Date) {
    this.resets.set(tokenHash, { user_id: userId, expires_at: expiresAt, used: false });
  }
  async consumeReset(tokenHash: string) {
    const r = this.resets.get(tokenHash);
    if (!r || r.used || r.expires_at <= new Date()) return null;
    r.used = true;
    return r.user_id;
  }
}
