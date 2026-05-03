import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import type { Env } from '../config/env.schema';

const ADMIN_PURPOSE = 'admin' as const;
const TTL_SEC = 24 * 60 * 60;

@Injectable()
export class AdminTokenService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  sign(): string {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (secret.length === 0) {
      throw new HttpException(
        { error: { code: 'INTERNAL', message: 'JWT_SECRET is not configured.' } },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign({ purpose: ADMIN_PURPOSE, iat: now, exp: now + TTL_SEC }, secret, {
      algorithm: 'HS256',
    });
  }

  verify(token: string): void {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (secret.length === 0) {
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED', message: 'Admin auth is not configured.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (decoded.purpose !== ADMIN_PURPOSE) {
        throw new Error('bad purpose');
      }
    } catch {
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired admin token.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
