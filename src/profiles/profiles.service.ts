import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Profile, User } from '@prisma/client';
import { profileIsPubliclyVisible } from '../common/visibility-rules';
import { isAllowedProfilePhotoWrite, resolveMediaRefToPublicUrl } from '../common/photo-url';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { computeProfileCompletion } from './profile-completion';
import type { ProfileOwnDto, ProfilePublicDto, ProfileUserSnippetDto } from './profiles.types';
import type { ProfilePatchBody, ProfilePutBody } from './schemas/profiles.schemas';

function notFound(): never {
  throw new HttpException(
    { error: { code: 'NOT_FOUND', message: 'This profile is not available.' } },
    HttpStatus.NOT_FOUND,
  );
}

function mergePatch(existing: Profile, patch: ProfilePatchBody): ProfilePutBody {
  return {
    fullName: patch.fullName ?? existing.fullName,
    age: patch.age ?? existing.age,
    gender: patch.gender ?? existing.gender,
    photoUrl: patch.photoUrl !== undefined ? patch.photoUrl : existing.photoUrl,
    bio: patch.bio ?? existing.bio,
    profession: patch.profession !== undefined ? patch.profession : existing.profession,
    workSchedule: patch.workSchedule !== undefined ? patch.workSchedule : existing.workSchedule,
    budgetMin: patch.budgetMin !== undefined ? patch.budgetMin : existing.budgetMin,
    budgetMax: patch.budgetMax !== undefined ? patch.budgetMax : existing.budgetMax,
    moveInDate:
      patch.moveInDate !== undefined
        ? patch.moveInDate
        : existing.moveInDate
          ? existing.moveInDate.toISOString()
          : null,
    preferredLocalities: patch.preferredLocalities ?? existing.preferredLocalities,
    lifestyleTags: patch.lifestyleTags ?? existing.lifestyleTags,
    smokingPref: patch.smokingPref !== undefined ? patch.smokingPref : existing.smokingPref,
    foodPref: patch.foodPref !== undefined ? patch.foodPref : existing.foodPref,
    officeLat: patch.officeLat !== undefined ? patch.officeLat : existing.officeLat,
    officeLng: patch.officeLng !== undefined ? patch.officeLng : existing.officeLng,
  };
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private assertPhoto(ownerUserId: string, photoUrl: string | null | undefined): void {
    if (photoUrl === null || photoUrl === undefined || photoUrl === '') return;
    const env = this.config.get('R2_PUBLIC_URL', { infer: true });
    if (!isAllowedProfilePhotoWrite(photoUrl, ownerUserId, env)) {
      throw new HttpException(
        {
          error: {
            code: 'INVALID_INPUT',
            message:
              'Photo must be an R2 object key under your account (profiles/{yourUserId}/…) or a legacy HTTPS URL on the Burrow media domain.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private userSnippet(u: User): ProfileUserSnippetDto {
    return {
      id: u.id,
      companyName: u.companyName,
      companyVerified: u.companyVerified,
    };
  }

  toPublicDto(p: Profile, u: User): ProfilePublicDto {
    const r2Env = this.config.get('R2_PUBLIC_URL', { infer: true });
    return {
      id: p.id,
      userId: p.userId,
      fullName: p.fullName,
      age: p.age,
      gender: p.gender,
      photoUrl: resolveMediaRefToPublicUrl(p.photoUrl, r2Env),
      bio: p.bio,
      profession: p.profession,
      workSchedule: p.workSchedule,
      budgetMin: p.budgetMin,
      budgetMax: p.budgetMax,
      moveInDate: p.moveInDate ? p.moveInDate.toISOString() : null,
      preferredLocalities: p.preferredLocalities,
      lifestyleTags: p.lifestyleTags,
      smokingPref: p.smokingPref,
      foodPref: p.foodPref,
      user: this.userSnippet(u),
    };
  }

  toOwnDto(p: Profile, u: User): ProfileOwnDto {
    return {
      ...this.toPublicDto(p, u),
      officeLat: p.officeLat ?? null,
      officeLng: p.officeLng ?? null,
    };
  }

  async getMine(userId: string): Promise<ProfileOwnDto> {
    const row = await this.prisma.profile.findFirst({
      where: { userId, deletedAt: null },
      include: { user: true },
    });
    if (!row) notFound();
    return this.toOwnDto(row, row.user);
  }

  async putMine(userId: string, body: ProfilePutBody): Promise<ProfileOwnDto> {
    this.assertPhoto(userId, body.photoUrl ?? null);
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) notFound();
    const completion = computeProfileCompletion(
      {
        photoUrl: body.photoUrl ?? null,
        bio: body.bio,
        profession: body.profession ?? null,
        budgetMin: body.budgetMin ?? null,
        budgetMax: body.budgetMax ?? null,
        moveInDate: body.moveInDate ? new Date(body.moveInDate) : null,
        lifestyleTags: body.lifestyleTags,
      },
      { phoneVerified: user.phoneVerified },
    );
    const moveIn = body.moveInDate ? new Date(body.moveInDate) : null;
    const row = await this.prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        fullName: body.fullName,
        age: body.age,
        gender: body.gender,
        photoUrl: body.photoUrl ?? null,
        bio: body.bio,
        profession: body.profession ?? null,
        workSchedule: body.workSchedule ?? null,
        budgetMin: body.budgetMin ?? null,
        budgetMax: body.budgetMax ?? null,
        moveInDate: moveIn,
        preferredLocalities: body.preferredLocalities,
        lifestyleTags: body.lifestyleTags,
        smokingPref: body.smokingPref ?? null,
        foodPref: body.foodPref ?? null,
        officeLat: body.officeLat ?? null,
        officeLng: body.officeLng ?? null,
        profileCompletion: completion,
      },
      update: {
        fullName: body.fullName,
        age: body.age,
        gender: body.gender,
        photoUrl: body.photoUrl ?? null,
        bio: body.bio,
        profession: body.profession ?? null,
        workSchedule: body.workSchedule ?? null,
        budgetMin: body.budgetMin ?? null,
        budgetMax: body.budgetMax ?? null,
        moveInDate: moveIn,
        preferredLocalities: body.preferredLocalities,
        lifestyleTags: body.lifestyleTags,
        smokingPref: body.smokingPref ?? null,
        foodPref: body.foodPref ?? null,
        officeLat: body.officeLat ?? null,
        officeLng: body.officeLng ?? null,
        profileCompletion: completion,
        deletedAt: null,
      },
    });
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.toOwnDto(row, u);
  }

  async patchMine(userId: string, body: ProfilePatchBody): Promise<ProfileOwnDto> {
    const existing = await this.prisma.profile.findFirst({ where: { userId, deletedAt: null } });
    if (!existing) notFound();
    if (body.photoUrl !== undefined) this.assertPhoto(userId, body.photoUrl);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const merged = mergePatch(existing, body);
    const completion = computeProfileCompletion(
      {
        photoUrl: merged.photoUrl ?? null,
        bio: merged.bio,
        profession: merged.profession ?? null,
        budgetMin: merged.budgetMin ?? null,
        budgetMax: merged.budgetMax ?? null,
        moveInDate: merged.moveInDate ? new Date(merged.moveInDate) : null,
        lifestyleTags: merged.lifestyleTags,
      },
      { phoneVerified: user.phoneVerified },
    );
    const moveIn = merged.moveInDate ? new Date(merged.moveInDate) : null;
    const row = await this.prisma.profile.update({
      where: { userId },
      data: {
        fullName: merged.fullName,
        age: merged.age,
        gender: merged.gender,
        photoUrl: merged.photoUrl ?? null,
        bio: merged.bio,
        profession: merged.profession ?? null,
        workSchedule: merged.workSchedule ?? null,
        budgetMin: merged.budgetMin ?? null,
        budgetMax: merged.budgetMax ?? null,
        moveInDate: moveIn,
        preferredLocalities: merged.preferredLocalities,
        lifestyleTags: merged.lifestyleTags,
        smokingPref: merged.smokingPref ?? null,
        foodPref: merged.foodPref ?? null,
        officeLat: merged.officeLat ?? null,
        officeLng: merged.officeLng ?? null,
        profileCompletion: completion,
      },
    });
    return this.toOwnDto(row, user);
  }

  async getPublic(viewerId: string, targetUserId: string): Promise<ProfilePublicDto> {
    const row = await this.prisma.profile.findFirst({
      where: { userId: targetUserId },
      include: { user: true },
    });
    if (!row) notFound();
    const blocked = await this.prisma.block.findFirst({
      where: { blockerUserId: targetUserId, blockedUserId: viewerId },
    });
    const viewerBlockedOwner = await this.prisma.block.findFirst({
      where: { blockerUserId: viewerId, blockedUserId: targetUserId },
    });
    const ok = profileIsPubliclyVisible({
      ownerDeletedAt: row.user.deletedAt,
      ownerCompanyVerified: row.user.companyVerified,
      profileRowExists: true,
      profileDeletedAt: row.deletedAt,
      viewerIsBlockedByOwner: Boolean(blocked),
      viewerHasBlockedOwner: Boolean(viewerBlockedOwner),
    });
    if (!ok) notFound();
    return this.toPublicDto(row, row.user);
  }
}
