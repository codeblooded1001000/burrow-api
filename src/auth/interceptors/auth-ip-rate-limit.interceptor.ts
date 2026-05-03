import { randomBytes } from 'node:crypto';
import {
  Injectable,
  NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { from, mergeMap } from 'rxjs';
import { RedisService } from '../../redis/redis.service';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

@Injectable()
export class AuthIpRateLimitInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.enforceLimit(context)).pipe(mergeMap(() => next.handle()));
  }

  private async enforceLimit(context: ExecutionContext): Promise<void> {
    const req = context.switchToHttp().getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const key = `ratelimit:auth:ip:${ip}`;
    const client = this.redis.getClient();
    const now = Date.now();
    await client.zremrangebyscore(key, 0, now - WINDOW_MS);
    const count = await client.zcard(key);
    if (count >= MAX_PER_WINDOW) {
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMIT',
            message: 'Too many requests. Slow down and try again shortly.',
          },
          retryAfter: Math.ceil(WINDOW_MS / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await client.zadd(key, now, `${String(now)}:${randomBytes(6).toString('hex')}`);
    await client.pexpire(key, WINDOW_MS);
  }
}
