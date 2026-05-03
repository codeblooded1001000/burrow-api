import { createHmac, randomInt, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { RedisService } from '../../redis/redis.service';
import { OTP_PURPOSES, type OtpPurpose } from '../auth.constants';

const OTP_TTL_SEC = 600;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_RESENDS = 3;
const MAX_OTP_REQUESTS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;
const MAX_VERIFY_ATTEMPTS = 3;

@Injectable()
export class OtpService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly redis: RedisService,
    @InjectPinoLogger(OtpService.name) private readonly logger: PinoLogger,
  ) {}

  private otpKey(purpose: OtpPurpose, identifier: string): string {
    return `otp:${purpose}:${identifier.toLowerCase()}`;
  }

  private rateLimitKey(purpose: OtpPurpose, identifier: string): string {
    return `ratelimit:otp:${purpose}:${identifier.toLowerCase()}`;
  }

  private hashOtp(plain: string): string {
    const secret = this.config.get('OTP_HMAC_SECRET', { infer: true });
    if (!secret) {
      this.logger.error('OTP_HMAC_SECRET is not configured');
      throw new Error('OTP_HMAC_SECRET is not configured');
    }
    return createHmac('sha256', secret).update(plain).digest('hex');
  }

  private generatePlainOtp(): string {
    return String(randomInt(100_000, 1_000_000));
  }

  private async recordOtpRequestEvent(purpose: OtpPurpose, identifier: string): Promise<void> {
    const rateKey = this.rateLimitKey(purpose, identifier);
    const client = this.redis.getClient();
    const now = Date.now();
    await client.zremrangebyscore(rateKey, 0, now - HOUR_MS);
    const member = `${String(now)}:${randomBytes(8).toString('hex')}`;
    await client.zadd(rateKey, now, member);
    await client.pexpire(rateKey, HOUR_MS);
  }

  private async assertOtpHourlyLimit(purpose: OtpPurpose, identifier: string): Promise<void> {
    const rateKey = this.rateLimitKey(purpose, identifier);
    const client = this.redis.getClient();
    const now = Date.now();
    await client.zremrangebyscore(rateKey, 0, now - HOUR_MS);
    const count = await client.zcard(rateKey);
    if (count >= MAX_OTP_REQUESTS_PER_HOUR) {
      const err = new Error('RATE_LIMIT_OTP');
      (err as Error & { retryAfterSec: number }).retryAfterSec = 3600;
      throw err;
    }
  }

  /**
   * Issue a new OTP (or resend within limits). Returns plaintext OTP for mail/SMS only to caller.
   */
  async issueOtp(
    purpose: OtpPurpose,
    identifier: string,
  ): Promise<{ plainOtp: string; expiresAt: Date; resendAvailableAt: Date }> {
    await this.assertOtpHourlyLimit(purpose, identifier);
    const key = this.otpKey(purpose, identifier);
    const client = this.redis.getClient();
    const existing = await client.hgetall(key);
    const now = Date.now();
    if (existing.otpHash) {
      const lastResend = Number(existing.lastResendAt || existing.createdAt || '0');
      const resendCount = Number(existing.resendCount || '0');
      if (now - lastResend < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - lastResend)) / 1000);
        const err = new Error('OTP_RESEND_COOLDOWN');
        (err as Error & { retryAfterSec: number }).retryAfterSec = waitSec;
        throw err;
      }
      if (resendCount >= MAX_RESENDS) {
        throw new Error('OTP_MAX_RESENDS');
      }
    }

    const plain = this.generatePlainOtp();
    const otpHash = this.hashOtp(plain);
    const expiresAt = new Date(now + OTP_TTL_SEC * 1000);
    const resendAvailableAt = new Date(now + RESEND_COOLDOWN_MS);

    if (existing.otpHash) {
      await client.hset(key, {
        otpHash,
        attempts: '0',
        resendCount: String(Number(existing.resendCount || '0') + 1),
        createdAt: String(Number(existing.createdAt || String(now))),
        lastResendAt: String(now),
      });
      await client.expire(key, OTP_TTL_SEC);
    } else {
      await client.hset(key, {
        otpHash,
        attempts: '0',
        resendCount: '0',
        createdAt: String(now),
        lastResendAt: String(now),
      });
      await client.expire(key, OTP_TTL_SEC);
    }

    return { plainOtp: plain, expiresAt, resendAvailableAt };
  }

  /** Call after email/SMS delivery succeeds so failed sends do not consume the hourly OTP quota. */
  async recordSuccessfulOtpDelivery(purpose: OtpPurpose, identifier: string): Promise<void> {
    await this.recordOtpRequestEvent(purpose, identifier);
  }

  async verifyOtp(purpose: OtpPurpose, identifier: string, plain: string): Promise<void> {
    const key = this.otpKey(purpose, identifier);
    const client = this.redis.getClient();
    const data = await client.hgetall(key);
    if (!data.otpHash) {
      throw new Error('OTP_EXPIRED');
    }
    const attempts = Number(data.attempts || '0');
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      await client.del(key);
      throw new Error('TOO_MANY_ATTEMPTS');
    }
    const expected = this.hashOtp(plain);
    if (expected !== data.otpHash) {
      await client.hincrby(key, 'attempts', 1);
      const rawAttempts = await client.hget(key, 'attempts');
      const next = Number(rawAttempts ?? '0');
      if (next >= MAX_VERIFY_ATTEMPTS) {
        await client.del(key);
        throw new Error('TOO_MANY_ATTEMPTS');
      }
      throw new Error('INVALID_OTP');
    }
    await client.del(key);
  }

  async peekExists(purpose: OtpPurpose, identifier: string): Promise<boolean> {
    const key = this.otpKey(purpose, identifier);
    const client = this.redis.getClient();
    const exists = await client.exists(key);
    return exists === 1;
  }

  /** Remove OTP material and hourly counters for identifiers (e.g. account deletion). */
  async invalidateIdentifiers(email: string, phone: string | null | undefined): Promise<void> {
    const client = this.redis.getClient();
    const em = email.toLowerCase();
    const keys: string[] = [];
    for (const p of OTP_PURPOSES) {
      keys.push(this.otpKey(p, em));
      keys.push(this.rateLimitKey(p, em));
    }
    if (phone) {
      for (const p of OTP_PURPOSES) {
        keys.push(this.otpKey(p, phone));
        keys.push(this.rateLimitKey(p, phone));
      }
    }
    if (keys.length > 0) await client.del(...keys);
  }
}
