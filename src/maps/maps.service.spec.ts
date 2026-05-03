import type { PinoLogger } from 'nestjs-pino';
import type { UserDto } from '../auth/schemas/auth.schemas';
import type { Env } from '../config/env.schema';
import { ListingsService } from '../listings/listings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MapsService } from './maps.service';

function mockLogger(): PinoLogger {
  return { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } as unknown as PinoLogger;
}

function configStub(overrides: Partial<Record<keyof Env, string>> = {}): {
  get: <K extends keyof Env>(k: K) => Env[K];
} {
  const base: Record<string, string> = {
    MAPS_DAILY_BUDGET: '1',
    GOOGLE_MAPS_API_KEY: 'test-key',
    ...overrides,
  };
  return {
    get: <K extends keyof Env>(k: K) => base[k as string] as Env[K],
  };
}

describe('MapsService', () => {
  const viewer: UserDto = {
    id: 'viewer-1',
    email: 'v@example.com',
    role: 'SEEKER',
    companyName: 'Co',
    companyVerified: true,
    hasProfile: true,
    hasListing: false,
    profileCompletion: 80,
    createdAt: new Date().toISOString(),
    fullName: 'V',
    photoUrl: null,
  };

  it('returns BUDGET_EXCEEDED without calling Google when daily cap already exceeded after INCR', async () => {
    const listing = {
      lat: 28.45,
      lng: 77.09,
    };
    const listings = { getPublic: jest.fn().mockResolvedValue(listing) };
    const prisma = {
      profile: { findUnique: jest.fn().mockResolvedValue({ officeLat: 28.46, officeLng: 77.1 }) },
    } as unknown as PrismaService;
    const decrMock = jest.fn().mockResolvedValue(0);
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      incr: jest.fn().mockResolvedValue(2),
      decr: decrMock,
      expire: jest.fn(),
    } as unknown as RedisService;
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not run when budget exceeded');
    });

    const svc = new MapsService(
      listings as unknown as ListingsService,
      prisma,
      redis,
      configStub({ MAPS_DAILY_BUDGET: '1' }) as never,
      mockLogger(),
    );
    const out = await svc.getCommute(viewer, 'listing-1');

    expect(out).toEqual({ commute: null, reason: 'BUDGET_EXCEEDED', cached: false });
    expect(decrMock).toHaveBeenCalled();
    expect(fetchSpy.mock.calls.length).toBe(0);
    fetchSpy.mockRestore();
  });

  it('returns API_ERROR and decrements counter when GOOGLE_MAPS_API_KEY is empty after INCR', async () => {
    const listing = { lat: 28.45, lng: 77.09 };
    const listings = { getPublic: jest.fn().mockResolvedValue(listing) };
    const prisma = {
      profile: { findUnique: jest.fn().mockResolvedValue({ officeLat: 28.46, officeLng: 77.1 }) },
    } as unknown as PrismaService;
    const decrMock = jest.fn();
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      incr: jest.fn().mockResolvedValue(1),
      decr: decrMock,
      expire: jest.fn(),
    } as unknown as RedisService;

    const svc = new MapsService(
      listings as unknown as ListingsService,
      prisma,
      redis,
      configStub({ GOOGLE_MAPS_API_KEY: '', MAPS_DAILY_BUDGET: '1000' }) as never,
      mockLogger(),
    );
    const out = await svc.getCommute(viewer, 'listing-1');

    expect(out.reason).toBe('API_ERROR');
    expect(out.commute).toBeNull();
    expect(decrMock).toHaveBeenCalled();
  });

  it('returns ESTIMATE with straight_line when Distance Matrix rejects both requests', async () => {
    const listing = { lat: 28.45, lng: 77.09 };
    const listings = { getPublic: jest.fn().mockResolvedValue(listing) };
    const prisma = {
      profile: { findUnique: jest.fn().mockResolvedValue({ officeLat: 28.46, officeLng: 77.1 }) },
    } as unknown as PrismaService;
    const decrMock = jest.fn();
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      incr: jest.fn().mockResolvedValue(1),
      decr: decrMock,
      expire: jest.fn(),
    } as unknown as RedisService;

    const deniedBody = {
      status: 'REQUEST_DENIED',
      error_message: 'The provided API key is invalid.',
      rows: [],
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => deniedBody,
    } as Response);

    const svc = new MapsService(
      listings as unknown as ListingsService,
      prisma,
      redis,
      configStub({ GOOGLE_MAPS_API_KEY: 'invalid', MAPS_DAILY_BUDGET: '1000' }) as never,
      mockLogger(),
    );
    const out = await svc.getCommute(viewer, 'listing-1');

    expect(out.reason).toBe('ESTIMATE');
    expect(out.commute).not.toBeNull();
    expect(out.commute?.mode).toBe('straight_line');
    expect(typeof out.commute?.distanceMeters).toBe('number');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(decrMock).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
