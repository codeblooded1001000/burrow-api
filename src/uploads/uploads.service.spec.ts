import { HttpException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env.schema';
import { RedisService } from '../redis/redis.service';
import { UploadsService } from './uploads.service';

function mockLogger(): PinoLogger {
  return { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } as unknown as PinoLogger;
}

describe('UploadsService.confirmUpload', () => {
  it('returns 403 when key is not under the caller user prefix', async () => {
    const getMock = jest.fn();
    const redis = { get: getMock, set: jest.fn(), del: jest.fn() } as unknown as RedisService;
    const config = { get: jest.fn() } as unknown as import('@nestjs/config').ConfigService<Env, true>;
    const svc = new UploadsService(config, redis, mockLogger());
    await expect(svc.confirmUpload('user-b', 'listings/user-a/abc.jpg', 'listing-photo')).rejects.toThrow(
      HttpException,
    );
    expect(getMock.mock.calls.length).toBe(0);
  });
});
