import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RedisService } from '../../redis/redis.service';
import { PinStrategy } from '../strategies/pin.strategy';

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MAX_LOCKOUTS_24H = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PinService {
  constructor(
    private readonly redis: RedisService,
    private readonly pinStrategy: PinStrategy,
    @InjectPinoLogger(PinService.name) private readonly logger: PinoLogger,
  ) {}

  private failKey(email: string): string {
    return `pin:fail:${email.toLowerCase()}`;
  }

  private lockoutKey(userId: string): string {
    return `pin:lockout:${userId}`;
  }

  private lockoutEventsKey(userId: string): string {
    return `pin:lockoutEvents:${userId}`;
  }

  private recoverRequiredKey(userId: string): string {
    return `pin:recoverRequired:${userId}`;
  }

  async recordFailedPinAttempt(email: string, userId: string | null): Promise<void> {
    const client = this.redis.getClient();
    const fk = this.failKey(email);
    const now = Date.now();
    await client.zremrangebyscore(fk, 0, now - FIFTEEN_MIN_MS);
    await client.zadd(fk, now, `${String(now)}:${randomBytes(6).toString('hex')}`);
    await client.pexpire(fk, FIFTEEN_MIN_MS);
    const fails = await client.zcard(fk);
    if (!userId) return;
    if (fails >= MAX_FAILS) {
      await this.applyLockout(userId);
      await client.del(fk);
    }
  }

  private async applyLockout(userId: string): Promise<void> {
    const client = this.redis.getClient();
    const lk = this.lockoutKey(userId);
    const ev = this.lockoutEventsKey(userId);
    const now = Date.now();
    const lockedUntil = now + LOCKOUT_MS;
    await client.set(lk, String(lockedUntil), 'PX', LOCKOUT_MS);
    await client.zremrangebyscore(ev, 0, now - DAY_MS);
    await client.zadd(ev, now, `${String(now)}:${randomBytes(4).toString('hex')}`);
    await client.pexpire(ev, DAY_MS);
    const lockoutsInRolling24h = await client.zcard(ev);
    if (lockoutsInRolling24h >= MAX_LOCKOUTS_24H) {
      await client.set(this.recoverRequiredKey(userId), '1', 'PX', DAY_MS);
    }
    this.logger.warn({ userId }, 'pin_lockout_applied');
  }

  async clearPinFailureState(email: string, userId: string): Promise<void> {
    const client = this.redis.getClient();
    await client.del(this.failKey(email), this.lockoutKey(userId));
  }

  async getLockoutState(userId: string): Promise<{
    lockedUntil: number | null;
    requireRecovery: boolean;
    lockoutsIn24h: number;
  }> {
    const client = this.redis.getClient();
    const raw = await client.get(this.lockoutKey(userId));
    const lockedUntil = raw ? Number(raw) : null;
    const requireRecovery = (await client.get(this.recoverRequiredKey(userId))) === '1';
    await client.zremrangebyscore(this.lockoutEventsKey(userId), 0, Date.now() - DAY_MS);
    const lockoutsIn24h = await client.zcard(this.lockoutEventsKey(userId));
    return { lockedUntil, requireRecovery, lockoutsIn24h };
  }

  async assertNotLocked(userId: string): Promise<void> {
    const { lockedUntil, requireRecovery } = await this.getLockoutState(userId);
    if (requireRecovery) {
      const err = new Error('ACCOUNT_LOCKED_RECOVERY');
      (err as Error & { lockedUntil: number }).lockedUntil = Date.now() + LOCKOUT_MS;
      throw err;
    }
    if (lockedUntil !== null && lockedUntil > Date.now()) {
      const err = new Error('ACCOUNT_LOCKED');
      (err as Error & { lockedUntil: number }).lockedUntil = lockedUntil;
      throw err;
    }
  }

  async clearRecoveryRequirement(userId: string): Promise<void> {
    const client = this.redis.getClient();
    await client.del(this.recoverRequiredKey(userId), this.lockoutEventsKey(userId), this.lockoutKey(userId));
  }

  /** Clear PIN attempt and lockout keys (e.g. account deletion). */
  async clearAllForUser(userId: string, email: string): Promise<void> {
    const client = this.redis.getClient();
    await client.del(
      this.failKey(email),
      this.lockoutKey(userId),
      this.lockoutEventsKey(userId),
      this.recoverRequiredKey(userId),
    );
  }

  hashPin(pin: string): Promise<string> {
    return this.pinStrategy.hash(pin);
  }

  verifyPin(hash: string, pin: string): Promise<boolean> {
    return this.pinStrategy.verify(hash, pin);
  }
}
