import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Message } from '@prisma/client';
import { ManualReviewStatus, Prisma, ReportStatus } from '@prisma/client';
import type { Env } from '../config/env.schema';
import { DomainService } from '../auth/services/domain.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { adminPasswordMatches } from './helpers/admin-password';
import { AdminTokenService } from './admin-token.service';
import {
  AdminManualReviewsQuerySchema,
  AdminReportsQuerySchema,
  decodeAdminReportCursor,
  decodeManualReviewCursor,
  encodeAdminReportCursor,
  encodeManualReviewCursor,
  type AdminManualReviewListCursor,
  type AdminManualReviewsQueryDto,
  type AdminReportListCursor,
  type AdminReportsQueryDto,
  type AdminBanUserBodyDto,
  type AdminLoginBodyDto,
  type ManualReviewRejectBodyDto,
  type PatchAdminReportBodyDto,
} from './schemas/admin.schemas';

const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_MAX = 5;

export interface AdminMessageSnippetDto {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface AdminReportDto {
  id: string;
  reporterUserId: string;
  reporterEmail: string;
  reporterFullName: string | null;
  reportedUserId: string;
  reportedEmail: string;
  reportedFullName: string | null;
  conversationId: string | null;
  category: string;
  detail: string;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolverNotes: string | null;
  filedByReporterCount: number;
  receivedByReportedCount: number;
  conversationMessages: AdminMessageSnippetDto[];
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
    private readonly tokens: AdminTokenService,
    private readonly mail: MailService,
    private readonly domain: DomainService,
  ) {}

  async login(ip: string, body: AdminLoginBodyDto): Promise<{ token: string; expiresIn: number }> {
    const key = `ratelimit:admin:login:${ip}`;
    const n = await this.redis.incr(key);
    if (n === 1) {
      await this.redis.expire(key, LOGIN_WINDOW_SEC);
    }
    if (n > LOGIN_MAX) {
      throw new HttpException(
        {
          error: { code: 'RATE_LIMIT', message: 'Too many admin login attempts. Try again later.' },
          retryAfter: LOGIN_WINDOW_SEC,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const configured = this.config.get('ADMIN_PASSWORD', { infer: true });
    if (configured.length < 16) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'Admin login is not configured.' } },
        HttpStatus.FORBIDDEN,
      );
    }
    if (!adminPasswordMatches(body.password, configured)) {
      throw new HttpException(
        { error: { code: 'UNAUTHENTICATED', message: 'Invalid admin password.' } },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = this.tokens.sign();
    return { token, expiresIn: 24 * 60 * 60 };
  }

  async listReports(raw: AdminReportsQueryDto): Promise<{
    items: AdminReportDto[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const query = AdminReportsQuerySchema.parse(raw);
    const cursorPayload = query.cursor ? decodeAdminReportCursor(query.cursor) : null;
    if (query.cursor && !cursorPayload) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const where: Prisma.ReportWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(cursorPayload ? this.reportCursorWhere(cursorPayload) : {}),
    };

    const rows = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: {
        reporter: { include: { profile: true } },
        reported: { include: { profile: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;

    const reporterIds = [...new Set(slice.map((r) => r.reporterUserId))];
    const reportedIds = [...new Set(slice.map((r) => r.reportedUserId))];

    const [filedGroups, receivedGroups] = await Promise.all([
      reporterIds.length
        ? this.prisma.report.groupBy({
            by: ['reporterUserId'],
            where: { reporterUserId: { in: reporterIds } },
            _count: { id: true },
          })
        : Promise.resolve([]),
      reportedIds.length
        ? this.prisma.report.groupBy({
            by: ['reportedUserId'],
            where: { reportedUserId: { in: reportedIds } },
            _count: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const filedMap = new Map(filedGroups.map((g) => [g.reporterUserId, g._count.id]));
    const receivedMap = new Map(receivedGroups.map((g) => [g.reportedUserId, g._count.id]));

    const convIds = [...new Set(slice.map((r) => r.conversationId).filter((c): c is string => c !== null))];
    const messageLists =
      convIds.length > 0
        ? await Promise.all(
            convIds.map((cid) =>
              this.prisma.message.findMany({
                where: { conversationId: cid },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 5,
              }),
            ),
          )
        : [];
    const byConv = new Map<string, Message[]>();
    convIds.forEach((cid, i) => {
      byConv.set(cid, messageLists[i] ?? []);
    });

    const items: AdminReportDto[] = slice.map((r) => {
      const convId = r.conversationId;
      const rawMsgs = convId ? (byConv.get(convId) ?? []) : [];
      const chronological = [...rawMsgs].reverse();
      return {
        id: r.id,
        reporterUserId: r.reporterUserId,
        reporterEmail: r.reporter.email,
        reporterFullName: r.reporter.profile?.fullName ?? null,
        reportedUserId: r.reportedUserId,
        reportedEmail: r.reported.email,
        reportedFullName: r.reported.profile?.fullName ?? null,
        conversationId: convId,
        category: r.category,
        detail: r.detail,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        resolverNotes: r.resolverNotes,
        filedByReporterCount: filedMap.get(r.reporterUserId) ?? 0,
        receivedByReportedCount: receivedMap.get(r.reportedUserId) ?? 0,
        conversationMessages: chronological.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    });

    let nextCursor: string | null = null;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1];
      const p: AdminReportListCursor = { v: 1, createdAt: last.createdAt.toISOString(), id: last.id };
      nextCursor = encodeAdminReportCursor(p);
    }

    return { items, nextCursor, hasMore };
  }

  private reportCursorWhere(cursor: AdminReportListCursor): Prisma.ReportWhereInput {
    const t = new Date(cursor.createdAt);
    return {
      OR: [{ createdAt: { gt: t } }, { AND: [{ createdAt: t }, { id: { gt: cursor.id } }] }],
    };
  }

  async patchReport(id: string, body: PatchAdminReportBodyDto): Promise<AdminReportDto> {
    const row = await this.prisma.report.findFirst({ where: { id } });
    if (!row) {
      throw new HttpException({ error: { code: 'NOT_FOUND', message: 'Report not found.' } }, HttpStatus.NOT_FOUND);
    }
    const status = body.status as ReportStatus;
    const terminal = status === ReportStatus.RESOLVED || status === ReportStatus.DISMISSED;
    const updated = await this.prisma.report.update({
      where: { id },
      data: {
        status,
        ...(body.resolverNotes !== undefined ? { resolverNotes: body.resolverNotes } : {}),
        ...(terminal ? { resolvedAt: new Date() } : {}),
      },
      include: {
        reporter: { include: { profile: true } },
        reported: { include: { profile: true } },
      },
    });
    return this.toSingleAdminReportDto(updated);
  }

  private async toSingleAdminReportDto(
    r: Prisma.ReportGetPayload<{
      include: { reporter: { include: { profile: true } }; reported: { include: { profile: true } } };
    }>,
  ): Promise<AdminReportDto> {
    const [filed, received, msgs] = await Promise.all([
      this.prisma.report.count({ where: { reporterUserId: r.reporterUserId } }),
      this.prisma.report.count({ where: { reportedUserId: r.reportedUserId } }),
      r.conversationId
        ? this.prisma.message.findMany({
            where: { conversationId: r.conversationId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 5,
          })
        : Promise.resolve([]),
    ]);
    const chronological = [...msgs].reverse();
    return {
      id: r.id,
      reporterUserId: r.reporterUserId,
      reporterEmail: r.reporter.email,
      reporterFullName: r.reporter.profile?.fullName ?? null,
      reportedUserId: r.reportedUserId,
      reportedEmail: r.reported.email,
      reportedFullName: r.reported.profile?.fullName ?? null,
      conversationId: r.conversationId,
      category: r.category,
      detail: r.detail,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolverNotes: r.resolverNotes,
      filedByReporterCount: filed,
      receivedByReportedCount: received,
      conversationMessages: chronological.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async listManualReviews(raw: AdminManualReviewsQueryDto): Promise<{
    items: { id: string; email: string; companyClaim: string; status: ManualReviewStatus; createdAt: string }[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const q = AdminManualReviewsQuerySchema.parse(raw);
    const status = q.status ?? ManualReviewStatus.PENDING;
    const cursorPayload = q.cursor ? decodeManualReviewCursor(q.cursor) : null;
    if (q.cursor && !cursorPayload) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const where: Prisma.ManualReviewRequestWhereInput = {
      status,
      ...(cursorPayload ? this.manualReviewCursorWhere(cursorPayload) : {}),
    };
    const rows = await this.prisma.manualReviewRequest.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const slice = hasMore ? rows.slice(0, q.limit) : rows;
    const items = slice.map((r) => ({
      id: r.id,
      email: r.email,
      companyClaim: r.companyClaim,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));
    let nextCursor: string | null = null;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1];
      const p: AdminManualReviewListCursor = { v: 1, createdAt: last.createdAt.toISOString(), id: last.id };
      nextCursor = encodeManualReviewCursor(p);
    }
    return { items, nextCursor, hasMore };
  }

  private manualReviewCursorWhere(cursor: AdminManualReviewListCursor): Prisma.ManualReviewRequestWhereInput {
    const t = new Date(cursor.createdAt);
    return {
      OR: [{ createdAt: { gt: t } }, { AND: [{ createdAt: t }, { id: { gt: cursor.id } }] }],
    };
  }

  async approveManualReview(id: string): Promise<{ ok: true; approvedDomain: string; affectedUsers: number }> {
    const req = await this.prisma.manualReviewRequest.findFirst({ where: { id, status: ManualReviewStatus.PENDING } });
    if (!req) {
      throw new HttpException({ error: { code: 'NOT_FOUND', message: 'Request not found.' } }, HttpStatus.NOT_FOUND);
    }
    const domain = req.email.split('@')[1]?.toLowerCase() ?? '';
    if (!domain) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Invalid email on request.' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.manualReviewRequest.update({
        where: { id },
        data: { status: ManualReviewStatus.APPROVED, reviewedAt: new Date() },
      });
      await tx.companyAllowlist.upsert({
        where: { domain },
        create: { domain, companyName: req.companyClaim, isActive: true },
        update: { companyName: req.companyClaim, isActive: true },
      });
      const affected = await tx.user.updateMany({
        where: { email: req.email, companyVerified: false, deletedAt: null },
        data: { companyVerified: true },
      });
      return affected.count;
    });

    await this.domain.refreshAllowlist();

    await this.mail.send({
      to: req.email,
      subject: 'Your company was approved on Burrow',
      html: `<p>Welcome to Burrow. Your company has been approved and you can continue onboarding.</p>`,
      text: 'Welcome to Burrow. Your company has been approved.',
    });

    return { ok: true, approvedDomain: domain, affectedUsers: result };
  }

  async rejectManualReview(id: string, body: ManualReviewRejectBodyDto): Promise<{ ok: true }> {
    const req = await this.prisma.manualReviewRequest.findFirst({ where: { id, status: ManualReviewStatus.PENDING } });
    if (!req) {
      throw new HttpException({ error: { code: 'NOT_FOUND', message: 'Request not found.' } }, HttpStatus.NOT_FOUND);
    }
    await this.prisma.manualReviewRequest.update({
      where: { id },
      data: {
        status: ManualReviewStatus.REJECTED,
        reviewedAt: new Date(),
        rejectReason: body.reason ?? null,
      },
    });
    await this.mail.send({
      to: req.email,
      subject: 'Update on your Burrow signup request',
      html: `<p>Thanks for your interest in Burrow. We were not able to approve your company domain at this time.</p>${
        body.reason ? `<p>${body.reason}</p>` : ''
      }`,
      text: 'Thanks for your interest in Burrow. We were not able to approve your company domain at this time.',
    });
    return { ok: true };
  }

  async getUser(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      include: {
        profile: true,
        listing: true,
        reportsMade: { take: 50, orderBy: { createdAt: 'desc' } },
        reportsReceived: { take: 50, orderBy: { createdAt: 'desc' } },
        blocksInitiated: { take: 50 },
        blocksReceived: { take: 50 },
      },
    });
    if (!user) {
      throw new HttpException({ error: { code: 'NOT_FOUND', message: 'User not found.' } }, HttpStatus.NOT_FOUND);
    }
    const convCount = await this.prisma.conversation.count({
      where: { OR: [{ participantAUserId: userId }, { participantBUserId: userId }] },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        companyName: user.companyName,
        companyVerified: user.companyVerified,
        deletedAt: user.deletedAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      },
      profile: user.profile,
      listing: user.listing,
      conversationsCount: convCount,
      reportsFiled: user.reportsMade,
      reportsReceived: user.reportsReceived,
      blocksInitiated: user.blocksInitiated,
      blocksReceived: user.blocksReceived,
    };
  }

  async banUser(userId: string, body: AdminBanUserBodyDto): Promise<{ ok: true; bannedAt: string }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) {
      throw new HttpException({ error: { code: 'NOT_FOUND', message: 'User not found.' } }, HttpStatus.NOT_FOUND);
    }
    const now = new Date();
    const notes = `User banned: ${body.reason}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { deletedAt: now },
      });
      await tx.listing.updateMany({ where: { userId }, data: { isActive: false } });
      await tx.profile.updateMany({ where: { userId }, data: { deletedAt: now } });
      await tx.report.updateMany({
        where: { reportedUserId: userId, status: ReportStatus.PENDING },
        data: { status: ReportStatus.RESOLVED, resolvedAt: now, resolverNotes: notes },
      });
    });
    await this.mail.send({
      to: user.email,
      subject: 'Your Burrow account has been suspended',
      html: `<p>Your account has been suspended. Reason: ${body.reason}</p><p>To appeal, contact support@burrow.in</p>`,
      text: `Your account has been suspended. Reason: ${body.reason}. To appeal: support@burrow.in`,
    });
    return { ok: true, bannedAt: now.toISOString() };
  }
}
