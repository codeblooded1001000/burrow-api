import { HttpException, HttpStatus } from '@nestjs/common';
import type { ImageContentType } from './upload-keys';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);

export function parsePhotoUploadParams(contentType: string, sizeBytes: number): {
  contentType: ImageContentType;
  sizeBytes: number;
} {
  if (!ALLOWED.has(contentType)) {
    throw new HttpException(
      {
        error: {
          code: 'INVALID_CONTENT_TYPE',
          message: 'Only JPEG, PNG, or WebP images are allowed.',
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  if (sizeBytes > MAX_BYTES) {
    throw new HttpException(
      {
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'Each file must be at most 5 MB.',
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return { contentType: contentType as ImageContentType, sizeBytes };
}
