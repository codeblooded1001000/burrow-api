import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface HealthPayload {
  status: 'ok' | 'degraded';
  uptime: number;
  db: 'ok' | 'down';
  redis: 'ok' | 'down';
  version: string;
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly bootMs = Date.now();
  private readonly version: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    this.version = typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  }

  async getHealth(): Promise<{ httpStatus: 200 | 503; body: HealthPayload }> {
    const dbOk = await this.pingDb();
    const redisOk = await this.redis.ping();
    const degraded = !dbOk || !redisOk;
    const body: HealthPayload = {
      status: degraded ? 'degraded' : 'ok',
      uptime: Math.floor((Date.now() - this.bootMs) / 1000),
      db: dbOk ? 'ok' : 'down',
      redis: redisOk ? 'ok' : 'down',
      version: this.version,
      timestamp: new Date().toISOString(),
    };
    return { httpStatus: degraded ? 503 : 200, body };
  }

  private async pingDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
