import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PostConversationSchema = z.object({
  recipientUserId: z.string().min(1),
  initialMessage: z.string().min(1).max(2000),
});
export class PostConversationBodyDto extends createZodDto(PostConversationSchema) {}

export const PostMessageSchema = z.object({
  body: z.string().min(1).max(2000),
});
export class PostMessageBodyDto extends createZodDto(PostMessageSchema) {}

export const PatchMessagesReadSchema = z.object({
  upToMessageId: z.string().min(1).optional(),
});
export class PatchMessagesReadBodyDto extends createZodDto(PatchMessagesReadSchema) {}

export const NumberShareRespondSchema = z.object({
  requestId: z.string().min(1),
  accept: z.boolean(),
});
export class NumberShareRespondBodyDto extends createZodDto(NumberShareRespondSchema) {}

const CURSOR_V = 1 as const;

export interface ConversationListCursorPayload {
  v: typeof CURSOR_V;
  lastMessageAt: string | null;
  id: string;
}

export const CONVERSATION_REQUESTS_CURSOR_V = 2 as const;

export interface ConversationRequestsListCursorPayload {
  v: typeof CONVERSATION_REQUESTS_CURSOR_V;
  createdAt: string;
  id: string;
}

export interface MessageHistoryCursorPayload {
  v: typeof CURSOR_V;
  beforeMessageId: string;
}

export function encodeConversationListCursor(p: ConversationListCursorPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodeConversationListCursor(raw: string | undefined): ConversationListCursorPayload | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (o.v !== CURSOR_V || typeof o.id !== 'string') return null;
    if (o.lastMessageAt !== null && typeof o.lastMessageAt !== 'string') return null;
    const lastMessageAt: string | null = typeof o.lastMessageAt === 'string' ? o.lastMessageAt : null;
    return {
      v: CURSOR_V,
      lastMessageAt,
      id: o.id,
    };
  } catch {
    return null;
  }
}

export function encodeConversationRequestsListCursor(p: ConversationRequestsListCursorPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodeConversationRequestsListCursor(raw: string | undefined): ConversationRequestsListCursorPayload | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (o.v !== CONVERSATION_REQUESTS_CURSOR_V || typeof o.id !== 'string' || typeof o.createdAt !== 'string') return null;
    return {
      v: CONVERSATION_REQUESTS_CURSOR_V,
      createdAt: o.createdAt,
      id: o.id,
    };
  } catch {
    return null;
  }
}

export function encodeMessageHistoryCursor(p: MessageHistoryCursorPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodeMessageHistoryCursor(raw: string | undefined): MessageHistoryCursorPayload | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (o.v !== CURSOR_V || typeof o.beforeMessageId !== 'string') return null;
    return { v: CURSOR_V, beforeMessageId: o.beforeMessageId };
  } catch {
    return null;
  }
}

export const ConversationTabSchema = z.enum(['active', 'requests', 'all']);
export type ConversationTab = z.infer<typeof ConversationTabSchema>;

export const ConversationListQuerySchema = z.object({
  tab: ConversationTabSchema.default('active'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export class ConversationListQueryDto extends createZodDto(ConversationListQuerySchema) {}

export const PostRejectConversationSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});
export class PostRejectConversationBodyDto extends createZodDto(PostRejectConversationSchema) {}

export const ConversationLookupQuerySchema = z.object({
  otherUserId: z.string().min(1),
});
export class ConversationLookupQueryDto extends createZodDto(ConversationLookupQuerySchema) {}

export const MessageListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export class MessageListQueryDto extends createZodDto(MessageListQuerySchema) {}
