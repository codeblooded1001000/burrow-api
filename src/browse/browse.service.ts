import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Role } from '@prisma/client';
import type { UserDto } from '../auth/schemas/auth.schemas';
import { ListingsService } from '../listings/listings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RedisService } from '../redis/redis.service';
import { scoreListingForBrowse, scoreProfileForBrowse } from './helpers/browse-score';
import type { BrowseSortMode } from './helpers/cursor';
import {
  decodeBrowseCursor,
  encodeBrowseCursor,
  type BrowseCursorPayload,
  type NewestCursorPayload,
} from './helpers/cursor';
import {
  buildListingBrowseWhere,
  buildListingCursorWhere,
  buildProfileBrowseWhere,
  buildProfileCursorWhere,
} from './helpers/filter-builder';
import type { BrowseQueryDto } from './schemas/browse.schemas';
import { BrowseQuerySchema } from './schemas/browse.schemas';
import type { BrowseListingItemDto, BrowseProfileItemDto } from './browse.types';

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

function decodeSortMode(requested: BrowseSortMode): BrowseSortMode {
  if (requested === 'best_match') return 'newest';
  return requested;
}

function prismaRoleFromViewer(user: UserDto): Role {
  if (user.role === 'LISTER') return Role.LISTER;
  if (user.role === 'SEEKER') return Role.SEEKER;
  if (user.role === 'BOTH') return Role.BOTH;
  return Role.ONBOARDING;
}

function listingOrderBy(sort: 'newest' | 'soonest_move_in'): Prisma.ListingOrderByWithRelationInput[] {
  if (sort === 'soonest_move_in') {
    return [{ availableFrom: 'asc' }, { id: 'asc' }];
  }
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

function profileOrderBy(): Prisma.ProfileOrderByWithRelationInput[] {
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

@Injectable()
export class BrowseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly listings: ListingsService,
    private readonly profiles: ProfilesService,
  ) {}

  private browseDailyMax(): number {
    const raw = process.env.BROWSE_DAILY_MAX;
    if (raw !== undefined && raw !== '') {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 1000;
  }

  private async assertBrowseDailyLimit(userId: string): Promise<void> {
    const cap = this.browseDailyMax();
    const day = new Date().toISOString().slice(0, 10);
    const key = `browse:day:${userId}:${day}`;
    const n = await this.redis.incr(key);
    if (n === 1) {
      await this.redis.expire(key, 60 * 60 * 48);
    }
    if (n > cap) {
      const retryAfter = secondsUntilUtcMidnight();
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMIT',
            message: "You've browsed a lot today. Take a break and come back tomorrow.",
          },
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  assertRoleFlats(role: Role): void {
    if (role !== Role.SEEKER && role !== Role.BOTH) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'Only seekers can browse flats.' } },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  assertRoleFlatmates(role: Role): void {
    if (role !== Role.LISTER && role !== Role.BOTH) {
      throw new HttpException(
        { error: { code: 'FORBIDDEN', message: 'Only listers can browse flatmates.' } },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async browseFlats(viewer: UserDto, rawQuery: BrowseQueryDto): Promise<{
    items: BrowseListingItemDto[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const role = prismaRoleFromViewer(viewer);
    this.assertRoleFlats(role);
    const query = BrowseQuerySchema.parse(rawQuery);
    await this.assertBrowseDailyLimit(viewer.id);

    const requestedSort = query.sort;
    // TODO(best_match): real ranking in v1.1; MVP uses newest ordering.
    const effectiveListingSort: 'newest' | 'soonest_move_in' =
      requestedSort === 'soonest_move_in' ? 'soonest_move_in' : 'newest';

    const cursorSort = decodeSortMode(requestedSort);
    const cursorPayload = decodeBrowseCursor(query.cursor, cursorSort);

    const filter = buildListingBrowseWhere(viewer.id, query);
    const cursorWhere = buildListingCursorWhere(cursorPayload);
    const where: Prisma.ListingWhereInput = cursorWhere ? { AND: [filter, cursorWhere] } : filter;

    const rows = await this.prisma.listing.findMany({
      where,
      include: { user: { include: { profile: true } } },
      orderBy: listingOrderBy(effectiveListingSort),
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;

    const items: BrowseListingItemDto[] = slice.map((row) => {
      const profile = row.user.profile;
      if (!profile || profile.deletedAt) {
        throw new Error('invariant: browse listing without lister profile');
      }
      const dto = this.listings.toDto(row, row.user, profile);
      const matchScore = scoreListingForBrowse(row, profile, query);
      return { ...dto, matchScore };
    });

    let nextCursor: string | null = null;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1];
      if (effectiveListingSort === 'soonest_move_in') {
        const payload: BrowseCursorPayload = {
          v: 1,
          sort: 'soonest_move_in',
          availableFrom: last.availableFrom.toISOString(),
          id: last.id,
        };
        nextCursor = encodeBrowseCursor(payload);
      } else {
        const payload: NewestCursorPayload = {
          v: 1,
          sort: 'newest',
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        };
        nextCursor = encodeBrowseCursor(payload);
      }
    }

    return { items, nextCursor, hasMore };
  }

  async browseFlatmates(viewer: UserDto, rawQuery: BrowseQueryDto): Promise<{
    items: BrowseProfileItemDto[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const role = prismaRoleFromViewer(viewer);
    this.assertRoleFlatmates(role);
    const query = BrowseQuerySchema.parse(rawQuery);
    await this.assertBrowseDailyLimit(viewer.id);

    const sortForDecode: BrowseSortMode = query.sort === 'soonest_move_in' ? 'newest' : query.sort;
    const cursorSort: BrowseSortMode = sortForDecode === 'best_match' ? 'best_match' : 'newest';
    const cursorPayload = decodeBrowseCursor(query.cursor, cursorSort);

    const filter = buildProfileBrowseWhere(viewer.id, query);
    const cursorWhere = buildProfileCursorWhere(cursorPayload);
    const where: Prisma.ProfileWhereInput = cursorWhere ? { AND: [filter, cursorWhere] } : filter;

    const rows = await this.prisma.profile.findMany({
      where,
      include: { user: true },
      orderBy: profileOrderBy(),
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const slice = hasMore ? rows.slice(0, query.limit) : rows;

    const items: BrowseProfileItemDto[] = slice.map((row) => {
      const dto = this.profiles.toPublicDto(row, row.user);
      const matchScore = scoreProfileForBrowse(row, query);
      return { ...dto, matchScore };
    });

    let nextCursor: string | null = null;
    if (hasMore && slice.length > 0) {
      const last = slice[slice.length - 1];
      const payload: NewestCursorPayload = {
        v: 1,
        sort: 'newest',
        createdAt: last.createdAt.toISOString(),
        id: last.id,
      };
      nextCursor = encodeBrowseCursor(payload);
    }

    return { items, nextCursor, hasMore };
  }
}
