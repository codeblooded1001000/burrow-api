import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStatus, ReportCategory, ReportStatus } from '@prisma/client';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { resolveMediaRefToPublicUrl } from '../common/photo-url';
import type { Env } from '../config/env.schema';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { normalizeReportConversationId } from './helpers/normalize-report-conversation-id';
import type { PostBlockBodyDto, PostReportBodyDto } from './schemas/safety.schemas';

const LAST_EMAIL_KEY = 'admin:last-report-email';
const PENDING_COUNT_KEY = 'admin:pending-report-count';
const ADMIN_NOTIFY_EMAIL = 'admin@burrow.in';
const EMAIL_TTL_SEC = 60 * 60;

export interface BlockDto {
  id: string;
  blockedUserId: string;
  createdAt: string;
}

export interface BlockListItemDto {
  id: string;
  blockedUser: {
    id: string;
    fullName: string;
    photoUrl: string | null;
    companyName: string;
  };
}

export interface ReportUserSnippetDto {
  id: string;
  fullName: string;
  companyName: string;
}

export interface ReportDto {
  id: string;
  reportedUser: ReportUserSnippetDto;
  category: ReportCategory;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
}

@Injectable()
export class SafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** PENDING threads where the blocked user sent a request to the blocker become REJECTED. */
  private async rejectPendingWhenBlockerReceives(blockerId: string, blockedUserId: string): Promise<void> {
    await this.prisma.conversation.updateMany({
      where: {
        status: ConversationStatus.PENDING,
        OR: [
          { participantAUserId: blockerId, participantBUserId: blockedUserId },
          { participantAUserId: blockedUserId, participantBUserId: blockerId },
        ],
        initiatedByUserId: blockedUserId,
      },
      data: {
        status: ConversationStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedByUserId: blockerId,
      },
    });
  }

  async blockUser(viewer: UserDto, body: PostBlockBodyDto): Promise<{ block: BlockDto; isNew: boolean }> {
    if (body.userId === viewer.id) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Cannot block yourself.' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const target = await this.prisma.user.findFirst({
      where: { id: body.userId, deletedAt: null },
    });
    if (!target) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'User not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const existing = await this.prisma.block.findUnique({
      where: {
        blockerUserId_blockedUserId: { blockerUserId: viewer.id, blockedUserId: body.userId },
      },
    });
    if (existing) {
      await this.rejectPendingWhenBlockerReceives(viewer.id, body.userId);
      return {
        block: {
          id: existing.id,
          blockedUserId: existing.blockedUserId,
          createdAt: existing.createdAt.toISOString(),
        },
        isNew: false,
      };
    }
    const created = await this.prisma.block.create({
      data: { blockerUserId: viewer.id, blockedUserId: body.userId },
    });
    await this.rejectPendingWhenBlockerReceives(viewer.id, body.userId);
    return {
      block: {
        id: created.id,
        blockedUserId: created.blockedUserId,
        createdAt: created.createdAt.toISOString(),
      },
      isNew: true,
    };
  }

  async unblockUser(viewer: UserDto, blockedUserId: string): Promise<{ ok: true; wasBlocking: boolean }> {
    const res = await this.prisma.block.deleteMany({
      where: { blockerUserId: viewer.id, blockedUserId },
    });
    return { ok: true, wasBlocking: res.count > 0 };
  }

  async listBlocks(viewer: UserDto): Promise<{ items: BlockListItemDto[] }> {
    const rows = await this.prisma.block.findMany({
      where: { blockerUserId: viewer.id },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: { include: { profile: true } },
      },
    });
    const items: BlockListItemDto[] = [];
    for (const r of rows) {
      const p = r.blocked.profile;
      if (!p) continue;
      if (p.deletedAt !== null) continue;
      items.push({
        id: r.id,
        blockedUser: {
          id: r.blocked.id,
          fullName: p.fullName,
          photoUrl: resolveMediaRefToPublicUrl(p.photoUrl, this.config.get('R2_PUBLIC_URL', { infer: true })),
          companyName: r.blocked.companyName,
        },
      });
    }
    return { items };
  }

  async createReport(
    viewer: UserDto,
    body: PostReportBodyDto,
  ): Promise<{ report: ReportDto; autoBlocked: boolean; isNew: boolean }> {
    if (body.reportedUserId === viewer.id) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Cannot report yourself.' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const reported = await this.prisma.user.findFirst({
      where: { id: body.reportedUserId, deletedAt: null },
      include: { profile: true },
    });
    if (!reported) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'User not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!reported.profile) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'User not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (reported.profile.deletedAt !== null) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'User not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const conversationId = normalizeReportConversationId(body.conversationId);
    if (conversationId) {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: conversationId },
      });
      if (!conv) {
        throw new HttpException(
          { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
          HttpStatus.NOT_FOUND,
        );
      }
      const a = conv.participantAUserId;
      const b = conv.participantBUserId;
      const ok =
        (a === viewer.id || b === viewer.id) && (a === body.reportedUserId || b === body.reportedUserId);
      if (!ok) {
        throw new HttpException(
          { error: { code: 'INVALID_INPUT', message: 'Conversation does not involve both users.' } },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const existingPending = await this.prisma.report.findFirst({
      where: {
        reporterUserId: viewer.id,
        reportedUserId: body.reportedUserId,
        conversationId,
        status: ReportStatus.PENDING,
      },
    });
    if (existingPending) {
      return { report: this.toReportDto(existingPending, reported), autoBlocked: false, isNew: false };
    }

    const detail = body.detail?.trim() ?? '';
    const category = body.category;

    const { report, autoBlocked } = await this.prisma.$transaction(async (tx) => {
      const rep = await tx.report.create({
        data: {
          reporterUserId: viewer.id,
          reportedUserId: body.reportedUserId,
          conversationId,
          category,
          detail,
        },
      });
      const blockRow = await tx.block.findUnique({
        where: {
          blockerUserId_blockedUserId: {
            blockerUserId: viewer.id,
            blockedUserId: body.reportedUserId,
          },
        },
      });
      let blocked = false;
      if (!blockRow) {
        await tx.block.create({
          data: { blockerUserId: viewer.id, blockedUserId: body.reportedUserId },
        });
        blocked = true;
      }
      await tx.conversation.updateMany({
        where: {
          status: ConversationStatus.PENDING,
          OR: [
            { participantAUserId: viewer.id, participantBUserId: body.reportedUserId },
            { participantAUserId: body.reportedUserId, participantBUserId: viewer.id },
          ],
          initiatedByUserId: body.reportedUserId,
        },
        data: {
          status: ConversationStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedByUserId: viewer.id,
        },
      });
      return { report: rep, autoBlocked: blocked };
    });

    await this.sendAdminReportNotification(report.id, category, viewer.id, body.reportedUserId);

    return { report: this.toReportDto(report, reported), autoBlocked, isNew: true };
  }

  async listMyReports(viewer: UserDto): Promise<{ items: ReportDto[] }> {
    const rows = await this.prisma.report.findMany({
      where: { reporterUserId: viewer.id },
      orderBy: { createdAt: 'desc' },
      include: {
        reported: { include: { profile: true } },
      },
    });
    const items: ReportDto[] = [];
    for (const r of rows) {
      const p = r.reported.profile;
      if (!p) continue;
      if (p.deletedAt !== null) continue;
      items.push(this.toReportDto(r, r.reported));
    }
    return { items };
  }

  private toReportDto(
    r: { id: string; category: ReportCategory; status: ReportStatus; createdAt: Date; resolvedAt: Date | null },
    reported: { id: string; companyName: string; profile: { fullName: string } | null },
  ): ReportDto {
    const p = reported.profile;
    return {
      id: r.id,
      reportedUser: {
        id: reported.id,
        fullName: p?.fullName ?? 'Unknown',
        companyName: reported.companyName,
      },
      category: r.category,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    };
  }

  private async sendAdminReportNotification(
    reportId: string,
    category: ReportCategory,
    reporterId: string,
    reportedId: string,
  ): Promise<void> {
    const lastSentRaw = await this.redis.get(LAST_EMAIL_KEY);
    const now = Date.now();

    if (lastSentRaw !== null && lastSentRaw !== '') {
      const last = Number.parseInt(lastSentRaw, 10);
      if (Number.isFinite(last) && now - last < 5 * 60 * 1000) {
        await this.redis.incr(PENDING_COUNT_KEY);
        return;
      }
    }

    const pendingRaw = await this.redis.get(PENDING_COUNT_KEY);
    const pending = pendingRaw !== null && pendingRaw !== '' ? Number.parseInt(pendingRaw, 10) : 0;
    const batch = Number.isFinite(pending) ? pending + 1 : 1;
    const subject =
      batch > 1 ? `${String(batch)} new reports awaiting review` : 'New report on Burrow';

    const html = `<p>A new report was filed on Burrow.</p>
<ul>
<li>Report id: ${reportId}</li>
<li>Category: ${category}</li>
<li>Reporter user id: ${reporterId}</li>
<li>Reported user id: ${reportedId}</li>
</ul>
<p>Open the admin panel to review.</p>`;

    await this.mail.send({
      to: ADMIN_NOTIFY_EMAIL,
      subject,
      html,
      text: `Report ${reportId}: category ${category}, reporter ${reporterId}, reported ${reportedId}`,
    });

    await this.redis.set(LAST_EMAIL_KEY, String(now), EMAIL_TTL_SEC);
    await this.redis.set(PENDING_COUNT_KEY, '0', EMAIL_TTL_SEC);
  }
}
