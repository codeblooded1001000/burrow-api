import { createZodDto } from 'nestjs-zod';
import { ManualReviewStatus, ReportStatus } from '@prisma/client';
import { z } from 'zod';

export const AdminLoginBodySchema = z.object({
  password: z.string().min(1),
});
export class AdminLoginBodyDto extends createZodDto(AdminLoginBodySchema) {}

export const AdminReportsQuerySchema = z.object({
  status: z.nativeEnum(ReportStatus).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export class AdminReportsQueryDto extends createZodDto(AdminReportsQuerySchema) {}

export const PatchAdminReportBodySchema = z.object({
  status: z.enum(['REVIEWING', 'RESOLVED', 'DISMISSED']),
  resolverNotes: z.string().max(5000).optional(),
});
export class PatchAdminReportBodyDto extends createZodDto(PatchAdminReportBodySchema) {}

export const AdminManualReviewsQuerySchema = z.object({
  status: z.nativeEnum(ManualReviewStatus).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export class AdminManualReviewsQueryDto extends createZodDto(AdminManualReviewsQuerySchema) {}

export const ManualReviewRejectBodySchema = z.object({
  reason: z.string().max(2000).optional(),
});
export class ManualReviewRejectBodyDto extends createZodDto(ManualReviewRejectBodySchema) {}

export const AdminBanUserBodySchema = z.object({
  reason: z.string().min(1).max(2000),
  internalNotes: z.string().max(5000).optional(),
});
export class AdminBanUserBodyDto extends createZodDto(AdminBanUserBodySchema) {}

const CURSOR_V = 1 as const;

export interface AdminReportListCursor {
  v: typeof CURSOR_V;
  createdAt: string;
  id: string;
}

export function encodeAdminReportCursor(p: AdminReportListCursor): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodeAdminReportCursor(raw: string | undefined): AdminReportListCursor | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (o.v !== CURSOR_V || typeof o.id !== 'string' || typeof o.createdAt !== 'string') return null;
    return { v: CURSOR_V, createdAt: o.createdAt, id: o.id };
  } catch {
    return null;
  }
}

export interface AdminManualReviewListCursor {
  v: typeof CURSOR_V;
  createdAt: string;
  id: string;
}

export function encodeManualReviewCursor(p: AdminManualReviewListCursor): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodeManualReviewCursor(raw: string | undefined): AdminManualReviewListCursor | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (o.v !== CURSOR_V || typeof o.id !== 'string' || typeof o.createdAt !== 'string') return null;
    return { v: CURSOR_V, createdAt: o.createdAt, id: o.id };
  } catch {
    return null;
  }
}
