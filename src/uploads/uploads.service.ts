import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env.schema';
import { RedisService } from '../redis/redis.service';
import {
  buildListingPhotoObjectKey,
  buildProfilePhotoObjectKey,
  objectKeyOwnedByUser,
  type ImageContentType,
  type UploadObjectKind,
} from './upload-keys';
import { parsePhotoUploadParams } from './upload-params';
import { createR2S3Client, r2CredentialsPresent } from './r2-client';

const SIGNED_URL_EXPIRES_SEC = 600;
const PENDING_META_TTL_SEC = 900;
const DEFAULT_URL_GEN_PER_HOUR = 30;
const SIZE_TOLERANCE = 0.05;

interface PendingUploadMeta {
  userId: string;
  sizeBytes: number;
  contentType: string;
  uploadKind: UploadObjectKind;
}

export interface SignedUploadUrlResponse {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

@Injectable()
export class UploadsService {
  private s3: S3Client | null = null;
  private bucketName = '';

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly redis: RedisService,
    @InjectPinoLogger(UploadsService.name) private readonly logger: PinoLogger,
  ) {}

  private ensureR2(): { client: S3Client; bucket: string } {
    const accountId = this.config.get('R2_ACCOUNT_ID', { infer: true });
    const accessKeyId = this.config.get('R2_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = this.config.get('R2_SECRET_ACCESS_KEY', { infer: true });
    const bucket = this.config.get('R2_BUCKET_NAME', { infer: true });
    if (!r2CredentialsPresent(accountId, accessKeyId, secretAccessKey, bucket)) {
      throw new HttpException(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'File uploads are not configured on this server.',
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (this.s3 === null) {
      this.s3 = createR2S3Client({ accountId, accessKeyId, secretAccessKey });
      this.bucketName = bucket.trim();
    }
    return { client: this.s3, bucket: this.bucketName };
  }

  private urlGenLimit(): number {
    const raw = this.config.get('UPLOAD_URL_GEN_PER_HOUR', { infer: true });
    if (raw.length === 0) return DEFAULT_URL_GEN_PER_HOUR;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_URL_GEN_PER_HOUR;
  }

  private rateLimitOff(): boolean {
    return process.env.NODE_ENV === 'test' && process.env.UPLOAD_RATE_LIMIT_OFF === 'true';
  }

  private pendingMetaKey(objectKey: string): string {
    return `uploads:meta:${objectKey}`;
  }

  private hourBucketKey(): string {
    return new Date().toISOString().slice(0, 13);
  }

  private secondsUntilNextUtcHour(): number {
    const now = new Date();
    const msIntoHour =
      now.getUTCMinutes() * 60_000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
    return Math.max(1, Math.ceil((3_600_000 - msIntoHour) / 1000));
  }

  private async reserveUploadUrlGeneration(userId: string): Promise<void> {
    if (this.rateLimitOff()) return;
    const limit = this.urlGenLimit();
    const key = `uploads:urlgen:${userId}:${this.hourBucketKey()}`;
    const n = await this.redis.incr(key);
    if (n === 1) {
      await this.redis.expire(key, 60 * 60 * 2);
    }
    if (n > limit) {
      await this.redis.decr(key);
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMIT',
            message: 'Too many upload URL requests. Please try again later.',
          },
          retryAfter: this.secondsUntilNextUtcHour(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async storePendingMeta(objectKey: string, meta: PendingUploadMeta): Promise<void> {
    await this.redis.set(this.pendingMetaKey(objectKey), JSON.stringify(meta), PENDING_META_TTL_SEC);
  }

  async createListingPhotoUploadUrl(
    userId: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<SignedUploadUrlResponse> {
    const parsed = parsePhotoUploadParams(contentType, sizeBytes);
    const { client, bucket } = this.ensureR2();
    await this.reserveUploadUrlGeneration(userId);
    const key = buildListingPhotoObjectKey(userId, parsed.contentType);
    return this.signPutAndReturn(
      userId,
      client,
      bucket,
      key,
      parsed.contentType,
      parsed.sizeBytes,
      'listing-photo',
    );
  }

  /** Signed PUT for profile avatar. Old objects are not deleted here (nightly cleanup TBD). */
  async createProfilePhotoUploadUrl(
    userId: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<SignedUploadUrlResponse> {
    const parsed = parsePhotoUploadParams(contentType, sizeBytes);
    const { client, bucket } = this.ensureR2();
    await this.reserveUploadUrlGeneration(userId);
    const key = buildProfilePhotoObjectKey(userId, parsed.contentType);
    return this.signPutAndReturn(
      userId,
      client,
      bucket,
      key,
      parsed.contentType,
      parsed.sizeBytes,
      'profile-photo',
    );
  }

  private async signPutAndReturn(
    userId: string,
    client: S3Client,
    bucket: string,
    key: string,
    contentType: ImageContentType,
    sizeBytes: number,
    uploadKind: UploadObjectKind,
  ): Promise<SignedUploadUrlResponse> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        userid: userId,
        uploadtype: uploadKind,
      },
    });
    let uploadUrl: string;
    try {
      uploadUrl = await getSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRES_SEC });
    } catch (err: unknown) {
      this.logger.warn({ err }, 'uploads_sign_put_failed');
      throw new HttpException(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Could not prepare upload. Try again shortly.',
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRES_SEC * 1000).toISOString();
    await this.storePendingMeta(key, {
      userId,
      sizeBytes,
      contentType,
      uploadKind,
    });
    return { uploadUrl, key, expiresAt };
  }

  async confirmUpload(
    userId: string,
    objectKey: string,
    type: UploadObjectKind,
  ): Promise<{ ok: true; key: string }> {
    if (!objectKeyOwnedByUser(objectKey, userId, type)) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'You cannot confirm this upload.' } },
        HttpStatus.FORBIDDEN,
      );
    }
    const raw = await this.redis.get(this.pendingMetaKey(objectKey));
    if (raw === null || raw === '') {
      throw new HttpException(
        {
          error: {
            code: 'UPLOAD_NOT_FOUND',
            message: 'Upload was not found or has expired. Request a new upload URL and try again.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    let meta: PendingUploadMeta;
    try {
      meta = JSON.parse(raw) as PendingUploadMeta;
    } catch {
      throw new HttpException(
        {
          error: {
            code: 'UPLOAD_NOT_FOUND',
            message: 'Upload metadata is invalid. Request a new upload URL.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (meta.userId !== userId || meta.uploadKind !== type) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'You cannot confirm this upload.' } },
        HttpStatus.FORBIDDEN,
      );
    }
    const { client, bucket } = this.ensureR2();
    let contentLength: number | undefined;
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
      contentLength = head.ContentLength;
    } catch (err: unknown) {
      this.logger.warn({ err }, 'uploads_head_failed');
      throw new HttpException(
        {
          error: {
            code: 'UPLOAD_NOT_FOUND',
            message: 'The file was not found in storage. Complete the PUT upload, then confirm again.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (typeof contentLength !== 'number') {
      throw new HttpException(
        {
          error: {
            code: 'UPLOAD_NOT_FOUND',
            message: 'Could not verify upload size. Try uploading again.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const minOk = meta.sizeBytes * (1 - SIZE_TOLERANCE);
    const maxOk = meta.sizeBytes * (1 + SIZE_TOLERANCE);
    if (contentLength < minOk || contentLength > maxOk) {
      throw new HttpException(
        {
          error: {
            code: 'UPLOAD_NOT_FOUND',
            message: 'Uploaded file size does not match. Re-upload with the same size you declared.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.redis.del(this.pendingMetaKey(objectKey));
    return { ok: true, key: objectKey };
  }
}
