import { HttpException } from '@nestjs/common';
import { parsePhotoUploadParams } from './upload-params';

describe('parsePhotoUploadParams', () => {
  it('returns parsed values for valid input', () => {
    expect(parsePhotoUploadParams('image/jpeg', 1024)).toEqual({
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });
  });

  it('throws INVALID_CONTENT_TYPE for disallowed type', () => {
    expect(() => parsePhotoUploadParams('image/gif', 100)).toThrow(HttpException);
    try {
      parsePhotoUploadParams('image/gif', 100);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getResponse()).toEqual({
        error: {
          code: 'INVALID_CONTENT_TYPE',
          message: 'Only JPEG, PNG, or WebP images are allowed.',
        },
      });
    }
  });

  it('throws FILE_TOO_LARGE over 5MB', () => {
    expect(() => parsePhotoUploadParams('image/jpeg', 5 * 1024 * 1024 + 1)).toThrow(HttpException);
    try {
      parsePhotoUploadParams('image/jpeg', 5 * 1024 * 1024 + 1);
    } catch (e) {
      expect((e as HttpException).getResponse()).toEqual({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'Each file must be at most 5 MB.',
        },
      });
    }
  });
});
