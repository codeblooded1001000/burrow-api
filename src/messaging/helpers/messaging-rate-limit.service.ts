import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const NEW_CONV_MAX = () => readIntEnv('MESSAGING_NEW_CONV_MAX', 10);
const MSG_PER_MINUTE = () => readIntEnv('MESSAGING_MSG_PER_MIN', 60);
const MSG_WINDOW_MS = 60_000;

@Injectable()
export class MessagingRateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Call only when creating a brand-new conversation row. Roll back with releaseNewConversationSlot on failure after success. */
  async reserveNewConversationSlot(userId: string): Promise<void> {
    if (process.env.NODE_ENV === 'test' && process.env.MESSAGING_RATE_LIMIT_OFF === 'true') {
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    const key = `messaging:newconv:${userId}:${day}`;
    const client = this.redis.getClient();
    const v = await client.incr(key);
    if (v === 1) {
      await client.expire(key, 60 * 60 * 48);
    }
    if (v > NEW_CONV_MAX()) {
      await client.decr(key);
      const retryAfter = secondsUntilUtcMidnight();
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMIT',
            message: 'You can start at most 10 new conversations per day.',
          },
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async releaseNewConversationSlot(userId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `messaging:newconv:${userId}:${day}`;
    await this.redis.getClient().decr(key);
  }

  async assertMessageSendRate(userId: string): Promise<void> {
    if (process.env.NODE_ENV === 'test' && process.env.MESSAGING_RATE_LIMIT_OFF === 'true') {
      return;
    }
    const key = `messaging:send:${userId}`;
    const client = this.redis.getClient();
    const now = Date.now();
    const member = `${String(now)}:${Math.random().toString(36).slice(2)}`;
    await client.zadd(key, now, member);
    await client.zremrangebyscore(key, 0, now - MSG_WINDOW_MS);
    const n = await client.zcard(key);
    await client.expire(key, 120);
    if (n > MSG_PER_MINUTE()) {
      await client.zrem(key, member);
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMIT',
            message: 'You are sending messages too quickly. Try again in a minute.',
          },
          retryAfter: 60,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}
