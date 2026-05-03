import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import request from 'supertest';
import { ConversationStatus, FoodPref, Gender, Role, SmokingPref, WorkSchedule } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap/configure-http-app';
import { SESSION_COOKIE_NAME } from '../src/auth/auth.constants';
import { SessionService } from '../src/auth/services/session.service';
import { MessagingPendingArchiveService } from '../src/messaging/messaging-pending-archive.service';
import { PrismaService } from '../src/prisma/prisma.service';

function serverPort(server: Server): number {
  const addr = server.address();
  if (addr && typeof addr === 'object') return addr.port;
  throw new Error('no port');
}

async function readStreamUntil(
  port: number,
  cookie: string,
  predicate: (chunk: string) => boolean,
  ms: number,
): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, ms);
  let buf = '';
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/v1/messages/stream`, {
      headers: { Cookie: cookie, Accept: 'text/event-stream' },
      signal: ac.signal,
    });
    if (!res.ok || res.body == null) throw new Error(`stream failed ${String(res.status)}`);
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      if (predicate(buf)) {
        clearTimeout(timer);
        await reader.cancel().catch(() => {
          return undefined;
        });
        ac.abort();
        return buf;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  throw new Error('SSE timeout or stream ended');
}

describe('Messaging (e2e)', () => {
  jest.setTimeout(20_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let session: SessionService;
  let pinHash: string;

  beforeAll(async () => {
    process.env.MESSAGING_RATE_LIMIT_OFF = 'true';
    pinHash = await argon2.hash('111111', {
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
    session = app.get(SessionService);
  });

  afterAll(async () => {
    delete process.env.MESSAGING_RATE_LIMIT_OFF;
    await app.close();
  });

  function cookieFor(userId: string, role: Role): string {
    return `${SESSION_COOKIE_NAME}=${session.createSessionToken(userId, role)}`;
  }

  async function createVerifiedUserWithProfile(opts: { role: Role; phone?: string }) {
    const email = `msg-${randomBytes(6).toString('hex')}@infosys.com`;
    const user = await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        pinHash,
        role: opts.role,
        companyName: 'Infosys',
        companyVerified: true,
        phoneNumber: opts.phone ?? null,
        phoneVerified: opts.phone ? true : false,
      },
    });
    await prisma.profile.create({
      data: {
        userId: user.id,
        fullName: 'Msg User',
        age: 29,
        gender: Gender.WOMAN,
        bio: 'This bio is long enough for profile completion scoring in tests.',
        profession: 'Software engineer',
        workSchedule: WorkSchedule.FLEXIBLE,
        budgetMin: 20000,
        budgetMax: 35000,
        moveInDate: new Date('2026-08-01T00:00:00.000Z'),
        preferredLocalities: ['Cyber City'],
        lifestyleTags: ['Chill'],
        smokingPref: SmokingPref.NON_SMOKER,
        foodPref: FoodPref.NON_VEG_OK,
        profileCompletion: 70,
      },
    });
    return user;
  }

  it('GET /conversations/lookup returns conversationId when a thread exists', async () => {
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
    const cookieA = cookieFor(a.id, a.role);
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieA)
      .send({ recipientUserId: b.id, initialMessage: 'Hi' })
      .expect(201);
    const convId = (created.body as { conversation: { id: string } }).conversation.id;
    const look = await request(app.getHttpServer() as Server)
      .get(`/api/v1/conversations/lookup?otherUserId=${encodeURIComponent(b.id)}`)
      .set('Cookie', cookieA)
      .expect(200);
    expect((look.body as { conversationId: string | null }).conversationId).toBe(convId);
    const none = await request(app.getHttpServer() as Server)
      .get(`/api/v1/conversations/lookup?otherUserId=${encodeURIComponent(`ghost-${randomBytes(4).toString('hex')}`)}`)
      .set('Cookie', cookieA)
      .expect(200);
    expect((none.body as { conversationId: string | null }).conversationId).toBeNull();
  });

  it('full lifecycle: create → messages → read → number share → phones visible', async () => {
    const phoneA = `+9198${randomBytes(5).toString('hex').slice(0, 10)}`;
    const phoneB = `+9198${randomBytes(5).toString('hex').slice(0, 10)}`;
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER, phone: phoneA });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER, phone: phoneB });
    const cookieA = cookieFor(a.id, a.role);
    const cookieB = cookieFor(b.id, b.role);

    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieA)
      .send({ recipientUserId: b.id, initialMessage: 'Hi there!' })
      .expect(201);
    const body = created.body as {
      conversation: { id: string; status: string };
      message: { id: string; body: string };
    };
    expect(body.message.body).toBe('Hi there!');
    expect(body.conversation.status).toBe('PENDING');
    const convId = body.conversation.id;

    const dup = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieA)
      .send({ recipientUserId: b.id, initialMessage: 'Again' })
      .expect(201);
    expect((dup.body as { conversation: { id: string } }).conversation.id).toBe(convId);

    const reqList = await request(app.getHttpServer() as Server)
      .get('/api/v1/conversations?tab=requests')
      .set('Cookie', cookieB)
      .expect(200);
    const reqItems = (reqList.body as { items: { id: string }[] }).items;
    expect(reqItems.some((c) => c.id === convId)).toBe(true);

    const secondFromA = await request(app.getHttpServer() as Server)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Cookie', cookieA)
      .send({ body: 'should fail until accepted' })
      .expect(403);
    expect((secondFromA.body as { error: { code: string } }).error.code).toBe('REQUEST_PENDING_ACCEPTANCE');

    await request(app.getHttpServer() as Server)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Cookie', cookieB)
      .send({ body: 'Hi back — accepting by reply' })
      .expect(201);

    const list = await request(app.getHttpServer() as Server)
      .get('/api/v1/conversations?tab=active')
      .set('Cookie', cookieB)
      .expect(200);
    const items = (list.body as { items: { id: string; unreadCount: number }[] }).items;
    expect(items.some((c) => c.id === convId)).toBe(true);

    const unread = await request(app.getHttpServer() as Server)
      .get('/api/v1/messages/unread-count')
      .set('Cookie', cookieB)
      .expect(200);
    expect((unread.body as { count: number }).count).toBeGreaterThan(0);

    const patchRead = await request(app.getHttpServer() as Server)
      .patch(`/api/v1/conversations/${convId}/messages/read`)
      .set('Cookie', cookieB)
      .send({})
      .expect(200);
    expect((patchRead.body as { markedRead: number }).markedRead).toBeGreaterThan(0);

    const msgs = await request(app.getHttpServer() as Server)
      .get(`/api/v1/conversations/${convId}/messages`)
      .set('Cookie', cookieB)
      .expect(200);
    expect((msgs.body as { items: unknown[] }).items.length).toBeGreaterThan(0);

    await request(app.getHttpServer() as Server)
      .post(`/api/v1/conversations/${convId}/number-share/request`)
      .set('Cookie', cookieA)
      .expect(201);

    const pendingReq = await prisma.numberShareRequest.findFirst({
      where: { conversationId: convId, status: 'PENDING' },
    });
    if (pendingReq === null) {
      throw new Error('expected pending number share request');
    }

    const respond = await request(app.getHttpServer() as Server)
      .post(`/api/v1/conversations/${convId}/number-share/respond`)
      .set('Cookie', cookieB)
      .send({ requestId: pendingReq.id, accept: true })
      .expect(201);
    const respBody = respond.body as {
      phoneNumbers: { requesterPhone: string | null; responderPhone: string | null };
    };
    expect(respBody.phoneNumbers.requesterPhone).toBe(phoneA);
    expect(respBody.phoneNumbers.responderPhone).toBe(phoneB);

    const convGet = await request(app.getHttpServer() as Server)
      .get(`/api/v1/conversations/${convId}`)
      .set('Cookie', cookieA)
      .expect(200);
    const convDto = convGet.body as { numbersShared: boolean; myPhoneNumber?: string; otherPhoneNumber?: string };
    expect(convDto.numbersShared).toBe(true);
    expect(convDto.myPhoneNumber).toBe(phoneA);
    expect(convDto.otherPhoneNumber).toBe(phoneB);
  });

  it('blocked user cannot start conversation', async () => {
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
    await prisma.block.create({ data: { blockerUserId: b.id, blockedUserId: a.id } });
    const res = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieFor(a.id, a.role))
      .send({ recipientUserId: b.id, initialMessage: 'Hi' })
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('BLOCKED_BY_USER');
  });

  it('SSE receives message_new when other user sends', async () => {
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
    const cookieA = cookieFor(a.id, a.role);
    const cookieB = cookieFor(b.id, b.role);

    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieA)
      .send({ recipientUserId: b.id, initialMessage: 'ping' })
      .expect(201);
    const convId = (created.body as { conversation: { id: string } }).conversation.id;

    const port = serverPort(app.getHttpServer() as Server);
    const ssePromise = readStreamUntil(
      port,
      cookieB,
      (buf) => buf.includes('message_new') && buf.includes('live sse test'),
      8000,
    );

    await new Promise((r) => setTimeout(r, 200));
    await request(app.getHttpServer() as Server)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Cookie', cookieB)
      .send({ body: 'activate' })
      .expect(201);
    await request(app.getHttpServer() as Server)
      .post(`/api/v1/conversations/${convId}/messages`)
      .set('Cookie', cookieA)
      .send({ body: 'live sse test' })
      .expect(201);

    const buf = await ssePromise;
    expect(buf).toContain('message_new');
    expect(buf).toContain('live sse test');
  });

  it('rate limit: new conversations per day', async () => {
    delete process.env.MESSAGING_RATE_LIMIT_OFF;
    process.env.MESSAGING_NEW_CONV_MAX = '2';
    try {
      const u = await createVerifiedUserWithProfile({ role: Role.SEEKER });
      const targets = await Promise.all([
        createVerifiedUserWithProfile({ role: Role.LISTER }),
        createVerifiedUserWithProfile({ role: Role.LISTER }),
        createVerifiedUserWithProfile({ role: Role.LISTER }),
      ]);
      const cookie = cookieFor(u.id, u.role);
      await request(app.getHttpServer() as Server)
        .post('/api/v1/conversations')
        .set('Cookie', cookie)
        .send({ recipientUserId: targets[0].id, initialMessage: '1' })
        .expect(201);
      await request(app.getHttpServer() as Server)
        .post('/api/v1/conversations')
        .set('Cookie', cookie)
        .send({ recipientUserId: targets[1].id, initialMessage: '2' })
        .expect(201);
      const res = await request(app.getHttpServer() as Server)
        .post('/api/v1/conversations')
        .set('Cookie', cookie)
        .send({ recipientUserId: targets[2].id, initialMessage: '3' })
        .expect(429);
      expect((res.body as { error: { code: string } }).error.code).toBe('RATE_LIMIT');
    } finally {
      process.env.MESSAGING_RATE_LIMIT_OFF = 'true';
      delete process.env.MESSAGING_NEW_CONV_MAX;
    }
  });

  it('rate limit: messages per minute', async () => {
    delete process.env.MESSAGING_RATE_LIMIT_OFF;
    process.env.MESSAGING_MSG_PER_MIN = '3';
    try {
      const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
      const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
      const cookieA = cookieFor(a.id, a.role);
      const created = await request(app.getHttpServer() as Server)
        .post('/api/v1/conversations')
        .set('Cookie', cookieA)
        .send({ recipientUserId: b.id, initialMessage: 'start' })
        .expect(201);
      const convId = (created.body as { conversation: { id: string } }).conversation.id;
      const cookieB = cookieFor(b.id, b.role);
      await request(app.getHttpServer() as Server)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Cookie', cookieB)
        .send({ body: 'open chat' })
        .expect(201);
      for (let i = 0; i < 3; i += 1) {
        await request(app.getHttpServer() as Server)
          .post(`/api/v1/conversations/${convId}/messages`)
          .set('Cookie', cookieA)
          .send({ body: `m${String(i)}` })
          .expect(201);
      }
      const res = await request(app.getHttpServer() as Server)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Cookie', cookieA)
        .send({ body: 'overflow' })
        .expect(429);
      expect((res.body as { error: { code: string } }).error.code).toBe('RATE_LIMIT');
    } finally {
      process.env.MESSAGING_RATE_LIMIT_OFF = 'true';
      delete process.env.MESSAGING_MSG_PER_MIN;
    }
  });

  it('soft-deleted user conversation hidden from partner list', async () => {
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
    const cookieA = cookieFor(a.id, a.role);
    const cookieB = cookieFor(b.id, b.role);
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieA)
      .send({ recipientUserId: b.id, initialMessage: 'x' })
      .expect(201);
    const convId = (created.body as { conversation: { id: string } }).conversation.id;
    const before = await request(app.getHttpServer() as Server)
      .get('/api/v1/conversations?tab=all')
      .set('Cookie', cookieB)
      .expect(200);
    expect((before.body as { items: { id: string }[] }).items.some((c) => c.id === convId)).toBe(true);

    await prisma.user.update({ where: { id: a.id }, data: { deletedAt: new Date() } });

    const after = await request(app.getHttpServer() as Server)
      .get('/api/v1/conversations?tab=all')
      .set('Cookie', cookieB)
      .expect(200);
    expect((after.body as { items: { id: string }[] }).items.some((c) => c.id === convId)).toBe(false);
  });

  it('explicit accept publishes request_accepted to initiator', async () => {
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
    const cookieA = cookieFor(a.id, a.role);
    const cookieB = cookieFor(b.id, b.role);
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieA)
      .send({ recipientUserId: b.id, initialMessage: 'Intro' })
      .expect(201);
    const convId = (created.body as { conversation: { id: string } }).conversation.id;
    const port = serverPort(app.getHttpServer() as Server);
    const ssePromise = readStreamUntil(port, cookieA, (buf) => buf.includes('request_accepted'), 6000);
    await new Promise((r) => setTimeout(r, 150));
    await request(app.getHttpServer() as Server)
      .post(`/api/v1/conversations/${convId}/accept`)
      .set('Cookie', cookieB)
      .expect(201);
    const buf = await ssePromise;
    expect(buf).toContain('request_accepted');
  });

  it('reject locks original initiator out of new requests', async () => {
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
    const cookieA = cookieFor(a.id, a.role);
    const cookieB = cookieFor(b.id, b.role);
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieA)
      .send({ recipientUserId: b.id, initialMessage: 'Hi' })
      .expect(201);
    const convId = (created.body as { conversation: { id: string } }).conversation.id;
    await request(app.getHttpServer() as Server)
      .post(`/api/v1/conversations/${convId}/reject`)
      .set('Cookie', cookieB)
      .send({ reason: 'not a fit' })
      .expect(201);
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/conversations/${convId}`)
      .set('Cookie', cookieA)
      .expect(404);
    const again = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieA)
      .send({ recipientUserId: b.id, initialMessage: 'Retry' })
      .expect(404);
    expect((again.body as { error: { code: string } }).error.code).toBe('CANNOT_SEND_REQUEST');
  });

  it('archives stale PENDING conversations via archive job', async () => {
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieFor(a.id, a.role))
      .send({ recipientUserId: b.id, initialMessage: 'old' })
      .expect(201);
    const convId = (created.body as { conversation: { id: string } }).conversation.id;
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prisma.conversation.update({ where: { id: convId }, data: { createdAt: old } });
    const archive = app.get(MessagingPendingArchiveService);
    const n = await archive.archiveStalePendingOlderThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    expect(n).toBeGreaterThanOrEqual(1);
    const row = await prisma.conversation.findFirstOrThrow({ where: { id: convId } });
    expect(row.status).toBe(ConversationStatus.ARCHIVED);
  });

  it('block by receiver auto-rejects pending request', async () => {
    const a = await createVerifiedUserWithProfile({ role: Role.SEEKER });
    const b = await createVerifiedUserWithProfile({ role: Role.LISTER });
    const cookieB = cookieFor(b.id, b.role);
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/conversations')
      .set('Cookie', cookieFor(a.id, a.role))
      .send({ recipientUserId: b.id, initialMessage: 'Hi' })
      .expect(201);
    const convId = (created.body as { conversation: { id: string } }).conversation.id;
    await request(app.getHttpServer() as Server)
      .post('/api/v1/blocks')
      .set('Cookie', cookieB)
      .send({ userId: a.id })
      .expect(201);
    const row = await prisma.conversation.findFirstOrThrow({ where: { id: convId } });
    expect(row.status).toBe(ConversationStatus.REJECTED);
  });
});
