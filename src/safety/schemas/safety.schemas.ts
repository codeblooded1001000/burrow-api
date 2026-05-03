import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PostBlockBodySchema = z.object({
  userId: z.string().min(1),
});
export class PostBlockBodyDto extends createZodDto(PostBlockBodySchema) {}

export const ReportCategorySchema = z.enum([
  'HARASSMENT',
  'FAKE_PROFILE',
  'SCAM_BROKER',
  'INAPPROPRIATE',
  'OTHER',
]);

export const PostReportBodySchema = z.object({
  reportedUserId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  category: ReportCategorySchema,
  detail: z.string().max(1000).optional(),
});
export class PostReportBodyDto extends createZodDto(PostReportBodySchema) {}
