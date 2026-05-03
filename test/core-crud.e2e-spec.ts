import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap/configure-http-app';
import { createUserWithSessionCookie } from './helpers/auth-e2e';

function futureAvailableFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

describe('Users / profiles / listings / constants (e2e)', () => {
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

  it('GET /api/v1/constants returns taxonomy without auth', async () => {
    const res = await request(app.getHttpServer() as Server).get('/api/v1/constants').expect(200);
    const body = res.body as {
      localities: string[];
      vibes: string[];
      professions: string[];
    };
    expect(body.localities).toContain('Cyber City');
    expect(body.vibes.length).toBeGreaterThan(0);
    expect(body.professions).toContain('Software engineer');
  });

  it('GET /api/v1/profiles/me returns 404 before profile exists', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.ONBOARDING });
    await request(app.getHttpServer() as Server)
      .get('/api/v1/profiles/me')
      .set('Cookie', cookie)
      .expect(404);
  });

  it('PUT /api/v1/profiles/me then GET returns profile with office fields', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.LISTER });
    const photo = 'https://cdn.burrow.in/me/photo.jpg';
    await request(app.getHttpServer() as Server)
      .put('/api/v1/profiles/me')
      .set('Cookie', cookie)
      .send({
        fullName: 'Priya',
        age: 29,
        gender: 'WOMAN',
        photoUrl: photo,
        bio: 'This bio is definitely long enough for the completion heuristic.',
        profession: 'Software engineer',
        workSchedule: 'FLEXIBLE',
        budgetMin: 18000,
        budgetMax: 35000,
        moveInDate: '2026-07-01T00:00:00.000Z',
        preferredLocalities: ['Sector 43'],
        lifestyleTags: ['Chill'],
        smokingPref: 'NON_SMOKER',
        foodPref: 'NON_VEG_OK',
        officeLat: 28.45,
        officeLng: 77.09,
      })
      .expect(200);
    const res = await request(app.getHttpServer() as Server)
      .get('/api/v1/profiles/me')
      .set('Cookie', cookie)
      .expect(200);
    const profile = res.body as { fullName: string; officeLat: number };
    expect(profile.fullName).toBe('Priya');
    expect(profile.officeLat).toBe(28.45);
  });

  it('PUT profile with disallowed photo host returns 400', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER });
    await request(app.getHttpServer() as Server)
      .put('/api/v1/profiles/me')
      .set('Cookie', cookie)
      .send({
        fullName: 'Alex',
        age: 30,
        gender: 'MAN',
        photoUrl: 'https://evil.example.com/a.jpg',
        bio: 'This bio is definitely long enough for the completion heuristic.',
        profession: 'Consultant',
        workSchedule: 'OFFICE',
        budgetMin: 20000,
        budgetMax: 40000,
        moveInDate: '2026-08-01T00:00:00.000Z',
        preferredLocalities: ['MG Road'],
        lifestyleTags: ['Foodie'],
        smokingPref: 'FLEXIBLE',
        foodPref: 'EGGETARIAN',
      })
      .expect(400);
  });

  it('POST /api/v1/listings/me as SEEKER returns 403', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.SEEKER, withProfile: true });
    await request(app.getHttpServer() as Server)
      .post('/api/v1/listings/me')
      .set('Cookie', cookie)
      .send({
        localityName: 'Cyber City',
        lat: 28.45,
        lng: 77.09,
        bhk: 2,
        totalRent: 50000,
        yourShare: 25000,
        availableFrom: futureAvailableFrom(),
        photos: ['https://cdn.burrow.in/u/a.jpg'],
        description: 'Bright flat near metro.',
        amenities: ['Wi-Fi', 'Lift'],
        preferredGender: 'ANYONE',
        preferredProfessions: ['Software engineer'],
        smokingAllowed: false,
        foodPref: 'NON_VEG_OK',
        workSchedulePref: 'FLEXIBLE',
      })
      .expect(403);
  });

  it('POST listing then duplicate POST returns 409', async () => {
    const { cookie } = await createUserWithSessionCookie(app, { role: Role.LISTER, withProfile: true });
    const body = {
      localityName: 'Cyber City',
      lat: 28.45,
      lng: 77.09,
      bhk: 2,
      totalRent: 50000,
      yourShare: 25000,
      availableFrom: futureAvailableFrom(),
      photos: ['https://cdn.burrow.in/u/a.jpg'],
      description: 'Bright flat near metro.',
      amenities: ['Wi-Fi', 'Lift'],
      preferredGender: 'ANYONE' as const,
      preferredProfessions: ['Software engineer'],
      smokingAllowed: false,
      foodPref: 'NON_VEG_OK',
      workSchedulePref: 'FLEXIBLE',
    };
    await request(app.getHttpServer() as Server).post('/api/v1/listings/me').set('Cookie', cookie).send(body).expect(201);
    await request(app.getHttpServer() as Server).post('/api/v1/listings/me').set('Cookie', cookie).send(body).expect(409);
  });

  it('PATCH /api/v1/users/me/role updates role for /auth/me', async () => {
    const { cookie, userId } = await createUserWithSessionCookie(app, { role: Role.ONBOARDING });
    await request(app.getHttpServer() as Server)
      .patch('/api/v1/users/me/role')
      .set('Cookie', cookie)
      .send({ role: 'LISTER' })
      .expect(200);
    const me = await request(app.getHttpServer() as Server).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    const meBody = me.body as { user: { id: string; role: string } };
    expect(meBody.user.id).toBe(userId);
    expect(meBody.user.role).toBe('LISTER');
  });
});
