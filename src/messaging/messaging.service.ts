import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStatus, Prisma } from '@prisma/client';
import type { Conversation, Message, NumberShareRequest, Profile, User } from '@prisma/client';
import { NumberShareStatus } from '@prisma/client';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { resolveMediaRefToPublicUrl } from '../common/photo-url';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { normalizeConversationParticipants } from './helpers/conversation-participants';
import { MessagingBlockService } from './helpers/messaging-block.service';
import { MessagingRateLimitService } from './helpers/messaging-rate-limit.service';
import {
  ConversationListQuerySchema,
  MessageListQuerySchema,
  decodeConversationListCursor,
  decodeConversationRequestsListCursor,
  decodeMessageHistoryCursor,
  encodeConversationListCursor,
  encodeConversationRequestsListCursor,
  encodeMessageHistoryCursor,
  type ConversationListCursorPayload,
  type ConversationListQueryDto,
  type ConversationRequestsListCursorPayload,
  type MessageListQueryDto,
  type NumberShareRespondBodyDto,
  type PatchMessagesReadBodyDto,
  type PostConversationBodyDto,
  type PostMessageBodyDto,
  type PostRejectConversationBodyDto,
} from './schemas/messaging.schemas';
import { SseService } from './sse.service';

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface NumberShareRequestDto {
  id: string;
  conversationId: string;
  requestedByUserId: string;
  status: NumberShareStatus;
  createdAt: string;
  respondedAt: string | null;
}

export interface ConversationParticipantSnippetDto {
  id: string;
  fullName: string;
  photoUrl: string | null;
  companyName: string;
  companyVerified: boolean;
}

export interface ConversationSummaryDto {
  id: string;
  createdAt: string;
  lastMessageAt: string | null;
  numbersShared: boolean;
  status: ConversationStatus;
  initiatedByUserId: string;
  acceptedAt: string | null;
  otherParticipant: ConversationParticipantSnippetDto;
  lastMessage: MessageDto | null;
  unreadCount: number;
  pendingNumberShareRequest?: NumberShareRequestDto;
  /** Present only when `numbersShared` is true. */
  myPhoneNumber?: string | null;
  /** Present only when `numbersShared` is true. */
  otherPhoneNumber?: string | null;
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: MessagingBlockService,
    private readonly rate: MessagingRateLimitService,
    private readonly sse: SseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private static cannotSendRequest(): HttpException {
    return new HttpException(
      { error: { code: 'CANNOT_SEND_REQUEST', message: 'Cannot send request to this user.' } },
      HttpStatus.NOT_FOUND,
    );
  }

  private async invalidateUnreadCache(userId: string): Promise<void> {
    await this.redis.del(`messaging:unread:${userId}`);
  }

  async getUnreadCount(viewerId: string): Promise<{ count: number }> {
    const key = `messaging:unread:${viewerId}`;
    const hit = await this.redis.get(key);
    if (hit !== null && hit !== '') {
      const n = Number.parseInt(hit, 10);
      if (Number.isFinite(n)) return { count: n };
    }
    const count = await this.countUnreadMessages(viewerId);
    await this.redis.set(key, String(count), 5);
    return { count };
  }

  private async countUnreadMessages(viewerId: string): Promise<number> {
    return this.prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: viewerId },
        conversation: {
          status: ConversationStatus.ACTIVE,
          OR: [{ participantAUserId: viewerId }, { participantBUserId: viewerId }],
        },
      },
    });
  }

  private otherUserId(conv: Conversation, viewerId: string): string {
    return conv.participantAUserId === viewerId ? conv.participantBUserId : conv.participantAUserId;
  }

  private isParticipant(conv: Conversation, viewerId: string): boolean {
    return conv.participantAUserId === viewerId || conv.participantBUserId === viewerId;
  }

  private conversationHiddenForViewer(
    conv: Conversation & {
      participantA: User & { profile: Profile | null };
      participantB: User & { profile: Profile | null };
    },
    viewerId: string,
  ): boolean {
    const otherId = this.otherUserId(conv, viewerId);
    const other = conv.participantAUserId === otherId ? conv.participantA : conv.participantB;
    if (other.deletedAt !== null) return true;
    if (!other.profile) return true;
    if (other.profile.deletedAt !== null) return true;
    return false;
  }

  private async assertParticipant(conversationId: string, viewerId: string): Promise<Conversation> {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId } });
    if (!conv || !this.isParticipant(conv, viewerId)) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    return conv;
  }

  private async assertConversationReadable(conversationId: string, viewerId: string): Promise<Conversation> {
    const conv = await this.assertParticipant(conversationId, viewerId);
    if (conv.status === ConversationStatus.REJECTED || conv.status === ConversationStatus.ARCHIVED) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    return conv;
  }

  private toMessageDto(m: Message): MessageDto {
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
    };
  }

  private toNumberShareDto(r: NumberShareRequest): NumberShareRequestDto {
    return {
      id: r.id,
      conversationId: r.conversationId,
      requestedByUserId: r.requestedByUserId,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
    };
  }

  private async buildConversationSummary(
    conv: Conversation & {
      participantA: User & { profile: Profile | null };
      participantB: User & { profile: Profile | null };
      messages: Message[];
      numberShareRequests: NumberShareRequest[];
    },
    viewerId: string,
  ): Promise<ConversationSummaryDto | null> {
    if (this.conversationHiddenForViewer(conv, viewerId)) return null;

    const otherId = this.otherUserId(conv, viewerId);
    const blockedOther = await this.prisma.block.findFirst({
      where: { OR: [{ blockerUserId: viewerId, blockedUserId: otherId }, { blockerUserId: otherId, blockedUserId: viewerId }] },
    });
    if (blockedOther) return null;

    if (conv.status === ConversationStatus.PENDING && conv.initiatedByUserId === viewerId) {
      const viewerBlockedReceiver = await this.prisma.block.findFirst({
        where: { blockerUserId: viewerId, blockedUserId: otherId },
      });
      if (viewerBlockedReceiver) return null;
    }

    const other = conv.participantAUserId === otherId ? conv.participantA : conv.participantB;
    const p = other.profile;
    if (!p) return null;

    const firstMessage = conv.messages.at(0);
    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId: conv.id,
        senderId: { not: viewerId },
        readAt: null,
      },
    });
    const pending = conv.numberShareRequests.find((r) => r.status === NumberShareStatus.PENDING);

    const base: ConversationSummaryDto = {
      id: conv.id,
      createdAt: conv.createdAt.toISOString(),
      lastMessageAt: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
      numbersShared: conv.numbersShared,
      status: conv.status,
      initiatedByUserId: conv.initiatedByUserId,
      acceptedAt: conv.acceptedAt ? conv.acceptedAt.toISOString() : null,
      otherParticipant: {
        id: other.id,
        fullName: p.fullName,
        photoUrl: resolveMediaRefToPublicUrl(p.photoUrl, this.config.get('R2_PUBLIC_URL', { infer: true })),
        companyName: other.companyName,
        companyVerified: other.companyVerified,
      },
      lastMessage: firstMessage ? this.toMessageDto(firstMessage) : null,
      unreadCount,
      ...(pending ? { pendingNumberShareRequest: this.toNumberShareDto(pending) } : {}),
    };

    if (conv.numbersShared) {
      const me = conv.participantAUserId === viewerId ? conv.participantA : conv.participantB;
      const them = conv.participantAUserId === otherId ? conv.participantA : conv.participantB;
      return {
        ...base,
        myPhoneNumber: me.phoneNumber,
        otherPhoneNumber: them.phoneNumber,
      };
    }
    return base;
  }

  async lookupConversationWithParticipant(
    viewer: UserDto,
    otherUserId: string,
  ): Promise<{ conversationId: string | null }> {
    if (otherUserId === viewer.id) {
      return { conversationId: null };
    }
    const [a, b] = normalizeConversationParticipants(viewer.id, otherUserId);
    const row = await this.prisma.conversation.findUnique({
      where: {
        participantAUserId_participantBUserId: {
          participantAUserId: a,
          participantBUserId: b,
        },
      },
      include: {
        participantA: { include: { profile: true } },
        participantB: { include: { profile: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
      },
    });
    if (!row) {
      return { conversationId: null };
    }
    if (row.status === ConversationStatus.REJECTED || row.status === ConversationStatus.ARCHIVED) {
      return { conversationId: null };
    }
    const dto = await this.buildConversationSummary(row, viewer.id);
    return { conversationId: dto?.id ?? null };
  }

  private conversationTabWhere(viewerId: string, tab: 'active' | 'requests' | 'all'): Prisma.ConversationWhereInput {
    const participantOr: Prisma.ConversationWhereInput = {
      OR: [{ participantAUserId: viewerId }, { participantBUserId: viewerId }],
    };
    if (tab === 'active') {
      return { AND: [participantOr, { status: ConversationStatus.ACTIVE }] };
    }
    if (tab === 'requests') {
      return {
        AND: [
          participantOr,
          { status: ConversationStatus.PENDING },
          { initiatedByUserId: { not: viewerId } },
        ],
      };
    }
    return {
      AND: [
        participantOr,
        {
          OR: [
            { status: ConversationStatus.ACTIVE },
            {
              AND: [{ status: ConversationStatus.PENDING }, { initiatedByUserId: { not: viewerId } }],
            },
          ],
        },
      ],
    };
  }

  private conversationRequestsListCursorWhere(
    cursor: ConversationRequestsListCursorPayload | null,
  ): Prisma.ConversationWhereInput {
    if (!cursor) return {};
    const t = new Date(cursor.createdAt);
    return {
      OR: [{ createdAt: { lt: t } }, { AND: [{ createdAt: t }, { id: { lt: cursor.id } }] }],
    };
  }

  async listConversations(viewer: UserDto, rawQuery: ConversationListQueryDto): Promise<{
    items: ConversationSummaryDto[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const query = ConversationListQuerySchema.parse(rawQuery);
    const tab = query.tab;

    if (tab === 'requests') {
      const cursorPayload = query.cursor ? decodeConversationRequestsListCursor(query.cursor) : null;
      if (query.cursor && !cursorPayload) {
        throw new HttpException(
          { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
          HttpStatus.BAD_REQUEST,
        );
      }
      const cursorWhere = this.conversationRequestsListCursorWhere(cursorPayload);
      const rows = await this.prisma.conversation.findMany({
        where: {
          AND: [this.conversationTabWhere(viewer.id, tab), cursorWhere],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        include: {
          participantA: { include: { profile: true } },
          participantB: { include: { profile: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
        },
      });
      const hasMore = rows.length > query.limit;
      const slice = hasMore ? rows.slice(0, query.limit) : rows;
      const items: ConversationSummaryDto[] = [];
      for (const r of slice) {
        const dto = await this.buildConversationSummary(r, viewer.id);
        if (dto) items.push(dto);
      }
      let nextCursor: string | null = null;
      if (hasMore && slice.length > 0) {
        const last = slice[slice.length - 1];
        nextCursor = encodeConversationRequestsListCursor({
          v: 2,
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        });
      }
      return { items, nextCursor, hasMore };
    }

    const cursorPayload = query.cursor ? decodeConversationListCursor(query.cursor) : null;
    if (query.cursor && !cursorPayload) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const cursorWhere = this.conversationListCursorWhere(cursorPayload);

    const rows = await this.prisma.conversation.findMany({
      where: {
        AND: [this.conversationTabWhere(viewer.id, tab), cursorWhere],
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        participantA: { include: { profile: true } },
        participantB: { include: { profile: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
      },
    });

    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;
    const items: ConversationSummaryDto[] = [];
    for (const r of slice) {
      const dto = await this.buildConversationSummary(r, viewer.id);
      if (dto) items.push(dto);
    }

    let nextCursor: string | null = null;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1];
      const p: ConversationListCursorPayload = {
        v: 1,
        lastMessageAt: last.lastMessageAt ? last.lastMessageAt.toISOString() : null,
        id: last.id,
      };
      nextCursor = encodeConversationListCursor(p);
    }

    return { items, nextCursor, hasMore };
  }

  async listSentRequests(viewer: UserDto): Promise<{ items: ConversationSummaryDto[] }> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        status: ConversationStatus.PENDING,
        initiatedByUserId: viewer.id,
        OR: [{ participantAUserId: viewer.id }, { participantBUserId: viewer.id }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      include: {
        participantA: { include: { profile: true } },
        participantB: { include: { profile: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
      },
    });
    const items: ConversationSummaryDto[] = [];
    for (const r of rows) {
      const dto = await this.buildConversationSummary(r, viewer.id);
      if (dto) items.push(dto);
    }
    return { items };
  }

  private conversationListCursorWhere(
    cursor: ConversationListCursorPayload | null,
  ): Prisma.ConversationWhereInput {
    if (!cursor) return {};
    if (cursor.lastMessageAt === null) {
      return { AND: [{ lastMessageAt: null }, { id: { lt: cursor.id } }] };
    }
    const t = new Date(cursor.lastMessageAt);
    return {
      OR: [{ lastMessageAt: { lt: t } }, { AND: [{ lastMessageAt: t }, { id: { lt: cursor.id } }] }],
    };
  }

  async getConversation(viewer: UserDto, conversationId: string): Promise<ConversationSummaryDto> {
    const row = await this.prisma.conversation.findFirst({
      where: { id: conversationId },
      include: {
        participantA: { include: { profile: true } },
        participantB: { include: { profile: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
      },
    });
    if (!row || !this.isParticipant(row, viewer.id)) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.status === ConversationStatus.REJECTED || row.status === ConversationStatus.ARCHIVED) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const dto = await this.buildConversationSummary(row, viewer.id);
    if (!dto) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    return dto;
  }

  async acceptConversationRequest(viewer: UserDto, conversationId: string): Promise<{ conversation: ConversationSummaryDto }> {
    const row = await this.prisma.conversation.findFirst({
      where: { id: conversationId },
      include: {
        participantA: { include: { profile: true } },
        participantB: { include: { profile: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
      },
    });
    if (!row || !this.isParticipant(row, viewer.id)) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.initiatedByUserId === viewer.id) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'Only the recipient can accept this request.' } },
        HttpStatus.FORBIDDEN,
      );
    }
    if (row.status !== ConversationStatus.PENDING) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'This conversation is not awaiting acceptance.' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const otherId = this.otherUserId(row, viewer.id);
    await this.blocks.assertCanMessage(viewer.id, otherId);

    await this.prisma.$transaction(async (tx) => {
      const u = await tx.conversation.updateMany({
        where: { id: conversationId, status: ConversationStatus.PENDING },
        data: {
          status: ConversationStatus.ACTIVE,
          acceptedAt: new Date(),
        },
      });
      if (u.count !== 1) {
        throw new HttpException(
          { error: { code: 'INVALID_INPUT', message: 'This conversation is not awaiting acceptance.' } },
          HttpStatus.BAD_REQUEST,
        );
      }
    });

    this.sse.publish(row.initiatedByUserId, {
      type: 'request_accepted',
      data: { conversationId, byUserId: viewer.id },
    });

    const conversation = await this.getConversation(viewer, conversationId);
    return { conversation };
  }

  async rejectConversationRequest(
    viewer: UserDto,
    conversationId: string,
    body: PostRejectConversationBodyDto,
  ): Promise<{ ok: true }> {
    const row = await this.prisma.conversation.findFirst({ where: { id: conversationId } });
    if (!row || !this.isParticipant(row, viewer.id)) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.initiatedByUserId === viewer.id) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'Only the recipient can reject this request.' } },
        HttpStatus.FORBIDDEN,
      );
    }
    if (row.status !== ConversationStatus.PENDING) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'This conversation is not awaiting acceptance.' } },
        HttpStatus.BAD_REQUEST,
      );
    }
    const otherId = this.otherUserId(row, viewer.id);
    await this.blocks.assertCanMessage(viewer.id, otherId);

    const reason = body.reason?.trim();
    const rejectReason = reason && reason.length > 0 ? reason.slice(0, 200) : null;

    await this.prisma.$transaction(async (tx) => {
      const u = await tx.conversation.updateMany({
        where: { id: conversationId, status: ConversationStatus.PENDING },
        data: {
          status: ConversationStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedByUserId: viewer.id,
          rejectReason,
        },
      });
      if (u.count !== 1) {
        throw new HttpException(
          { error: { code: 'INVALID_INPUT', message: 'This conversation is not awaiting acceptance.' } },
          HttpStatus.BAD_REQUEST,
        );
      }
    });

    this.sse.publish(row.initiatedByUserId, {
      type: 'request_rejected',
      data: { conversationId, byUserId: viewer.id },
    });

    await this.invalidateUnreadCache(row.initiatedByUserId);
    await this.invalidateUnreadCache(viewer.id);

    return { ok: true };
  }

  async createConversation(
    viewer: UserDto,
    body: PostConversationBodyDto,
  ): Promise<{ conversation: ConversationSummaryDto; message: MessageDto }> {
    const recipientUserId = body.recipientUserId;
    await this.blocks.assertCanMessage(viewer.id, recipientUserId);

    const recipient = await this.prisma.user.findFirst({
      where: {
        id: recipientUserId,
        deletedAt: null,
        companyVerified: true,
        profile: { is: { deletedAt: null } },
      },
      include: { profile: true },
    });
    if (!recipient?.profile) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'That user cannot be messaged.' } },
        HttpStatus.NOT_FOUND,
      );
    }

    const [a, b] = normalizeConversationParticipants(viewer.id, recipientUserId);
    const existing = await this.prisma.conversation.findUnique({
      where: {
        participantAUserId_participantBUserId: {
          participantAUserId: a,
          participantBUserId: b,
        },
      },
      include: {
        participantA: { include: { profile: true } },
        participantB: { include: { profile: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
      },
    });

    if (existing) {
      if (existing.status === ConversationStatus.REJECTED && existing.initiatedByUserId === viewer.id) {
        throw MessagingService.cannotSendRequest();
      }

      if (existing.status === ConversationStatus.ARCHIVED) {
        const msg = await this.prisma.$transaction(async (tx) => {
          const m = await tx.message.create({
            data: {
              conversationId: existing.id,
              senderId: viewer.id,
              body: body.initialMessage,
            },
          });
          await tx.conversation.update({
            where: { id: existing.id },
            data: {
              status: ConversationStatus.PENDING,
              initiatedByUserId: viewer.id,
              acceptedAt: null,
              rejectedAt: null,
              rejectedByUserId: null,
              archivedAt: null,
              rejectReason: null,
              lastMessageAt: m.createdAt,
            },
          });
          return m;
        });
        const full = await this.prisma.conversation.findFirstOrThrow({
          where: { id: existing.id },
          include: {
            participantA: { include: { profile: true } },
            participantB: { include: { profile: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
            numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
          },
        });
        const summary = await this.buildConversationSummary(full, viewer.id);
        if (!summary) {
          throw new HttpException(
            { error: { code: 'INTERNAL', message: 'Failed to load conversation.' } },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
        const messageDto = this.toMessageDto(msg);
        this.sse.publish(recipientUserId, {
          type: 'request_received',
          data: { conversationId: full.id, fromUserId: viewer.id, intro: body.initialMessage },
        });
        this.sse.publish(recipientUserId, {
          type: 'conversation_updated',
          data: { conversationId: full.id, lastMessageAt: full.lastMessageAt?.toISOString() ?? null },
        });
        this.sse.publish(viewer.id, {
          type: 'conversation_updated',
          data: { conversationId: full.id, lastMessageAt: full.lastMessageAt?.toISOString() ?? null },
        });
        await this.invalidateUnreadCache(recipientUserId);
        return { conversation: summary, message: messageDto };
      }

      if (existing.status === ConversationStatus.REJECTED && existing.initiatedByUserId !== viewer.id) {
        const msg = await this.prisma.$transaction(async (tx) => {
          const m = await tx.message.create({
            data: {
              conversationId: existing.id,
              senderId: viewer.id,
              body: body.initialMessage,
            },
          });
          await tx.conversation.update({
            where: { id: existing.id },
            data: {
              status: ConversationStatus.PENDING,
              initiatedByUserId: viewer.id,
              acceptedAt: null,
              rejectedAt: null,
              rejectedByUserId: null,
              archivedAt: null,
              rejectReason: null,
              lastMessageAt: m.createdAt,
            },
          });
          return m;
        });
        const full = await this.prisma.conversation.findFirstOrThrow({
          where: { id: existing.id },
          include: {
            participantA: { include: { profile: true } },
            participantB: { include: { profile: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
            numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
          },
        });
        const summary = await this.buildConversationSummary(full, viewer.id);
        if (!summary) {
          throw new HttpException(
            { error: { code: 'INTERNAL', message: 'Failed to load conversation.' } },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
        const messageDto = this.toMessageDto(msg);
        this.sse.publish(recipientUserId, {
          type: 'request_received',
          data: { conversationId: full.id, fromUserId: viewer.id, intro: body.initialMessage },
        });
        this.sse.publish(recipientUserId, {
          type: 'conversation_updated',
          data: { conversationId: full.id, lastMessageAt: full.lastMessageAt?.toISOString() ?? null },
        });
        this.sse.publish(viewer.id, {
          type: 'conversation_updated',
          data: { conversationId: full.id, lastMessageAt: full.lastMessageAt?.toISOString() ?? null },
        });
        await this.invalidateUnreadCache(recipientUserId);
        return { conversation: summary, message: messageDto };
      }

      if (existing.status === ConversationStatus.ACTIVE) {
        const latest = await this.prisma.message.findFirst({
          where: { conversationId: existing.id },
          orderBy: { createdAt: 'desc' },
        });
        const summary = await this.buildConversationSummary(existing, viewer.id);
        if (!summary) {
          throw new HttpException(
            { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
            HttpStatus.NOT_FOUND,
          );
        }
        return {
          conversation: summary,
          message: latest ? this.toMessageDto(latest) : this.toMessageDto(await this.firstMessageFallback(existing.id)),
        };
      }

      if (existing.status === ConversationStatus.PENDING) {
        const latest = await this.prisma.message.findFirst({
          where: { conversationId: existing.id },
          orderBy: { createdAt: 'desc' },
        });
        const summary = await this.buildConversationSummary(existing, viewer.id);
        if (!summary) {
          throw new HttpException(
            { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
            HttpStatus.NOT_FOUND,
          );
        }
        return {
          conversation: summary,
          message: latest ? this.toMessageDto(latest) : this.toMessageDto(await this.firstMessageFallback(existing.id)),
        };
      }
    }

    let reserved = false;
    try {
      await this.rate.reserveNewConversationSlot(viewer.id);
      reserved = true;

      const created = await this.prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.create({
          data: {
            participantAUserId: a,
            participantBUserId: b,
            lastMessageAt: new Date(),
            status: ConversationStatus.PENDING,
            initiatedByUserId: viewer.id,
          },
        });
        const msg = await tx.message.create({
          data: {
            conversationId: conv.id,
            senderId: viewer.id,
            body: body.initialMessage,
          },
        });
        await tx.conversation.update({
          where: { id: conv.id },
          data: { lastMessageAt: msg.createdAt },
        });
        return { convId: conv.id, msg };
      });

      const full = await this.prisma.conversation.findFirstOrThrow({
        where: { id: created.convId },
        include: {
          participantA: { include: { profile: true } },
          participantB: { include: { profile: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          numberShareRequests: { where: { status: NumberShareStatus.PENDING } },
        },
      });
      const summary = await this.buildConversationSummary(full, viewer.id);
      if (!summary) {
        throw new HttpException(
          { error: { code: 'INTERNAL', message: 'Failed to load conversation.' } },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      const messageDto = this.toMessageDto(
        full.messages[0] ?? (await this.prisma.message.findFirstOrThrow({ where: { id: created.msg.id } })),
      );

      await this.invalidateUnreadCache(recipientUserId);
      this.sse.publish(recipientUserId, {
        type: 'request_received',
        data: { conversationId: full.id, fromUserId: viewer.id, intro: body.initialMessage },
      });
      this.sse.publish(recipientUserId, {
        type: 'conversation_updated',
        data: { conversationId: full.id, lastMessageAt: full.lastMessageAt?.toISOString() ?? null },
      });
      this.sse.publish(viewer.id, {
        type: 'conversation_updated',
        data: { conversationId: full.id, lastMessageAt: full.lastMessageAt?.toISOString() ?? null },
      });

      return { conversation: summary, message: messageDto };
    } catch (e) {
      if (reserved) await this.rate.releaseNewConversationSlot(viewer.id);
      throw e;
    }
  }

  private async firstMessageFallback(conversationId: string): Promise<Message> {
    return this.prisma.message.findFirstOrThrow({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listMessages(
    viewer: UserDto,
    conversationId: string,
    rawQuery: MessageListQueryDto,
  ): Promise<{ items: MessageDto[]; nextCursor: string | null; hasMore: boolean }> {
    await this.assertConversationReadable(conversationId, viewer.id);
    const query = MessageListQuerySchema.parse(rawQuery);
    const cur = query.cursor ? decodeMessageHistoryCursor(query.cursor) : null;
    if (query.cursor && !cur) {
      throw new HttpException(
        { error: { code: 'INVALID_INPUT', message: 'Invalid pagination cursor.' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    let beforeMsg: Message | null = null;
    if (cur) {
      beforeMsg = await this.prisma.message.findFirst({
        where: { id: cur.beforeMessageId, conversationId },
      });
      if (!beforeMsg) {
        throw new HttpException(
          { error: { code: 'INVALID_INPUT', message: 'Invalid cursor message.' } },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const where: Prisma.MessageWhereInput = {
      conversationId,
      ...(beforeMsg
        ? {
            OR: [
              { createdAt: { lt: beforeMsg.createdAt } },
              { AND: [{ createdAt: beforeMsg.createdAt }, { id: { lt: beforeMsg.id } }] },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;
    const items = slice.map((m) => this.toMessageDto(m));

    const idsToMark = slice.filter((m) => m.senderId !== viewer.id && m.readAt === null).map((m) => m.id);
    if (idsToMark.length > 0) {
      await this.prisma.message.updateMany({
        where: { id: { in: idsToMark } },
        data: { readAt: new Date() },
      });
      const otherId = slice.find((m) => m.senderId !== viewer.id)?.senderId;
      if (otherId) {
        this.sse.publish(otherId, {
          type: 'message_read',
          data: { conversationId, readerId: viewer.id },
        });
      }
      await this.invalidateUnreadCache(viewer.id);
      if (otherId) await this.invalidateUnreadCache(otherId);
    }

    let nextCursor: string | null = null;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1];
      nextCursor = encodeMessageHistoryCursor({ v: 1, beforeMessageId: last.id });
    }

    return { items, nextCursor, hasMore };
  }

  async sendMessage(
    viewer: UserDto,
    conversationId: string,
    body: PostMessageBodyDto,
  ): Promise<{ message: MessageDto }> {
    const conv = await this.assertParticipant(conversationId, viewer.id);
    const otherId = this.otherUserId(conv, viewer.id);
    await this.blocks.assertCanMessage(viewer.id, otherId);

    if (conv.status === ConversationStatus.REJECTED || conv.status === ConversationStatus.ARCHIVED) {
      throw new HttpException(
        {
          error: {
            code: 'CONVERSATION_CLOSED',
            message: 'This conversation is no longer available.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (conv.status === ConversationStatus.PENDING) {
      if (conv.initiatedByUserId === viewer.id) {
        throw new HttpException(
          {
            error: {
              code: 'REQUEST_PENDING_ACCEPTANCE',
              message:
                "They haven't accepted your request yet. You can send another message once they reply or accept.",
            },
          },
          HttpStatus.FORBIDDEN,
        );
      }

      await this.rate.assertMessageSendRate(viewer.id);

      const msg = await this.prisma.$transaction(async (tx) => {
        const u = await tx.conversation.updateMany({
          where: { id: conversationId, status: ConversationStatus.PENDING },
          data: {
            status: ConversationStatus.ACTIVE,
            acceptedAt: new Date(),
          },
        });
        if (u.count !== 1) {
          throw new HttpException(
            {
              error: {
                code: 'CONVERSATION_CLOSED',
                message: 'This conversation is no longer available.',
              },
            },
            HttpStatus.FORBIDDEN,
          );
        }
        const m = await tx.message.create({
          data: { conversationId, senderId: viewer.id, body: body.body },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: m.createdAt },
        });
        return m;
      });

      const dto = this.toMessageDto(msg);
      await this.invalidateUnreadCache(otherId);
      await this.invalidateUnreadCache(viewer.id);

      this.sse.publish(conv.initiatedByUserId, {
        type: 'request_accepted',
        data: { conversationId, byUserId: viewer.id },
      });
      this.sse.publish(otherId, {
        type: 'message_new',
        conversationId,
        data: dto as unknown as Record<string, unknown>,
      });
      this.sse.publish(otherId, {
        type: 'conversation_updated',
        data: { conversationId, lastMessageAt: msg.createdAt.toISOString() },
      });
      this.sse.publish(viewer.id, {
        type: 'conversation_updated',
        data: { conversationId, lastMessageAt: msg.createdAt.toISOString() },
      });

      return { message: dto };
    }

    await this.rate.assertMessageSendRate(viewer.id);

    const msg = await this.prisma.$transaction(async (tx) => {
      const m = await tx.message.create({
        data: { conversationId, senderId: viewer.id, body: body.body },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: m.createdAt },
      });
      return m;
    });

    const dto = this.toMessageDto(msg);
    await this.invalidateUnreadCache(otherId);
    await this.invalidateUnreadCache(viewer.id);

    this.sse.publish(otherId, {
      type: 'message_new',
      conversationId,
      data: dto as unknown as Record<string, unknown>,
    });
    this.sse.publish(otherId, {
      type: 'conversation_updated',
      data: { conversationId, lastMessageAt: msg.createdAt.toISOString() },
    });
    this.sse.publish(viewer.id, {
      type: 'conversation_updated',
      data: { conversationId, lastMessageAt: msg.createdAt.toISOString() },
    });

    return { message: dto };
  }

  async markMessagesRead(
    viewer: UserDto,
    conversationId: string,
    body: PatchMessagesReadBodyDto,
  ): Promise<{ markedRead: number }> {
    await this.assertConversationReadable(conversationId, viewer.id);

    let whereExtra: Prisma.MessageWhereInput = {};
    if (body.upToMessageId) {
      const anchor = await this.prisma.message.findFirst({
        where: { id: body.upToMessageId, conversationId },
      });
      if (!anchor) {
        throw new HttpException(
          { error: { code: 'NOT_FOUND', message: 'Message not found in this conversation.' } },
          HttpStatus.NOT_FOUND,
        );
      }
      whereExtra = { createdAt: { lte: anchor.createdAt } };
    }

    const res = await this.prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: viewer.id },
        readAt: null,
        ...whereExtra,
      },
      data: { readAt: new Date() },
    });

    const conv = await this.prisma.conversation.findFirstOrThrow({ where: { id: conversationId } });
    const otherId = this.otherUserId(conv, viewer.id);
    this.sse.publish(otherId, {
      type: 'message_read',
      data: { conversationId, upToMessageId: body.upToMessageId, readerId: viewer.id },
    });
    await this.invalidateUnreadCache(viewer.id);
    await this.invalidateUnreadCache(otherId);
    return { markedRead: res.count };
  }

  async requestNumberShare(viewer: UserDto, conversationId: string): Promise<{ request: NumberShareRequestDto }> {
    const conv = await this.assertParticipant(conversationId, viewer.id);
    if (conv.status !== ConversationStatus.ACTIVE) {
      throw new HttpException(
        {
          error: {
            code: 'CONVERSATION_CLOSED',
            message: 'This conversation is no longer available.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const otherId = this.otherUserId(conv, viewer.id);
    await this.blocks.assertCanMessage(viewer.id, otherId);
    if (conv.numbersShared) {
      throw new HttpException(
        { error: { code: 'CONFLICT', message: 'Numbers are already shared in this conversation.' } },
        HttpStatus.CONFLICT,
      );
    }
    const pending = await this.prisma.numberShareRequest.findFirst({
      where: { conversationId, status: NumberShareStatus.PENDING },
    });
    if (pending) {
      throw new HttpException(
        { error: { code: 'CONFLICT', message: 'A number share request is already pending.' } },
        HttpStatus.CONFLICT,
      );
    }
    const req = await this.prisma.numberShareRequest.create({
      data: {
        conversationId,
        requestedByUserId: viewer.id,
        status: NumberShareStatus.PENDING,
      },
    });
    const dto = this.toNumberShareDto(req);
    this.sse.publish(otherId, { type: 'number_share_requested', data: dto as unknown as Record<string, unknown> });
    return { request: dto };
  }

  async respondNumberShare(
    viewer: UserDto,
    conversationId: string,
    body: NumberShareRespondBodyDto,
  ): Promise<{
    request: NumberShareRequestDto;
    phoneNumbers?: { requesterPhone: string | null; responderPhone: string | null };
  }> {
    const conv = await this.assertParticipant(conversationId, viewer.id);
    if (conv.status !== ConversationStatus.ACTIVE) {
      throw new HttpException(
        {
          error: {
            code: 'CONVERSATION_CLOSED',
            message: 'This conversation is no longer available.',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const otherForBlock = this.otherUserId(conv, viewer.id);
    await this.blocks.assertCanMessage(viewer.id, otherForBlock);
    const reqRow = await this.prisma.numberShareRequest.findFirst({
      where: { id: body.requestId, conversationId },
    });
    if (reqRow === null) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'No pending number share request found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (reqRow.status !== NumberShareStatus.PENDING) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'No pending number share request found.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (reqRow.requestedByUserId === viewer.id) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'Only the recipient can respond to this request.' } },
        HttpStatus.FORBIDDEN,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.numberShareRequest.update({
        where: { id: reqRow.id },
        data: {
          status: body.accept ? NumberShareStatus.ACCEPTED : NumberShareStatus.DECLINED,
          respondedAt: new Date(),
        },
      });
      if (body.accept) {
        await tx.conversation.update({
          where: { id: conversationId },
          data: { numbersShared: true },
        });
      }
      return r;
    });

    const dto = this.toNumberShareDto(updated);
    this.sse.publish(reqRow.requestedByUserId, {
      type: 'number_share_responded',
      data: { requestId: dto.id, status: dto.status },
    });

    let phoneNumbers: { requesterPhone: string | null; responderPhone: string | null } | undefined;
    if (body.accept) {
      const [requester, responder] = await Promise.all([
        this.prisma.user.findUniqueOrThrow({ where: { id: reqRow.requestedByUserId } }),
        this.prisma.user.findUniqueOrThrow({ where: { id: viewer.id } }),
      ]);
      phoneNumbers = {
        requesterPhone: requester.phoneNumber,
        responderPhone: responder.phoneNumber,
      };
    }

    return { request: dto, ...(phoneNumbers ? { phoneNumbers } : {}) };
  }
}
