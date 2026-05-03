import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Max size checked in `UploadsService` so errors use `FILE_TOO_LARGE` (not only Zod `INVALID_INPUT`). */
export const PhotoUploadUrlRequestSchema = z.object({
  contentType: z.string().min(1),
  sizeBytes: z.number().int().min(1),
});

export class PhotoUploadUrlRequestBodyDto extends createZodDto(PhotoUploadUrlRequestSchema) {}

export const UploadConfirmBodySchema = z.object({
  key: z.string().min(1),
  type: z.enum(['listing-photo', 'profile-photo']),
});

export class UploadConfirmBodyDto extends createZodDto(UploadConfirmBodySchema) {}

export type UploadConfirmBody = z.infer<typeof UploadConfirmBodySchema>;
