import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap/configure-http-app';
import { createUserWithSessionCookie } from './helpers/auth-e2e';

function r2Configured(): boolean {
  const a = process.env.R2_ACCOUNT_ID?.trim() ?? '';
  const k = process.env.R2_ACCESS_KEY_ID?.trim() ?? '';
  const s = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? '';
  const b = process.env.R2_BUCKET_NAME?.trim() ?? '';
  return a.length > 0 && k.length > 0 && s.length > 0 && b.length > 0;
}

const runExternal = process.env.RUN_EXTERNAL_API_TESTS === 'true' && r2Configured();

describe('Uploads R2 (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;

  beforeAll(async () => {
    process.env.UPLOAD_RATE_LIMIT_OFF = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bufferLogs: true });
    app.useLogger(false);
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /listings/me/photos/upload-url rejects oversize payload before R2', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.LISTER, withProfile: true });
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/listings/me/photos/upload-url')
      .set('Cookie', cookie)
      .send({ contentType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('FILE_TOO_LARGE');
  });

  it('POST /listings/me/photos/upload-url rejects invalid content type', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.LISTER, withProfile: true });
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/listings/me/photos/upload-url')
      .set('Cookie', cookie)
      .send({ contentType: 'image/gif', sizeBytes: 1024 })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_CONTENT_TYPE');
  });

  it('POST /listings/me/photos/upload-url returns 403 for SEEKER', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    await request(app.getHttpServer() as Server)
      .post('/api/v1/listings/me/photos/upload-url')
      .set('Cookie', cookie)
      .send({ contentType: 'image/jpeg', sizeBytes: 1024 })
      .expect(403);
  });

  it('POST /uploads/confirm returns 403 for a key owned by another user', async () => {
    const { cookie, userId } = await createUserWithSessionCookie(app, { role: Role.LISTER, withProfile: true });
    const otherUserId = userId.startsWith('a') ? 'b' : 'a';
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/uploads/confirm')
      .set('Cookie', cookie)
      .send({ key: `listings/${otherUserId}/fake.jpg`, type: 'listing-photo' })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  (runExternal ? it : it.skip)(
    'listing photo: upload-url → PUT → confirm returns key (client builds public URL on read)',
    async () => {
      const bodyBuf = Buffer.alloc(512, 7);
      const { cookie } = await createUserWithSessionCookie(app, { role: Role.LISTER, withProfile: true });
      const urlRes = await request(app.getHttpServer() as Server)
        .post('/api/v1/listings/me/photos/upload-url')
        .set('Cookie', cookie)
        .send({ contentType: 'image/jpeg', sizeBytes: bodyBuf.length })
        .expect(200);
      const u = urlRes.body as { uploadUrl: string; key: string; expiresAt: string };
      expect(u.uploadUrl).toMatch(/^https:\/\//);
      expect(u.key).toMatch(/^listings\/[^/]+\/.+/);

      const putRes = await fetch(u.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(bodyBuf.length) },
        body: bodyBuf,
      });
      expect(putRes.status).toBe(200);

      const conf = await request(app.getHttpServer() as Server)
        .post('/api/v1/uploads/confirm')
        .set('Cookie', cookie)
        .send({ key: u.key, type: 'listing-photo' })
        .expect(200);
      expect(conf.body).toEqual({ ok: true, key: u.key });
    },
    60_000,
  );
});
