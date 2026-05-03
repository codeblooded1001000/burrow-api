import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type ChainableCommander } from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env.schema';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @InjectPinoLogger(RedisService.name) private readonly logger: PinoLogger,
  ) {
    const url = this.config.get('REDIS_URL', { infer: true });
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number): number | null => {
        if (times > 5) {
          this.logger.error({ times }, 'redis_retry_exhausted');
          return null;
        }
        const delay = Math.min(100 * 2 ** (times - 1), 3000);
        this.logger.warn({ times, delayMs: delay }, 'redis_retry');
        return delay;
      },
    });
    this.client.on('error', (err: Error) => {
      this.logger.error({ err }, 'redis_client_error');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }
    await this.client.set(key, value);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  pipeline(): ChainableCommander {
    return this.client.pipeline();
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
