import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap/configure-http-app';

describe('Health (e2e)', () => {
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

  it('GET /api/v1/health returns payload', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/health')
      .expect([200, 503]);
    expect(res.body).toMatchObject({
      status: expect.stringMatching(/ok|degraded/) as string,
      uptime: expect.any(Number) as number,
      db: expect.stringMatching(/ok|down/) as string,
      redis: expect.stringMatching(/ok|down/) as string,
      version: expect.any(String) as string,
      timestamp: expect.any(String) as string,
    });
  });
});
