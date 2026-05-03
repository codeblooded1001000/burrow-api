import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import request from 'supertest';
import { FoodPref, Gender, ManualReviewStatus, Role, SmokingPref, WorkSchedule } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap/configure-http-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { createUserWithSessionCookie } from './helpers/auth-e2e';

describe('Safety + Admin (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let pinHash: string;
  const adminPassword = 'e2e-admin-secret-16chars';

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = adminPassword;
    pinHash = await argon2.hash('222222', {
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
    await app.listen(0);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const loginKeys = await redis.getClient().keys('ratelimit:admin:login:*');
    if (loginKeys.length > 0) {
      await redis.getClient().del(...loginKeys);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedListerFlat(localityName: string, yourShare: number) {
    const unique = randomBytes(8).toString('hex');
    const email = `safe-${unique}@infosys.com`;
    const user = await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        pinHash,
        role: Role.LISTER,
        companyName: 'Infosys',
        companyVerified: true,
      },
    });
    await prisma.profile.create({
      data: {
        userId: user.id,
        fullName: 'Safe Lister',
        age: 30,
        gender: Gender.WOMAN,
        bio: 'This bio is long enough for profile completion scoring in tests.',
        profession: 'Software engineer',
        workSchedule: WorkSchedule.FLEXIBLE,
        budgetMin: 10000,
        budgetMax: 40000,
        moveInDate: new Date('2026-09-01T00:00:00.000Z'),
        preferredLocalities: [localityName],
        lifestyleTags: ['Chill'],
        smokingPref: SmokingPref.NON_SMOKER,
        foodPref: FoodPref.NON_VEG_OK,
        profileCompletion: 70,
      },
    });
    const listing = await prisma.listing.create({
      data: {
        userId: user.id,
        localityName,
        lat: 28.45,
        lng: 77.09,
        bhk: 2,
        totalRent: 50000,
        yourShare,
        availableFrom: new Date('2026-10-15T00:00:00.000Z'),
        photos: ['https://cdn.burrow.in/u/a.jpg'],
        description: 'Bright flat near metro.',
        amenities: ['Wi-Fi'],
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

  it('report auto-blocks; target hidden from browse; duplicate returns 200', async () => {
    const seeker = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    const { user: lister, listing } = await seedListerFlat('Sector 54', 25000);

    const before = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flats?limit=20&localities=Sector+54')
      .set('Cookie', seeker.cookie)
      .expect(200);
    const beforeIds = (before.body as { items: { id: string }[] }).items.map((x) => x.id);
    expect(beforeIds).toContain(listing.id);

    const rep1 = await request(app.getHttpServer() as Server)
      .post('/api/v1/reports')
      .set('Cookie', seeker.cookie)
      .send({
        reportedUserId: lister.id,
        category: 'HARASSMENT',
        detail: 'test report',
      })
      .expect(201);
    expect((rep1.body as { autoBlocked: boolean }).autoBlocked).toBe(true);

    const block = await prisma.block.findFirst({
      where: { blockerUserId: seeker.userId, blockedUserId: lister.id },
    });
    expect(block).not.toBeNull();

    const after = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flats?limit=20&localities=Sector+54')
      .set('Cookie', seeker.cookie)
      .expect(200);
    const afterIds = (after.body as { items: { id: string }[] }).items.map((x) => x.id);
    expect(afterIds).not.toContain(listing.id);

    const rep2 = await request(app.getHttpServer() as Server)
      .post('/api/v1/reports')
      .set('Cookie', seeker.cookie)
      .send({
        reportedUserId: lister.id,
        category: 'HARASSMENT',
      })
      .expect(200);
    expect((rep2.body as { report: { id: string } }).report.id).toBe((rep1.body as { report: { id: string } }).report.id);
  });

  it('block then unblock restores browse visibility', async () => {
    const seeker = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    const { user: lister, listing } = await seedListerFlat('Sector 54', 24000);

    await request(app.getHttpServer() as Server)
      .post('/api/v1/blocks')
      .set('Cookie', seeker.cookie)
      .send({ userId: lister.id })
      .expect(201);

    const hidden = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flats?limit=20&localities=Sector+54')
      .set('Cookie', seeker.cookie)
      .expect(200);
    expect((hidden.body as { items: { id: string }[] }).items.map((x) => x.id)).not.toContain(listing.id);

    await request(app.getHttpServer() as Server)
      .delete(`/api/v1/blocks/${lister.id}`)
      .set('Cookie', seeker.cookie)
      .expect(200);

    const visible = await request(app.getHttpServer() as Server)
      .get('/api/v1/browse/flats?limit=20&localities=Sector+54')
      .set('Cookie', seeker.cookie)
      .expect(200);
    expect((visible.body as { items: { id: string }[] }).items.map((x) => x.id)).toContain(listing.id);
  });

  it('admin approve manual review sets companyVerified', async () => {
    const domain = `newcorp-${randomBytes(4).toString('hex')}.com`;
    const email = `user@${domain}`;
    await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        pinHash,
        role: Role.SEEKER,
        companyName: 'NewCorp',
        companyVerified: false,
      },
    });
    const mr = await prisma.manualReviewRequest.create({
      data: {
        email,
        companyClaim: 'NewCorp',
        status: ManualReviewStatus.PENDING,
      },
    });

    const login = await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/login')
      .send({ password: adminPassword })
      .expect(200);
    const token = (login.body as { token: string }).token;

    await request(app.getHttpServer() as Server)
      .post(`/api/v1/admin/manual-reviews/${mr.id}/approve`)
      .set('X-Admin-Token', `Bearer ${token}`)
      .expect(200);

    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.companyVerified).toBe(true);
  });

  it('admin ban hides listing from public GET', async () => {
    const { user: lister, listing } = await seedListerFlat('Sector 54', 23000);
    const other = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });

    await request(app.getHttpServer() as Server)
      .get(`/api/v1/listings/${listing.id}`)
      .set('Cookie', other.cookie)
      .expect(200);

    const login = await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/login')
      .send({ password: adminPassword })
      .expect(200);
    const token = (login.body as { token: string }).token;

    await request(app.getHttpServer() as Server)
      .post(`/api/v1/admin/users/${lister.id}/ban`)
      .set('X-Admin-Token', `Bearer ${token}`)
      .send({ reason: 'Test ban from e2e' })
      .expect(200);

    await request(app.getHttpServer() as Server)
      .get(`/api/v1/listings/${listing.id}`)
      .set('Cookie', other.cookie)
      .expect(404);
  });

  it('GET /blocks lists blocked users', async () => {
    const a = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    const b = await createUserWithSessionCookie(app, { role: Role.LISTER, withProfile: true });
    await request(app.getHttpServer() as Server)
      .post('/api/v1/blocks')
      .set('Cookie', a.cookie)
      .send({ userId: b.userId })
      .expect(201);

    const list = await request(app.getHttpServer() as Server)
      .get('/api/v1/blocks')
      .set('Cookie', a.cookie)
      .expect(200);
    const items = (list.body as { items: { blockedUser: { id: string } }[] }).items;
    expect(items.some((x) => x.blockedUser.id === b.userId)).toBe(true);
  });

  it('admin login: 5 bad passwords then 429', async () => {
    const keys = await redis.getClient().keys('ratelimit:admin:login:*');
    if (keys.length > 0) {
      await redis.getClient().del(...keys);
    }
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer() as Server)
        .post('/api/v1/admin/login')
        .send({ password: 'wrong-password-here' })
        .expect(401);
    }
    await request(app.getHttpServer() as Server)
      .post('/api/v1/admin/login')
      .send({ password: 'wrong-password-here' })
      .expect(429);
  });
});
