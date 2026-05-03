import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import request from 'supertest';
import { FoodPref, Gender, Role, SmokingPref, WorkSchedule } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap/configure-http-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { createUserWithSessionCookie } from './helpers/auth-e2e';

describe('Browse (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pinHash: string;

  beforeAll(async () => {
    pinHash = await argon2.hash('000000', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bufferLogs: true });
    app.useLogger(false);
    configureHttpApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedListerWithListing(opts: {
    localityName: string;
    yourShare: number;
    companyVerified?: boolean;
    userDeleted?: boolean;
    availableFrom?: Date;
    emailSuffix?: string;
  }) {
    const unique = randomBytes(12).toString('hex');
    const email = `browse-${opts.emailSuffix ? `${opts.emailSuffix}-` : ''}${unique}@infosys.com`;
    const user = await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        pinHash,
        role: Role.LISTER,
        companyName: 'Infosys',
        companyVerified: opts.companyVerified ?? true,
        deletedAt: opts.userDeleted ? new Date() : null,
      },
    });
    await prisma.profile.create({
      data: {
        userId: user.id,
        fullName: 'Lister',
        age: 30,
        gender: Gender.WOMAN,
        bio: 'This bio is long enough for profile completion scoring in tests.',
        profession: 'Software engineer',
        workSchedule: WorkSchedule.FLEXIBLE,
        budgetMin: 10000,
        budgetMax: 40000,
        moveInDate: new Date('2026-09-01T00:00:00.000Z'),
        preferredLocalities: [opts.localityName, 'Sector 43'],
        lifestyleTags: ['Chill'],
        smokingPref: SmokingPref.NON_SMOKER,
        foodPref: FoodPref.NON_VEG_OK,
        profileCompletion: 70,
      },
    });
    const listing = await prisma.listing.create({
      data: {
        userId: user.id,
        localityName: opts.localityName,
        lat: 28.45,
        lng: 77.09,
        bhk: 2,
        totalRent: 50000,
        yourShare: opts.yourShare,
        availableFrom: opts.availableFrom ?? new Date('2026-10-15T00:00:00.000Z'),
        photos: ['https://cdn.burrow.in/u/a.jpg'],
        description: 'Bright flat near metro.',
        amenities: ['Wi-Fi', 'Lift'],
        preferredGender: Gender.PREFER_NOT,
        preferredProfessions: ['Software engineer'],
        smokingAllowed: false,
        foodPref: FoodPref.NON_VEG_OK,
        workSchedulePref: WorkSchedule.FLEXIBLE,
        isActive: true,
      },
    });
    return { user, listing };
  }

  it('GET /browse/flats paginates with cursor until hasMore is false', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    const locality = 'Sector 54';
    const seededIds: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const { listing } = await seedListerWithListing({
        localityName: locality,
        yourShare: 20000 + i,
        emailSuffix: `pg-${String(i)}-${randomBytes(4).toString('hex')}`,
      });
      seededIds.push(listing.id);
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const qs = new URLSearchParams({ limit: '10', localities: locality });
      if (cursor) qs.set('cursor', cursor);
      const res = await request(app.getHttpServer() as Server)
        .get(`/api/v1/browse/flats?${qs.toString()}`)
        .set('Cookie', cookie)
        .expect(200);
      const body = res.body as { items: { id: string }[]; nextCursor: string | null; hasMore: boolean };
      pages += 1;
      for (const it of body.items) seen.add(it.id);
      expect(body.items.length).toBeLessThanOrEqual(10);
      cursor = body.nextCursor ?? undefined;
      if (!body.hasMore) {
        expect(cursor == null).toBe(true);
        break;
      }
      expect(cursor).toBeTruthy();
    } while (cursor !== undefined && cursor.length > 0 && pages < 30);

    for (const id of seededIds) {
      expect(seen.has(id)).toBe(true);
    }
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it('GET /browse/flats filters by locality', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    await seedListerWithListing({ localityName: 'Cyber City', yourShare: 22000, emailSuffix: 'loc-a' });
    await seedListerWithListing({ localityName: 'DLF Phase 2', yourShare: 22001, emailSuffix: 'loc-b' });

    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flats?localities=DLF%20Phase%202')
      .set('Cookie', cookie)
      .expect(200);
    const body = res.body as { items: { localityName: string }[] };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const it of body.items) {
      expect(it.localityName).toBe('DLF Phase 2');
    }
  });

  it('GET /browse/flats budget range includes boundaries', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    const low = await seedListerWithListing({ localityName: 'MG Road', yourShare: 19999, emailSuffix: 'bd-low' });
    const mid = await seedListerWithListing({ localityName: 'MG Road', yourShare: 20000, emailSuffix: 'bd-mid' });
    const high = await seedListerWithListing({ localityName: 'MG Road', yourShare: 20001, emailSuffix: 'bd-high' });

    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flats?budgetMin=20000&budgetMax=20000&localities=MG%20Road')
      .set('Cookie', cookie)
      .expect(200);
    const body = res.body as { items: { id: string; yourShare: number }[] };
    const ids = new Set(body.items.map((x) => x.id));
    expect(ids.has(mid.listing.id)).toBe(true);
    expect(ids.has(low.listing.id)).toBe(false);
    expect(ids.has(high.listing.id)).toBe(false);
  });

  it('GET /browse/flats excludes blocked lister and own listing', async () => {
    const viewer = await createUserWithSessionCookie(app, { role: Role.BOTH, withProfile: true });
    const blocked = await seedListerWithListing({
      localityName: 'Sector 43',
      yourShare: 21000,
      emailSuffix: 'blk-target',
    });
    const own = await seedListerWithListing({
      localityName: 'Sector 43',
      yourShare: 21001,
      emailSuffix: 'blk-own',
    });

    await prisma.listing.create({
      data: {
        userId: viewer.userId,
        localityName: 'Sector 43',
        lat: 28.4,
        lng: 77.0,
        bhk: 2,
        totalRent: 48000,
        yourShare: 21002,
        availableFrom: new Date('2026-11-01T00:00:00.000Z'),
        photos: ['https://cdn.burrow.in/u/own.jpg'],
        description: 'Own place.',
        amenities: ['Wi-Fi'],
        preferredGender: Gender.PREFER_NOT,
        preferredProfessions: ['Software engineer'],
        smokingAllowed: false,
        foodPref: FoodPref.NON_VEG_OK,
        workSchedulePref: WorkSchedule.FLEXIBLE,
        isActive: true,
      },
    });

    await prisma.block.create({
      data: { blockerUserId: viewer.userId, blockedUserId: blocked.user.id },
    });

    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flats?localities=Sector%2043')
      .set('Cookie', viewer.cookie)
      .expect(200);
    const body = res.body as { items: { id: string; userId: string }[] };
    const userIds = new Set(body.items.map((x) => x.userId));
    expect(userIds.has(blocked.user.id)).toBe(false);
    expect(body.items.some((x) => x.userId === viewer.userId)).toBe(false);
    expect(body.items.some((x) => x.userId === own.user.id)).toBe(true);
  });

  it('GET /browse/flats returns 403 for LISTER-only role', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.LISTER, withProfile: true });
    await request(app.getHttpServer() as Server).get('/api/v1/browse/flats').set('Cookie', cookie).expect(403);
  });

  it('GET /browse/flatmates returns 403 for SEEKER-only role', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    await request(app.getHttpServer() as Server).get('/api/v1/browse/flatmates').set('Cookie', cookie).expect(403);
  });

  it('GET /browse/flatmates lists seeker profiles for lister', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.LISTER, withProfile: true });
    const email = `seek-flat-${randomBytes(5).toString('hex')}@infosys.com`;
    const seeker = await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        pinHash,
        role: Role.SEEKER,
        companyName: 'Infosys',
        companyVerified: true,
      },
    });
    await prisma.profile.create({
      data: {
        userId: seeker.id,
        fullName: 'Seeker',
        age: 27,
        gender: Gender.MAN,
        bio: 'This bio is long enough for profile completion scoring in tests.',
        profession: 'Consultant',
        workSchedule: WorkSchedule.OFFICE,
        budgetMin: 15000,
        budgetMax: 28000,
        moveInDate: new Date('2026-08-10T00:00:00.000Z'),
        preferredLocalities: ['Cyber City'],
        lifestyleTags: ['Foodie'],
        smokingPref: SmokingPref.FLEXIBLE,
        foodPref: FoodPref.EGGETARIAN,
        profileCompletion: 72,
      },
    });

    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flatmates')
      .set('Cookie', cookie)
      .expect(200);
    const body = res.body as { items: { userId: string; matchScore: number }[] };
    expect(body.items.some((p) => p.userId === seeker.id)).toBe(true);
    expect(body.items.every((p) => typeof p.matchScore === 'number')).toBe(true);
  });

  it('GET /browse/flats sort=soonest_move_in orders by availableFrom ascending', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    const a = await seedListerWithListing({
      localityName: 'Sohna Road',
      yourShare: 23000,
      availableFrom: new Date('2026-12-20T00:00:00.000Z'),
      emailSuffix: 'so-a',
    });
    const b = await seedListerWithListing({
      localityName: 'Sohna Road',
      yourShare: 23001,
      availableFrom: new Date('2026-12-01T00:00:00.000Z'),
      emailSuffix: 'so-b',
    });

    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flats?sort=soonest_move_in&limit=50&localities=Sohna%20Road')
      .set('Cookie', cookie)
      .expect(200);
    const body = res.body as { items: { id: string; availableFrom: string }[] };
    const idxB = body.items.findIndex((x) => x.id === b.listing.id);
    const idxA = body.items.findIndex((x) => x.id === a.listing.id);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeLessThan(idxA);
  });

  it('returns 429 when browse daily cap exceeded', async () => {
    const prev = process.env.BROWSE_DAILY_MAX;
    process.env.BROWSE_DAILY_MAX = '3';
    try {
      const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
      await request(app.getHttpServer() as Server).get('/api/v1/browse/flats').set('Cookie', cookie).expect(200);
      await request(app.getHttpServer() as Server).get('/api/v1/browse/flats').set('Cookie', cookie).expect(200);
      await request(app.getHttpServer() as Server).get('/api/v1/browse/flats').set('Cookie', cookie).expect(200);
      const res = await request(app.getHttpServer() as Server).get('/api/v1/browse/flats').set('Cookie', cookie).expect(429);
      expect(res.headers['retry-after']).toBeDefined();
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toBe('RATE_LIMIT');
    } finally {
      if (prev === undefined) delete process.env.BROWSE_DAILY_MAX;
      else process.env.BROWSE_DAILY_MAX = prev;
    }
  });
});
