import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap/configure-http-app';
import { buildCommuteCacheKey } from '../src/maps/cache/commute-cache';
import { RedisService } from '../src/redis/redis.service';
import { createUserWithSessionCookie } from './helpers/auth-e2e';

const listingCreateResponseSchema = z.object({ id: z.string() });

function futureAvailableFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

describe('Maps (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let originalFetch: typeof fetch;

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

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('GET /maps/commute returns NO_OFFICE_SET when viewer has no office', async () => {
    const { cookie: listerCookie } = await createUserWithSessionCookie(app, {
      role: Role.LISTER,
      withProfile: true,
    });
    const listingBody = {
      localityName: 'Cyber City',
      lat: 28.45,
      lng: 77.09,
      bhk: 2,
      totalRent: 50000,
      yourShare: 25000,
      availableFrom: futureAvailableFrom(),
      photos: ['https://cdn.burrow.in/u/maps-e2e-a.jpg'],
      description: 'Bright flat near metro.',
      amenities: ['Wi-Fi', 'Lift'],
      preferredGender: 'ANYONE' as const,
      preferredProfessions: ['Software engineer'],
      smokingAllowed: false,
      foodPref: 'NON_VEG_OK',
      workSchedulePref: 'FLEXIBLE',
    };
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/listings/me')
      .set('Cookie', listerCookie)
      .send(listingBody)
      .expect(201);
    const listingId = listingCreateResponseSchema.parse(created.body).id;

    const { cookie: seekerCookie } = await createUserWithSessionCookie(app, {
      role: Role.SEEKER,
      withProfile: true,
    });

    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/maps/commute')
      .query({ listingId })
      .set('Cookie', seekerCookie)
      .expect(200);

    expect(res.body).toEqual({
      commute: null,
      reason: 'NO_OFFICE_SET',
      cached: false,
    });
  });

  it('POST /maps/validate-place rejects coords outside Gurgaon (mocked Places response)', async () => {
    const placesJson = {
      status: 'OK',
      result: {
        place_id: 'ChIJmock',
        formatted_address: 'Mumbai, Maharashtra',
        geometry: { location: { lat: 19.076, lng: 72.8777 } },
        address_components: [{ long_name: 'Mumbai', short_name: 'Mumbai', types: ['locality', 'political'] }],
      },
    };
    const mockResponse: Pick<Response, 'ok' | 'json'> = {
      ok: true,
      json: () => Promise.resolve(placesJson),
    };
    global.fetch = jest.fn().mockResolvedValue(mockResponse);

    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/maps/validate-place')
      .set('Cookie', cookie)
      .send({ placeId: 'ChIJmock' })
      .expect(200);

    expect(res.body).toEqual({ valid: false, reason: 'OUT_OF_BOUNDS' });
  });

  const e2eMapsKeyPlaceholder = 'e2e-maps-test-placeholder';
  const runExternal =
    process.env.RUN_EXTERNAL_API_TESTS === 'true' &&
    Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim()) &&
    process.env.GOOGLE_MAPS_API_KEY !== e2eMapsKeyPlaceholder;

  (runExternal ? it : it.skip)(
    'GET /maps/commute hits Distance Matrix then returns cached: true on repeat',
    async () => {
      const redis = app.get(RedisService);
      const listingLat = 28.4521;
      const listingLng = 77.0911;
      const officeLat = 28.4599;
      const officeLng = 77.0999;
      await redis.del(buildCommuteCacheKey(listingLat, listingLng, officeLat, officeLng));

      const { cookie: listerCookie } = await createUserWithSessionCookie(app, {
        role: Role.LISTER,
        withProfile: true,
      });
      const created = await request(app.getHttpServer() as Server)
        .post('/api/v1/listings/me')
        .set('Cookie', listerCookie)
        .send({
          localityName: 'Cyber City',
          lat: listingLat,
          lng: listingLng,
          bhk: 2,
          totalRent: 51000,
          yourShare: 25500,
          availableFrom: futureAvailableFrom(),
          photos: ['https://cdn.burrow.in/u/maps-ext-a.jpg'],
          description: 'External maps commute test.',
          amenities: ['Wi-Fi'],
          preferredGender: 'ANYONE',
          preferredProfessions: ['Software engineer'],
          smokingAllowed: false,
          foodPref: 'NON_VEG_OK',
          workSchedulePref: 'FLEXIBLE',
        })
        .expect(201);
      const listingId = listingCreateResponseSchema.parse(created.body).id;

      const { cookie: viewerCookie } = await createUserWithSessionCookie(app, {
        role: Role.SEEKER,
        withProfile: true,
      });
      await request(app.getHttpServer() as Server)
        .put('/api/v1/profiles/me')
        .set('Cookie', viewerCookie)
        .send({
          fullName: 'Maps E2E',
          age: 30,
          gender: 'MAN',
          photoUrl: 'https://cdn.burrow.in/me/maps-e2e.jpg',
          bio: 'This bio is definitely long enough for the completion heuristic.',
          profession: 'Software engineer',
          workSchedule: 'OFFICE',
          budgetMin: 20000,
          budgetMax: 40000,
          moveInDate: '2026-08-01T00:00:00.000Z',
          preferredLocalities: ['Cyber City'],
          lifestyleTags: ['Chill'],
          smokingPref: 'NON_SMOKER',
          foodPref: 'NON_VEG_OK',
          officeLat,
          officeLng,
        })
        .expect(200);

      const first = await request(app.getHttpServer() as Server)
        .get('/api/v1/maps/commute')
        .query({ listingId })
        .set('Cookie', viewerCookie)
        .expect(200);
      const b1 = first.body as {
        commute: { distanceMeters: number } | null;
        reason: string;
        cached: boolean;
      };
      expect(b1.reason).toBe('OK');
      expect(b1.cached).toBe(false);
      expect(b1.commute).not.toBeNull();
      expect(typeof b1.commute?.distanceMeters).toBe('number');

      const second = await request(app.getHttpServer() as Server)
        .get('/api/v1/maps/commute')
        .query({ listingId })
        .set('Cookie', viewerCookie)
        .expect(200);
      const b2 = second.body as { cached: boolean; reason: string };
      expect(b2.reason).toBe('OK');
      expect(b2.cached).toBe(true);
    },
    20000,
  );
});
