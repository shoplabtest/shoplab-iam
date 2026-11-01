import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Config } from './config.ts';
import type { Role, UserRow } from './store.ts';

/** Claims other services read from the access token: sub, role, tenant. */
export interface AccessClaims {
  sub: string;
  role: Role;
  tenant: string;
}

export function signAccess(cfg: Config, u: UserRow): string {
  const claims: AccessClaims = { sub: u.id, role: u.role, tenant: u.tenant };
  return jwt.sign(claims, cfg.jwtSecret, { expiresIn: cfg.accessTtlSeconds });
}

export function verifyAccess(cfg: Config, token: string): AccessClaims {
  return jwt.verify(token, cfg.jwtSecret) as AccessClaims;
}

export const newOpaqueToken = () => randomBytes(32).toString('hex');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
