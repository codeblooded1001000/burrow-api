import { FoodPref, Gender, Role, SmokingPref } from '@prisma/client';
import { BrowseQuerySchema } from '../schemas/browse.schemas';
import {
  buildBrowseUserWhere,
  buildListingBrowseWhere,
  buildListingCursorWhere,
  buildProfileBrowseWhere,
} from './filter-builder';
import type { NewestCursorPayload } from './cursor';

function baseQuery(over: Record<string, unknown> = {}) {
  return BrowseQuerySchema.parse({ ...over });
}

describe('browse filter-builder', () => {
  it('buildBrowseUserWhere excludes viewer, requires verified, and encodes block graph', () => {
    const w = buildBrowseUserWhere('viewer-1');
    expect(w).toMatchObject({
      deletedAt: null,
      companyVerified: true,
      id: { not: 'viewer-1' },
    });
    expect(w.NOT).toBeDefined();
  });

  it('buildListingBrowseWhere applies locality and budget on yourShare', () => {
    const q = baseQuery({
      localities: ['Cyber City'],
      budgetMin: 15000,
      budgetMax: 25000,
    });
    const w = buildListingBrowseWhere('u1', q);
    expect(w.isActive).toBe(true);
    expect(w.AND).toEqual(
      expect.arrayContaining([
        { localityName: { in: ['Cyber City'] } },
        { yourShare: { gte: 15000, lte: 25000 } },
      ]),
    );
  });

  it('buildListingBrowseWhere gender WOMAN matches preferredGender WOMAN or PREFER_NOT', () => {
    const q = baseQuery({ gender: 'WOMAN' });
    const w = buildListingBrowseWhere('u1', q);
    expect(w.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [{ preferredGender: Gender.WOMAN }, { preferredGender: Gender.PREFER_NOT }],
        },
      ]),
    );
  });

  it('buildListingBrowseWhere smoking NON_SMOKER requires smokingAllowed false', () => {
    const q = baseQuery({ smokingPref: SmokingPref.NON_SMOKER });
    const w = buildListingBrowseWhere('u1', q);
    expect(w.AND).toEqual(expect.arrayContaining([{ smokingAllowed: false }]));
  });

  it('merges listing cursor with AND', () => {
    const q = baseQuery();
    const filter = buildListingBrowseWhere('u1', q);
    const cursor: NewestCursorPayload = {
      v: 1,
      sort: 'newest',
      createdAt: '2026-01-01T00:00:00.000Z',
      id: 'lid',
    };
    const c = buildListingCursorWhere(cursor);
    if (!c) throw new Error('expected cursor');
    const merged = { AND: [filter, c] as const };
    expect(Array.isArray(merged.AND[1].OR)).toBe(true);
  });

  it('buildProfileBrowseWhere applies profession filter and completion floor', () => {
    const q = baseQuery({ professions: ['Software engineer'] });
    const w = buildProfileBrowseWhere('u1', q);
    expect(w.profileCompletion).toEqual({ gte: 70 });
    expect(w.AND).toEqual(expect.arrayContaining([{ profession: { in: ['Software engineer'] } }]));
  });

  it('buildProfileBrowseWhere budget overlap uses AND range', () => {
    const q = baseQuery({ budgetMin: 10000, budgetMax: 20000 });
    const w = buildProfileBrowseWhere('u1', q);
    expect(w.AND).toEqual(
      expect.arrayContaining([
        {
          budgetMin: { not: null },
          budgetMax: { not: null },
          AND: [{ budgetMin: { lte: 20000 } }, { budgetMax: { gte: 10000 } }],
        },
      ]),
    );
  });

  it('buildProfileBrowseWhere user role clause includes lister escape hatch', () => {
    const q = baseQuery();
    const w = buildProfileBrowseWhere('u1', q);
    const userAnd = w.user as { AND: unknown[] };
    expect(userAnd.AND).toHaveLength(2);
    const roleClause = userAnd.AND[1] as { role: unknown; OR: unknown[] };
    expect(roleClause.role).toEqual({ in: [Role.LISTER, Role.SEEKER, Role.BOTH] });
  });

  it('buildListingBrowseWhere food NON_VEG_OK excludes strict pure veg listings', () => {
    const q = baseQuery({ foodPref: FoodPref.NON_VEG_OK });
    const w = buildListingBrowseWhere('u1', q);
    expect(w.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [{ foodPref: null }, { foodPref: { in: [FoodPref.EGGETARIAN, FoodPref.NON_VEG_OK] } }],
        },
      ]),
    );
  });
});
