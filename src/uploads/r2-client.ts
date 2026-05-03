import { S3Client } from '@aws-sdk/client-s3';

export interface R2ClientConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createR2S3Client(cfg: R2ClientConfig): S3Client {
  const accountId = cfg.accountId.trim();
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId.trim(),
      secretAccessKey: cfg.secretAccessKey.trim(),
    },
  });
}

export function r2CredentialsPresent(
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucketName: string,
): boolean {
  return (
    accountId.trim().length > 0 &&
    accessKeyId.trim().length > 0 &&
    secretAccessKey.trim().length > 0 &&
    bucketName.trim().length > 0
  );
}
