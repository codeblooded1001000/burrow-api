import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import { FoodPref, Gender, Role, SmokingPref, WorkSchedule } from '@prisma/client';
import { SESSION_COOKIE_NAME } from '../../src/auth/auth.constants';
import { SessionService } from '../../src/auth/services/session.service';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface CreateUserWithSessionOptions {
  role: Role;
  email?: string;
  companyVerified?: boolean;
  withProfile?: boolean;
}

export async function createUserWithSessionCookie(
  app: INestApplication,
  opts: CreateUserWithSessionOptions,
): Promise<{ userId: string; email: string; cookie: string }> {
  const prisma = app.get(PrismaService);
  const session = app.get(SessionService);
  const pinHash = await argon2.hash('847291', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const email = opts.email ?? `e2e-${randomBytes(8).toString('hex')}@infosys.com`;
  const user = await prisma.user.create({
    data: {
      email,
      emailVerified: true,
      pinHash,
      role: opts.role,
      companyName: 'Infosys',
      companyVerified: opts.companyVerified ?? true,
    },
  });
  if (opts.withProfile) {
    await prisma.profile.create({
      data: {
        userId: user.id,
        fullName: 'E2E User',
        age: 28,
        gender: Gender.WOMAN,
        bio: 'This bio is long enough for profile completion scoring in tests.',
        profession: 'Software engineer',
        workSchedule: WorkSchedule.FLEXIBLE,
        budgetMin: 20000,
        budgetMax: 40000,
        moveInDate: new Date('2026-08-01T00:00:00.000Z'),
        preferredLocalities: ['Cyber City'],
        lifestyleTags: ['Chill'],
        smokingPref: SmokingPref.NON_SMOKER,
        foodPref: FoodPref.NON_VEG_OK,
        profileCompletion: 70,
      },
    });
  }
  const token = session.createSessionToken(user.id, user.role);
  return { userId: user.id, email, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}
