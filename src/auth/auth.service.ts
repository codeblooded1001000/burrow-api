import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManualReviewStatus, Role } from '@prisma/client';
import type { Response } from 'express';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { OTP_TTL_SEC } from './auth.constants';
import { DomainService } from './services/domain.service';
import { OtpService } from './services/otp.service';
import { PinService } from './services/pin.service';
import { SessionService } from './services/session.service';
import { SmsService } from './services/sms.service';
import { isWeakPin } from './data/pin-blocklist';
import { mapUserToDto } from './user-mapper';
import type {
  ConfirmNewEmailBodyDto,
  LoginBodyDto,
  ManualReviewBodyDto,
  PhoneRequestOtpBodyDto,
  PhoneUpdateEmailBodyDto,
  PhoneVerifyBodyDto,
  RecoverRequestOtpBodyDto,
  RecoverVerifyAndResetBodyDto,
  SignupRequestOtpBodyDto,
  SignupSetPinBodyDto,
  SignupVerifyOtpBodyDto,
} from './schemas/auth.schemas';
import type { UserDto } from './schemas/auth.schemas';

function err(status: number, code: string, message: string, details?: Record<string, unknown>): never {
  const body: { error: { code: string; message: string; details?: Record<string, unknown> }; retryAfter?: number } = {
    error: { code, message, ...(details ? { details } : {}) },
  };
  throw new HttpException(body, status);
}

function rateLimit(status: number, retryAfterSec: number, message: string): never {
  throw new HttpException({ error: { code: 'RATE_LIMIT', message }, retryAfter: retryAfterSec }, status);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly domain: DomainService,
    private readonly otp: OtpService,
    private readonly pin: PinService,
    private readonly session: SessionService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private emailRebindMetaKey(email: string): string {
    return `email-rebind-meta:${email.toLowerCase()}`;
  }

  async signupRequestOtp(dto: SignupRequestOtpBodyDto): Promise<{ ok: true; expiresAt: string; resendAvailableAt: string }> {
    const { email } = dto;
    const domainResult = this.domain.checkSignupDomain(email);
    if (domainResult === 'block') {
      err(HttpStatus.BAD_REQUEST, 'BLOCKED_DOMAIN', 'Personal email domains are not supported. Please use your work email.');
    }
    if (domainResult === 'unknown') {
      err(HttpStatus.BAD_REQUEST, 'DOMAIN_NOT_RECOGNIZED', "We don't recognize this company yet.", {
        manualReviewAvailable: true,
      });
    }
    const existing = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      err(HttpStatus.CONFLICT, 'CONFLICT', 'An account with this email already exists.');
    }
    try {
      const { plainOtp, expiresAt, resendAvailableAt } = await this.otp.issueOtp('signup', email);
      await this.mail.sendOtp({ to: email, otp: plainOtp, purpose: 'signup' });
      await this.otp.recordSuccessfulOtpDelivery('signup', email);
      return {
        ok: true,
        expiresAt: expiresAt.toISOString(),
        resendAvailableAt: resendAvailableAt.toISOString(),
      };
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'RATE_LIMIT_OTP') {
          const sec = (e as Error & { retryAfterSec?: number }).retryAfterSec ?? 3600;
          rateLimit(429, sec, 'Too many verification requests. Try again later.');
        }
        if (e.message === 'OTP_RESEND_COOLDOWN') {
          const sec = (e as Error & { retryAfterSec?: number }).retryAfterSec ?? 60;
          rateLimit(429, sec, 'Please wait before requesting another code.');
        }
        if (e.message === 'OTP_MAX_RESENDS') {
          err(HttpStatus.BAD_REQUEST, 'OTP_MAX_RESENDS', 'Maximum resend attempts reached. Request a new code later.');
        }
      }
      throw e;
    }
  }

  async signupVerifyOtp(
    dto: SignupVerifyOtpBodyDto,
  ): Promise<{ ok: true; signupToken: string; expiresAt: string }> {
    const { email, otp } = dto;
    try {
      await this.otp.verifyOtp('signup', email, otp);
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'INVALID_OTP') err(HttpStatus.BAD_REQUEST, 'INVALID_OTP', 'The code is incorrect.');
        if (e.message === 'OTP_EXPIRED') err(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'This code has expired.');
        if (e.message === 'TOO_MANY_ATTEMPTS')
          err(HttpStatus.BAD_REQUEST, 'TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Request a new code.');
      }
      throw e;
    }
    const { token, expiresAt } = this.session.signSignupToken(email);
    return { ok: true, signupToken: token, expiresAt: expiresAt.toISOString() };
  }

  async signupSetPin(dto: SignupSetPinBodyDto, res: Response): Promise<{ ok: true; user: UserDto }> {
    let email: string;
    try {
      ({ email } = this.session.verifySignupToken(dto.signupToken));
    } catch {
      err(HttpStatus.BAD_REQUEST, 'INVALID_TOKEN', 'This link is invalid or has expired.');
    }
    if (dto.pin !== dto.confirmPin) {
      err(HttpStatus.BAD_REQUEST, 'PIN_MISMATCH', 'PIN and confirmation do not match.');
    }
    if (isWeakPin(dto.pin)) {
      err(HttpStatus.BAD_REQUEST, 'WEAK_PIN', 'This PIN is too easy to guess. Choose a stronger 6-digit PIN.');
    }
    const existing = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      err(HttpStatus.CONFLICT, 'CONFLICT', 'An account with this email already exists.');
    }
    const domainResult = this.domain.checkSignupDomain(email);
    if (domainResult !== 'allow') {
      err(HttpStatus.BAD_REQUEST, 'DOMAIN_NOT_RECOGNIZED', 'Email domain is no longer eligible for instant signup.');
    }
    const pinHash = await this.pin.hashPin(dto.pin);
    const companyName = this.domain.companyNameFromEmail(email);
    const user = await this.prisma.user.create({
      data: {
        email,
        emailVerified: true,
        pinHash,
        role: Role.ONBOARDING,
        companyName,
        companyVerified: true,
      },
    });
    const token = this.session.createSessionToken(user.id, user.role);
    this.session.setSessionCookie(res, token);
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { profile: true, listing: true },
    });
    return {
      ok: true,
      user: mapUserToDto(u, u.profile, u.listing, this.config.get('R2_PUBLIC_URL', { infer: true })),
    };
  }

  async login(dto: LoginBodyDto, res: Response): Promise<{ ok: true; user: UserDto }> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { profile: true, listing: true },
    });
    if (!user) {
      await this.pin.recordFailedPinAttempt(email, null);
      err(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or PIN is incorrect.');
    }
    try {
      await this.pin.assertNotLocked(user.id);
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'ACCOUNT_LOCKED') {
          const until = (e as Error & { lockedUntil: number }).lockedUntil;
          throw new HttpException(
            {
              error: {
                code: 'ACCOUNT_LOCKED',
                message: 'Too many failed attempts. Try again later.',
                details: {
                  retryAfter: Math.max(0, Math.ceil((until - Date.now()) / 1000)),
                  lockedUntil: new Date(until).toISOString(),
                },
              },
            },
            423,
          );
        }
        if (e.message === 'ACCOUNT_LOCKED_RECOVERY') {
          throw new HttpException(
            {
              error: {
                code: 'ACCOUNT_LOCKED',
                message: 'Account recovery is required before you can sign in again.',
                details: { requireRecovery: true, lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString() },
              },
            },
            423,
          );
        }
      }
      throw e;
    }
    const ok = await this.pin.verifyPin(user.pinHash, dto.pin);
    if (!ok) {
      await this.pin.recordFailedPinAttempt(email, user.id);
      err(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or PIN is incorrect.');
    }
    await this.pin.clearPinFailureState(email, user.id);
    const token = this.session.createSessionToken(user.id, user.role);
    this.session.setSessionCookie(res, token);
    return {
      ok: true,
      user: mapUserToDto(user, user.profile, user.listing, this.config.get('R2_PUBLIC_URL', { infer: true })),
    };
  }

  logout(res: Response): { ok: true } {
    this.session.clearSessionCookie(res);
    return { ok: true };
  }

  async recoverRequestOtp(dto: RecoverRequestOtpBodyDto): Promise<{ ok: true; expiresAt: string; resendAvailableAt: string }> {
    const { email } = dto;
    const user = await this.prisma.user.findFirst({ where: { email: dto.email, deletedAt: null } });
    if (!user) {
      err(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No account found for this email.');
    }
    try {
      const { plainOtp, expiresAt, resendAvailableAt } = await this.otp.issueOtp('recover-email', email);
      await this.mail.sendOtp({ to: email, otp: plainOtp, purpose: 'recover' });
      await this.otp.recordSuccessfulOtpDelivery('recover-email', email);
      return {
        ok: true,
        expiresAt: expiresAt.toISOString(),
        resendAvailableAt: resendAvailableAt.toISOString(),
      };
    } catch (e) {
      if (e instanceof Error && e.message === 'RATE_LIMIT_OTP') {
        const sec = (e as Error & { retryAfterSec?: number }).retryAfterSec ?? 3600;
        rateLimit(429, sec, 'Too many verification requests. Try again later.');
      }
      if (e instanceof Error && e.message === 'OTP_RESEND_COOLDOWN') {
        const sec = (e as Error & { retryAfterSec?: number }).retryAfterSec ?? 60;
        rateLimit(429, sec, 'Please wait before requesting another code.');
      }
      if (e instanceof Error && e.message === 'OTP_MAX_RESENDS') {
        err(HttpStatus.BAD_REQUEST, 'OTP_MAX_RESENDS', 'Maximum resend attempts reached.');
      }
      throw e;
    }
  }

  async recoverVerifyAndReset(dto: RecoverVerifyAndResetBodyDto, res: Response): Promise<{ ok: true; user: UserDto }> {
    const { email, otp, newPin } = dto;
    if (isWeakPin(newPin)) {
      err(HttpStatus.BAD_REQUEST, 'WEAK_PIN', 'This PIN is too easy to guess.');
    }
    try {
      await this.otp.verifyOtp('recover-email', email, otp);
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'INVALID_OTP') err(HttpStatus.BAD_REQUEST, 'INVALID_OTP', 'The code is incorrect.');
        if (e.message === 'OTP_EXPIRED') err(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'This code has expired.');
        if (e.message === 'TOO_MANY_ATTEMPTS')
          err(HttpStatus.BAD_REQUEST, 'TOO_MANY_ATTEMPTS', 'Too many incorrect attempts.');
      }
      throw e;
    }
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { profile: true, listing: true },
    });
    if (!user) err(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No account found for this email.');
    const pinHash = await this.pin.hashPin(newPin);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { pinHash },
      include: { profile: true, listing: true },
    });
    await this.pin.clearRecoveryRequirement(user.id);
    await this.pin.clearPinFailureState(email, user.id);
    const token = this.session.createSessionToken(updated.id, updated.role);
    this.session.setSessionCookie(res, token);
    return {
      ok: true,
      user: mapUserToDto(updated, updated.profile, updated.listing, this.config.get('R2_PUBLIC_URL', { infer: true })),
    };
  }

  async phoneRequestOtp(dto: PhoneRequestOtpBodyDto): Promise<{ ok: true; expiresAt: string; resendAvailableAt: string }> {
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber: dto.phoneNumber, deletedAt: null },
    });
    if (!user) err(HttpStatus.NOT_FOUND, 'PHONE_NOT_FOUND', 'No account found for this phone number.');
    try {
      const { plainOtp, expiresAt, resendAvailableAt } = await this.otp.issueOtp('recover-phone', dto.phoneNumber);
      try {
        await this.sms.sendOtp(dto.phoneNumber, plainOtp);
      } catch {
        err(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', 'Unable to send SMS right now.');
      }
      await this.otp.recordSuccessfulOtpDelivery('recover-phone', dto.phoneNumber);
      return {
        ok: true,
        expiresAt: expiresAt.toISOString(),
        resendAvailableAt: resendAvailableAt.toISOString(),
      };
    } catch (e) {
      if (e instanceof Error && e.message === 'RATE_LIMIT_OTP') {
        const sec = (e as Error & { retryAfterSec?: number }).retryAfterSec ?? 3600;
        rateLimit(429, sec, 'Too many verification requests. Try again later.');
      }
      if (e instanceof Error && e.message === 'OTP_RESEND_COOLDOWN') {
        const sec = (e as Error & { retryAfterSec?: number }).retryAfterSec ?? 60;
        rateLimit(429, sec, 'Please wait before requesting another code.');
      }
      throw e;
    }
  }

  async phoneVerify(dto: PhoneVerifyBodyDto): Promise<{ ok: true; recoveryToken: string; expiresAt: string }> {
    try {
      await this.otp.verifyOtp('recover-phone', dto.phoneNumber, dto.otp);
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'INVALID_OTP') err(HttpStatus.BAD_REQUEST, 'INVALID_OTP', 'The code is incorrect.');
        if (e.message === 'OTP_EXPIRED') err(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'This code has expired.');
        if (e.message === 'TOO_MANY_ATTEMPTS')
          err(HttpStatus.BAD_REQUEST, 'TOO_MANY_ATTEMPTS', 'Too many incorrect attempts.');
      }
      throw e;
    }
    const user = await this.prisma.user.findFirst({
      where: { phoneNumber: dto.phoneNumber, deletedAt: null },
    });
    if (!user) err(HttpStatus.NOT_FOUND, 'PHONE_NOT_FOUND', 'No account found for this phone number.');
    const { token, expiresAt } = this.session.signPhoneRecoveryToken(user.id);
    return { ok: true, recoveryToken: token, expiresAt: expiresAt.toISOString() };
  }

  async phoneUpdateEmail(dto: PhoneUpdateEmailBodyDto): Promise<{ ok: true; expiresAt: string; resendAvailableAt: string }> {
    let userId: string;
    try {
      ({ userId } = this.session.verifyPhoneRecoveryToken(dto.recoveryToken));
    } catch {
      err(HttpStatus.BAD_REQUEST, 'INVALID_TOKEN', 'This recovery link is invalid or has expired.');
    }
    const domainResult = this.domain.checkSignupDomain(dto.newEmail);
    if (domainResult === 'block') {
      err(HttpStatus.BAD_REQUEST, 'BLOCKED_DOMAIN', 'Personal email domains are not supported.');
    }
    if (domainResult === 'unknown') {
      err(HttpStatus.BAD_REQUEST, 'DOMAIN_NOT_RECOGNIZED', "We don't recognize this company yet.", {
        manualReviewAvailable: true,
      });
    }
    const taken = await this.prisma.user.findFirst({
      where: { email: dto.newEmail, deletedAt: null, NOT: { id: userId } },
    });
    if (taken) err(HttpStatus.CONFLICT, 'CONFLICT', 'This email is already in use.');
    const { plainOtp, expiresAt, resendAvailableAt } = await this.otp.issueOtp('email-rebind', dto.newEmail);
    const recoverySha = createHash('sha256').update(dto.recoveryToken).digest('hex');
    await this.redis.set(
      this.emailRebindMetaKey(dto.newEmail),
      JSON.stringify({ userId, recoverySha }),
      OTP_TTL_SEC,
    );
    await this.mail.sendOtp({ to: dto.newEmail, otp: plainOtp, purpose: 'email-change' });
    await this.otp.recordSuccessfulOtpDelivery('email-rebind', dto.newEmail);
    return {
      ok: true,
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: resendAvailableAt.toISOString(),
    };
  }

  async confirmNewEmail(dto: ConfirmNewEmailBodyDto): Promise<{ ok: true; message: string }> {
    let userId: string;
    try {
      ({ userId } = this.session.verifyPhoneRecoveryToken(dto.recoveryToken));
    } catch {
      err(HttpStatus.BAD_REQUEST, 'INVALID_TOKEN', 'This recovery link is invalid or has expired.');
    }
    const metaRaw = await this.redis.get(this.emailRebindMetaKey(dto.newEmail));
    if (!metaRaw) err(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'Start the email change flow again.');
    const meta = JSON.parse(metaRaw) as { userId: string; recoverySha: string };
    const sha = createHash('sha256').update(dto.recoveryToken).digest('hex');
    if (meta.userId !== userId || meta.recoverySha !== sha) {
      err(HttpStatus.BAD_REQUEST, 'INVALID_TOKEN', 'This recovery link does not match the verification.');
    }
    try {
      await this.otp.verifyOtp('email-rebind', dto.newEmail, dto.otp);
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === 'INVALID_OTP') err(HttpStatus.BAD_REQUEST, 'INVALID_OTP', 'The code is incorrect.');
        if (e.message === 'OTP_EXPIRED') err(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'This code has expired.');
        if (e.message === 'TOO_MANY_ATTEMPTS')
          err(HttpStatus.BAD_REQUEST, 'TOO_MANY_ATTEMPTS', 'Too many incorrect attempts.');
      }
      throw e;
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { email: dto.newEmail, emailVerified: true, companyName: this.domain.companyNameFromEmail(dto.newEmail) },
    });
    await this.redis.del(this.emailRebindMetaKey(dto.newEmail));
    return { ok: true, message: 'Your email has been updated.' };
  }

  async manualReview(dto: ManualReviewBodyDto): Promise<{ ok: true; message: string }> {
    if (this.domain.isBlocklisted(dto.email)) {
      err(HttpStatus.BAD_REQUEST, 'BLOCKED_DOMAIN', 'Personal email domains are not supported. Please use your work email.');
    }
    await this.prisma.manualReviewRequest.create({
      data: {
        email: dto.email,
        companyClaim: dto.companyClaim,
        status: ManualReviewStatus.PENDING,
      },
    });
    await this.mail.send({
      to: dto.email,
      subject: 'We received your Burrow access request',
      html: `<p style="font-family:system-ui,sans-serif;font-size:16px;color:#1A1A1A">We will review your company details and respond within 24 hours.</p>`,
      text: 'We will review your company details and respond within 24 hours.',
    });
    return { ok: true, message: "We'll review within 24 hours." };
  }

  async getMe(userId: string): Promise<{ user: UserDto }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { profile: true, listing: true },
    });
    if (!user) err(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Your session is no longer valid.');
    return {
      user: mapUserToDto(user, user.profile, user.listing, this.config.get('R2_PUBLIC_URL', { infer: true })),
    };
  }
}
