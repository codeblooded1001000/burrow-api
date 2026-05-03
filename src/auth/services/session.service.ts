import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import type { Env } from '../../config/env.schema';
import { SESSION_COOKIE_NAME } from '../auth.constants';

const SIGNUP_TTL_SEC = 300;
const PHONE_RECOVERY_TTL_SEC = 600;

export interface SessionPayload {
  sub: string;
  role: Role;
}

@Injectable()
export class SessionService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * UI (e.g. Vercel) and API on different registrable domains need `SameSite=None; Secure` (+ optional
   * `Partitioned`). Some PaaS images do not set `NODE_ENV=production`; use `SESSION_CROSS_SITE_COOKIES=true`.
   */
  private useCrossSiteSessionCookie(): boolean {
    const raw = this.config.get('SESSION_CROSS_SITE_COOKIES', { infer: true });
    const flag = raw.toLowerCase();
    if (flag === 'true') return true;
    if (flag === 'false') return false;
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  private usePartitionedSessionCookie(): boolean {
    if (!this.useCrossSiteSessionCookie()) return false;
    const raw = this.config.get('SESSION_COOKIE_PARTITIONED', { infer: true });
    if (raw.toLowerCase() === 'false') return false;
    return true;
  }

  private requireJwtSecret(): string {
    const s = this.config.get('JWT_SECRET', { infer: true });
    if (!s) throw new Error('JWT_SECRET is not configured');
    return s;
  }

  signSignupToken(email: string): { token: string; expiresAt: Date } {
    const secret = this.requireJwtSecret();
    const exp = Math.floor(Date.now() / 1000) + SIGNUP_TTL_SEC;
    const token = jwt.sign({ typ: 'signup', email, iat: Math.floor(Date.now() / 1000), exp }, secret, {
      algorithm: 'HS256',
    });
    return { token, expiresAt: new Date(exp * 1000) };
  }

  verifySignupToken(token: string): { email: string } {
    const secret = this.requireJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (decoded.typ !== 'signup' || typeof decoded.email !== 'string') {
      throw new Error('INVALID_TOKEN');
    }
    return { email: decoded.email.toLowerCase() };
  }

  signPhoneRecoveryToken(userId: string): { token: string; expiresAt: Date } {
    const secret = this.requireJwtSecret();
    const exp = Math.floor(Date.now() / 1000) + PHONE_RECOVERY_TTL_SEC;
    const token = jwt.sign(
      { typ: 'phone-recovery', sub: userId, iat: Math.floor(Date.now() / 1000), exp },
      secret,
      { algorithm: 'HS256' },
    );
    return { token, expiresAt: new Date(exp * 1000) };
  }

  verifyPhoneRecoveryToken(token: string): { userId: string } {
    const secret = this.requireJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (decoded.typ !== 'phone-recovery' || typeof decoded.sub !== 'string') {
      throw new Error('INVALID_TOKEN');
    }
    return { userId: decoded.sub };
  }

  createSessionToken(userId: string, role: Role): string {
    const secret = this.requireJwtSecret();
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    return jwt.sign(
      { sub: userId, role, typ: 'session', iat: Math.floor(Date.now() / 1000), exp },
      secret,
      { algorithm: 'HS256' },
    );
  }

  verifySessionToken(token: string): SessionPayload {
    const secret = this.requireJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') {
      throw new Error('INVALID_SESSION');
    }
    return { sub: decoded.sub, role: decoded.role as Role };
  }

  /**
   * Cross-site UI ↔ API: `SameSite=None; Secure` (+ `Partitioned` when enabled) so `fetch(..., credentials)`
   * sends the session cookie. See `useCrossSiteSessionCookie` and `SESSION_CROSS_SITE_COOKIES`.
   */
  setSessionCookie(res: Response, token: string): void {
    const crossSite = this.useCrossSiteSessionCookie();
    const partitioned = this.usePartitionedSessionCookie();
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: crossSite ? 'none' : 'lax',
      secure: crossSite,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      ...(partitioned ? { partitioned: true } : {}),
    });
  }

  clearSessionCookie(res: Response): void {
    const crossSite = this.useCrossSiteSessionCookie();
    const partitioned = this.usePartitionedSessionCookie();
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: crossSite ? 'none' : 'lax',
      secure: crossSite,
      path: '/',
      ...(partitioned ? { partitioned: true } : {}),
    });
  }

  readSessionCookie(req: { cookies?: Record<string, string> }): string | undefined {
    return req.cookies?.[SESSION_COOKIE_NAME];
  }
}
