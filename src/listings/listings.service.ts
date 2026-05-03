import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type Listing, type Profile, type User } from '@prisma/client';
import { listingIsPubliclyVisible } from '../common/visibility-rules';
import {
  isAllowedListingPhotoWrite,
  resolveMediaRefToPublicUrl,
  resolveMediaRefsToPublicUrls,
} from '../common/photo-url';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import type { ListingDto, ListingListerSnippetDto } from './listings.types';
import {
  fromPrismaListingPreferredGender,
  toPrismaListingPreferredGender,
  type ListingPatchBody,
  type ListingPutBody,
} from './schemas/listings.schemas';

function notFound(): never {
  throw new HttpException(
    { error: { code: 'NOT_FOUND', message: 'This listing is not available.' } },
    HttpStatus.NOT_FOUND,
  );
}

function mergeListingPatch(existing: Listing, patch: ListingPatchBody): ListingPutBody {
  return {
    localityName: patch.localityName ?? existing.localityName,
    lat: patch.lat ?? existing.lat,
    lng: patch.lng ?? existing.lng,
    bhk: patch.bhk ?? existing.bhk,
    totalRent: patch.totalRent ?? existing.totalRent,
    yourShare: patch.yourShare ?? existing.yourShare,
    availableFrom: patch.availableFrom ?? existing.availableFrom.toISOString(),
    photos: patch.photos ?? existing.photos,
    description: patch.description ?? existing.description,
    amenities: patch.amenities ?? existing.amenities,
    preferredGender: patch.preferredGender ?? fromPrismaListingPreferredGender(existing.preferredGender),
    preferredProfessions: patch.preferredProfessions ?? existing.preferredProfessions,
    smokingAllowed: patch.smokingAllowed ?? existing.smokingAllowed,
    foodPref: patch.foodPref !== undefined ? patch.foodPref : existing.foodPref,
    workSchedulePref: patch.workSchedulePref !== undefined ? patch.workSchedulePref : existing.workSchedulePref,
  };
}

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private assertListingPhotos(ownerUserId: string, photos: string[]): void {
    const env = this.config.get('R2_PUBLIC_URL', { infer: true });
    for (const ref of photos) {
      if (!isAllowedListingPhotoWrite(ref, ownerUserId, env)) {
        throw new HttpException(
          {
            error: {
              code: 'INVALID_INPUT',
              message:
                'Each listing photo must be an R2 object key under your account (listings/{yourUserId}/…) or a legacy HTTPS URL on the Burrow media domain.',
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private assertListerRole(role: Role): void {
    if (role !== Role.LISTER && role !== Role.BOTH) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'Only listers can manage a flat listing.' } },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private listerDto(u: User, p: Profile | null): ListingListerSnippetDto {
    if (!p || p.deletedAt) {
      throw new HttpException(
        { error: { code: 'NOT_FOUND', message: 'This listing is not available.' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const r2Env = this.config.get('R2_PUBLIC_URL', { infer: true });
    return {
      id: u.id,
      fullName: p.fullName,
      age: p.age,
      gender: p.gender,
      photoUrl: resolveMediaRefToPublicUrl(p.photoUrl, r2Env),
      profession: p.profession,
      companyName: u.companyName,
      companyVerified: u.companyVerified,
    };
  }

  toDto(row: Listing, owner: User, profile: Profile | null): ListingDto {
    const r2Env = this.config.get('R2_PUBLIC_URL', { infer: true });
    return {
      id: row.id,
      userId: row.userId,
      localityName: row.localityName,
      lat: row.lat,
      lng: row.lng,
      bhk: row.bhk,
      totalRent: row.totalRent,
      yourShare: row.yourShare,
      availableFrom: row.availableFrom.toISOString(),
      photos: resolveMediaRefsToPublicUrls(row.photos, r2Env),
      description: row.description,
      amenities: row.amenities,
      preferredGender: fromPrismaListingPreferredGender(row.preferredGender),
      preferredProfessions: row.preferredProfessions,
      smokingAllowed: row.smokingAllowed,
      foodPref: row.foodPref,
      workSchedulePref: row.workSchedulePref,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lister: this.listerDto(owner, profile),
    };
  }

  async getMine(userId: string): Promise<ListingDto> {
    const row = await this.prisma.listing.findUnique({
      where: { userId },
      include: { user: { include: { profile: true } } },
    });
    if (!row) notFound();
    return this.toDto(row, row.user, row.user.profile);
  }

  async createMine(userId: string, role: Role, body: ListingPutBody): Promise<ListingDto> {
    this.assertListerRole(role);
    this.assertListingPhotos(userId, body.photos);
    const existing = await this.prisma.listing.findUnique({ where: { userId } });
    if (existing?.isActive) {
      throw new HttpException(
        { error: { code: 'CONFLICT', message: 'You already have an active listing.' } },
        HttpStatus.CONFLICT,
      );
    }
    const owner = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { profile: true },
    });
    if (!owner) notFound();
    if (!owner.profile || owner.profile.deletedAt) {
      throw new HttpException(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Create your profile before posting a listing.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const data = {
      localityName: body.localityName,
      lat: body.lat,
      lng: body.lng,
      bhk: body.bhk,
      totalRent: body.totalRent,
      yourShare: body.yourShare,
      availableFrom: new Date(body.availableFrom),
      photos: body.photos,
      description: body.description,
      amenities: body.amenities,
      preferredGender: toPrismaListingPreferredGender(body.preferredGender),
      preferredProfessions: body.preferredProfessions,
      smokingAllowed: body.smokingAllowed,
      foodPref: body.foodPref ?? null,
      workSchedulePref: body.workSchedulePref ?? null,
      isActive: true,
    };
    const row = existing
      ? await this.prisma.listing.update({
          where: { userId },
          data: { ...data, deletedAt: null },
          include: { user: { include: { profile: true } } },
        })
      : await this.prisma.listing.create({
          data: { userId, ...data },
          include: { user: { include: { profile: true } } },
        });
    return this.toDto(row, row.user, row.user.profile);
  }

  async putMine(userId: string, role: Role, body: ListingPutBody): Promise<ListingDto> {
    this.assertListerRole(role);
    this.assertListingPhotos(userId, body.photos);
    const row = await this.prisma.listing.findUnique({
      where: { userId },
      include: { user: { include: { profile: true } } },
    });
    if (!row) {
      return this.createMine(userId, role, body);
    }
    const updated = await this.prisma.listing.update({
      where: { userId },
      data: {
        localityName: body.localityName,
        lat: body.lat,
        lng: body.lng,
        bhk: body.bhk,
        totalRent: body.totalRent,
        yourShare: body.yourShare,
        availableFrom: new Date(body.availableFrom),
        photos: body.photos,
        description: body.description,
        amenities: body.amenities,
        preferredGender: toPrismaListingPreferredGender(body.preferredGender),
        preferredProfessions: body.preferredProfessions,
        smokingAllowed: body.smokingAllowed,
        foodPref: body.foodPref ?? null,
        workSchedulePref: body.workSchedulePref ?? null,
      },
      include: { user: { include: { profile: true } } },
    });
    return this.toDto(updated, updated.user, updated.user.profile);
  }

  async patchMine(userId: string, role: Role, body: ListingPatchBody): Promise<ListingDto> {
    this.assertListerRole(role);
    const row = await this.prisma.listing.findUnique({ where: { userId } });
    if (!row) notFound();
    const merged = mergeListingPatch(row, body);
    this.assertListingPhotos(userId, merged.photos);
    const updated = await this.prisma.listing.update({
      where: { userId },
      data: {
        localityName: merged.localityName,
        lat: merged.lat,
        lng: merged.lng,
        bhk: merged.bhk,
        totalRent: merged.totalRent,
        yourShare: merged.yourShare,
        availableFrom: new Date(merged.availableFrom),
        photos: merged.photos,
        description: merged.description,
        amenities: merged.amenities,
        preferredGender: toPrismaListingPreferredGender(merged.preferredGender),
        preferredProfessions: merged.preferredProfessions,
        smokingAllowed: merged.smokingAllowed,
        foodPref: merged.foodPref ?? null,
        workSchedulePref: merged.workSchedulePref ?? null,
      },
      include: { user: { include: { profile: true } } },
    });
    return this.toDto(updated, updated.user, updated.user.profile);
  }

  async deactivateMine(userId: string, role: Role): Promise<{ ok: true }> {
    this.assertListerRole(role);
    await this.prisma.listing.updateMany({
      where: { userId },
      data: { isActive: false },
    });
    return { ok: true };
  }

  async getPublic(viewerId: string, listingId: string): Promise<ListingDto> {
    const row = await this.prisma.listing.findFirst({
      where: { id: listingId },
      include: { user: { include: { profile: true } } },
    });
    if (!row) notFound();
    const blocked = await this.prisma.block.findFirst({
      where: { blockerUserId: row.userId, blockedUserId: viewerId },
    });
    const viewerBlockedOwner = await this.prisma.block.findFirst({
      where: { blockerUserId: viewerId, blockedUserId: row.userId },
    });
    const ok = listingIsPubliclyVisible({
      isActive: row.isActive,
      ownerDeletedAt: row.user.deletedAt,
      ownerCompanyVerified: row.user.companyVerified,
      ownerProfileDeletedAt: row.user.profile?.deletedAt,
      viewerIsBlockedByOwner: Boolean(blocked),
      viewerHasBlockedOwner: Boolean(viewerBlockedOwner),
    });
    if (!ok) notFound();
    return this.toDto(row, row.user, row.user.profile);
  }
}
