import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap/configure-http-app';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
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

  it('GET /api/v1/auth/me without cookie returns 401', async () => {
    const res = await request(app.getHttpServer() as Server).get('/api/v1/auth/me').expect(401);
    expect(res.body).toMatchObject({
      error: { code: 'UNAUTHENTICATED', message: expect.any(String) as string },
    });
  });

  it('POST /api/v1/auth/signup/request-otp with personal domain returns 400 BLOCKED_DOMAIN', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/signup/request-otp')
      .send({ email: 'someone@gmail.com' })
      .expect(400);
    expect(res.body).toMatchObject({
      error: { code: 'BLOCKED_DOMAIN', message: expect.any(String) as string },
    });
  });

  it('POST /api/v1/auth/signup/request-otp with invalid body returns 400', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/signup/request-otp')
      .send({ email: 'not-an-email' })
      .expect(400);
  });
});
