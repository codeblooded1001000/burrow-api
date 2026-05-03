import { createZodDto } from 'nestjs-zod';
import { FoodPref, SmokingPref, WorkSchedule } from '@prisma/client';
import { z } from 'zod';
import { CURATED_PROFESSIONS, GURGAON_LOCALITIES } from '../../common/constants';

const localitySet = new Set<string>(GURGAON_LOCALITIES as readonly string[]);
const professionSet = new Set<string>(CURATED_PROFESSIONS as readonly string[]);

/** Express may send a single string or repeated keys as array. */
function toStringArray(val: unknown): string[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val.flatMap((v) => (typeof v === 'string' ? v.split(',') : [])).map((s) => s.trim()).filter(Boolean);
  if (typeof val === 'string') {
    if (val.includes(',')) return val.split(',').map((s) => s.trim()).filter(Boolean);
    return val.trim().length > 0 ? [val.trim()] : [];
  }
  return [];
}

function toNumberArray(val: unknown): number[] {
  const strs = toStringArray(val);
  const nums = strs.map((s) => Number.parseInt(s, 10)).filter((n) => Number.isFinite(n));
  return nums;
}

const genderQueryEnum = z.enum(['WOMAN', 'MAN', 'ANYONE']);
const smokingQueryEnum = z.nativeEnum(SmokingPref);
const foodQueryEnum = z.nativeEnum(FoodPref);
const workQueryEnum = z.nativeEnum(WorkSchedule);
const sortEnum = z.enum(['newest', 'soonest_move_in', 'best_match']);

export const BrowseQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    localities: z.preprocess(toStringArray, z.array(z.string()).max(40)).optional().default([]),
    budgetMin: z.coerce.number().int().optional(),
    budgetMax: z.coerce.number().int().optional(),
    gender: genderQueryEnum.optional(),
    moveInFrom: z.string().datetime().optional(),
    moveInTo: z.string().datetime().optional(),
    bhk: z.preprocess(toNumberArray, z.array(z.number().int().min(1).max(5))).optional().default([]),
    smokingPref: smokingQueryEnum.optional(),
    foodPref: foodQueryEnum.optional(),
    workSchedule: workQueryEnum.optional(),
    lifestyleTags: z.preprocess(toStringArray, z.array(z.string()).max(20)).optional().default([]),
    professions: z.preprocess(toStringArray, z.array(z.string()).max(30)).optional().default([]),
    sort: sortEnum.optional().default('newest'),
  })
  .superRefine((q, ctx) => {
    if (q.budgetMin !== undefined && q.budgetMax !== undefined && q.budgetMin > q.budgetMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'budgetMin must be less than or equal to budgetMax.',
        path: ['budgetMin'],
      });
    }
    if (q.moveInFrom && q.moveInTo && new Date(q.moveInFrom) > new Date(q.moveInTo)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'moveInFrom must be before or equal to moveInTo.',
        path: ['moveInFrom'],
      });
    }
    for (const loc of q.localities) {
      if (!localitySet.has(loc)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown locality: ${loc}`,
          path: ['localities'],
        });
      }
    }
    for (const p of q.professions) {
      if (!professionSet.has(p)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown profession: ${p}`,
          path: ['professions'],
        });
      }
    }
  });

export class BrowseQueryDto extends createZodDto(BrowseQuerySchema) {}

export type BrowseQueryValidated = z.infer<typeof BrowseQuerySchema>;
