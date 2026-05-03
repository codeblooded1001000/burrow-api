import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { mapUserToDto } from '../auth/user-mapper';
import type { Env } from '../config/env.schema';
import { OtpService } from '../auth/services/otp.service';
import { PinService } from '../auth/services/pin.service';
import { SmsService } from '../auth/services/sms.service';
import { MailService } from '../mail/mail.service';
import { computeProfileCompletion } from '../profiles/profile-completion';
import { PrismaService } from '../prisma/prisma.service';
import type { UserDto } from '../auth/schemas/auth.schemas';
import type { PatchMePhoneBody, PatchMeRoleBody, PostMePhoneVerifyBody } from './schemas/users.schemas';

function err(status: number, code: string, message: string): never {
  throw new HttpException({ error: { code, message } }, status);
}

function rateLimit(retryAfterSec: number, message: string): never {
  throw new HttpException({ error: { code: 'RATE_LIMIT', message }, retryAfter: retryAfterSec }, 429);
}

const roleFromDto: Record<PatchMeRoleBody['role'], Role> = {
  LISTER: Role.LISTER,
  SEEKER: Role.SEEKER,
  BOTH: Role.BOTH,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly sms: SmsService,
    private readonly pin: PinService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async patchRole(userId: string, body: PatchMeRoleBody): Promise<{ ok: true; user: UserDto }> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: roleFromDto[body.role] },
      include: { profile: true, listing: true },
    });
    return {
      ok: true,
      user: mapUserToDto(updated, updated.profile, updated.listing, this.config.get('R2_PUBLIC_URL', { infer: true })),
    };
  }

  async patchPhone(userId: string, body: PatchMePhoneBody): Promise<{ ok: true; expiresAt: string }> {
    const other = await this.prisma.user.findFirst({
      where: {
        phoneNumber: body.phoneNumber,
        deletedAt: null,
        NOT: { id: userId },
      },
    });
    if (other) {
      err(HttpStatus.CONFLICT, 'PHONE_IN_USE', 'This phone number is already linked to another account.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { phoneNumber: body.phoneNumber, phoneVerified: false },
    });
    try {
      const { plainOtp, expiresAt } = await this.otp.issueOtp('verify-phone', body.phoneNumber);
      try {
        await this.sms.sendOtp(body.phoneNumber, plainOtp);
      } catch {
        err(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', 'Unable to send SMS right now.');
      }
      await this.otp.recordSuccessfulOtpDelivery('verify-phone', body.phoneNumber);
      return { ok: true, expiresAt: expiresAt.toISOString() };
    } catch (e) {
      if (e instanceof Error && e.message === 'RATE_LIMIT_OTP') {
        const sec = (e as Error & { retryAfterSec?: number }).retryAfterSec ?? 3600;
        rateLimit(sec, 'Too many verification requests. Try again later.');
      }
      if (e instanceof Error && e.message === 'OTP_RESEND_COOLDOWN') {
        const sec = (e as Error & { retryAfterSec?: number }).retryAfterSec ?? 60;
        rateLimit(sec, 'Please wait before requesting another code.');
      }
      if (e instanceof Error && e.message === 'OTP_MAX_RESENDS') {
        err(HttpStatus.BAD_REQUEST, 'OTP_MAX_RESENDS', 'Maximum resend attempts reached.');
      }
      throw e;
    }
  }

  async verifyPhone(userId: string, body: PostMePhoneVerifyBody): Promise<{ ok: true }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user?.phoneNumber) {
      err(HttpStatus.BAD_REQUEST, 'INVALID_INPUT', 'Add a phone number before verifying.');
    }
    try {
      await this.otp.verifyOtp('verify-phone', user.phoneNumber, body.otp);
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
      data: { phoneVerified: true },
    });
    const prof = await this.prisma.profile.findFirst({ where: { userId, deletedAt: null } });
    if (prof) {
      const completion = computeProfileCompletion(
        {
          photoUrl: prof.photoUrl,
          bio: prof.bio,
          profession: prof.profession,
          budgetMin: prof.budgetMin,
          budgetMax: prof.budgetMax,
          moveInDate: prof.moveInDate,
          lifestyleTags: prof.lifestyleTags,
        },
        { phoneVerified: true },
      );
      await this.prisma.profile.update({
        where: { userId },
        data: { profileCompletion: completion },
      });
    }
    return { ok: true };
  }

  /**
   * Soft-delete account (DPDP 30-day grace). Clears Redis auth state for this user.
   * Hard-delete past grace is a deployment concern — see cron note in call site.
   */
  async deleteAccount(userId: string, pin: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) err(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User not found.');
    const okPin = await this.pin.verifyPin(user.pinHash, pin);
    if (!okPin) {
      await this.pin.recordFailedPinAttempt(user.email, user.id);
      err(HttpStatus.BAD_REQUEST, 'INVALID_PIN', 'PIN is incorrect.');
    }
    await this.pin.clearPinFailureState(user.email, user.id);
    const email = user.email;
    const phone = user.phoneNumber;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date() },
      }),
      this.prisma.profile.updateMany({
        where: { userId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
      this.prisma.listing.updateMany({
        where: { userId },
        data: { isActive: false },
      }),
    ]);
    await this.otp.invalidateIdentifiers(email, phone);
    await this.pin.clearAllForUser(userId, email);
    try {
      await this.mail.send({
        to: email,
        subject: 'Your Burrow account is scheduled for deletion',
        html: `<p style="font-family:system-ui,sans-serif;font-size:16px;color:#1A1A1A;line-height:1.5">
Your account is scheduled for permanent deletion in 30 days. To keep your account, sign in again within 30 days.
</p>
<p style="font-family:system-ui,sans-serif;font-size:14px;color:#6B6B6B">
If you did not request this, contact support immediately.
</p>`,
        text: 'Your account is scheduled for permanent deletion in 30 days. To keep your account, sign in again within 30 days.',
      });
    } catch {
      // Non-fatal after DB state committed
    }
    // Daily cron (ops): permanently delete users whose deletedAt is older than 30 days — wire in deploy prompt.
    return { ok: true };
  }

  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        listing: true,
        reportsMade: true,
        reportsReceived: true,
      },
    });
    if (!user) err(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User not found.');
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ participantAUserId: userId }, { participantBUserId: userId }],
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    const { pinHash: _omitPin, ...userSafe } = user;
    return {
      exportedAt: new Date().toISOString(),
      user: userSafe,
      reportsFiled: user.reportsMade.map((r) => ({
        id: r.id,
        reportedUserId: r.reportedUserId,
        conversationId: r.conversationId,
        category: r.category,
        detail: r.detail,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolverNotes: r.resolverNotes,
      })),
      reportsReceived: user.reportsReceived.map((r) => ({
        id: r.id,
        reporterUserId: r.reporterUserId,
        conversationId: r.conversationId,
        category: r.category,
        detail: r.detail,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolverNotes: r.resolverNotes,
      })),
      conversations: conversations.map((c) => ({
        id: c.id,
        participantAUserId: c.participantAUserId,
        participantBUserId: c.participantBUserId,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        numbersShared: c.numbersShared,
        createdAt: c.createdAt.toISOString(),
        messages: c.messages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
          readAt: m.readAt?.toISOString() ?? null,
        })),
      })),
    };
  }
}
