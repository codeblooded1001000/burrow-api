import { createZodDto } from 'nestjs-zod';
import { FoodPref, Gender, SmokingPref, WorkSchedule } from '@prisma/client';
import { z } from 'zod';
import {
  GURGAON_LOCALITIES,
  LIFESTYLE_INTERESTS,
  LIFESTYLE_PERSONALITY,
  LIFESTYLE_SCHEDULE,
  LIFESTYLE_VIBES,
  MAX_LIFESTYLE_TAGS,
} from '../../common/constants';

const localitySet = new Set<string>(GURGAON_LOCALITIES as readonly string[]);

const lifestyleTagSet = new Set<string>([
  ...LIFESTYLE_VIBES,
  ...LIFESTYLE_SCHEDULE,
  ...LIFESTYLE_INTERESTS,
  ...LIFESTYLE_PERSONALITY,
]);

const lifestyleTagField = z.string().refine((t) => lifestyleTagSet.has(t), {
  message: 'Invalid lifestyle tag',
});

const preferredLocalitiesField = z
  .array(z.string())
  .max(40)
  .refine((arr) => arr.every((x) => localitySet.has(x)), {
    message: 'Each locality must be a known Gurgaon locality',
  });

const photoUrlField = z
  .union([z.string().min(1).max(2048), z.null()])
  .optional()
  .describe('R2 object key (profiles/{userId}/…) or legacy HTTPS URL under public CDN when set');

const officePairRefine = (data: { officeLat?: number | null; officeLng?: number | null }, ctx: z.RefinementCtx): void => {
  const lat = data.officeLat;
  const lng = data.officeLng;
  const hasLat = lat !== undefined && lat !== null;
  const hasLng = lng !== undefined && lng !== null;
  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Office latitude and longitude must both be set or both omitted.',
      path: ['officeLat'],
    });
  }
};

const budgetRefine = (data: { budgetMin?: number | null; budgetMax?: number | null }, ctx: z.RefinementCtx): void => {
  const { budgetMin, budgetMax } = data;
  if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'budgetMin must be less than or equal to budgetMax.',
      path: ['budgetMin'],
    });
  }
};

const ProfileObjectSchema = z.object({
  fullName: z.string().min(1).max(120),
  age: z.number().int().min(18).max(60),
  gender: z.nativeEnum(Gender),
  photoUrl: photoUrlField,
  bio: z.string().max(500),
  profession: z.string().max(120).nullable().optional(),
  workSchedule: z.nativeEnum(WorkSchedule).nullable().optional(),
  budgetMin: z.number().int().nullable().optional(),
  budgetMax: z.number().int().nullable().optional(),
  moveInDate: z.string().datetime().nullable().optional(),
  preferredLocalities: preferredLocalitiesField,
  lifestyleTags: z.array(lifestyleTagField).max(MAX_LIFESTYLE_TAGS),
  smokingPref: z.nativeEnum(SmokingPref).nullable().optional(),
  foodPref: z.nativeEnum(FoodPref).nullable().optional(),
  officeLat: z.number().nullable().optional(),
  officeLng: z.number().nullable().optional(),
});

export const ProfilePutSchema = ProfileObjectSchema.superRefine(officePairRefine).superRefine(budgetRefine);

export class ProfilePutBodyDto extends createZodDto(ProfilePutSchema) {}

export const ProfilePatchSchema = ProfileObjectSchema.partial().superRefine((data, ctx) => {
    const keys = new Set(Object.keys(data));
    if (keys.has('officeLat') !== keys.has('officeLng')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'When updating office coordinates, send both latitude and longitude.',
        path: ['officeLat'],
      });
    }
    budgetRefine(
      {
        budgetMin: data.budgetMin,
        budgetMax: data.budgetMax,
      },
      ctx,
    );
  });

export class ProfilePatchBodyDto extends createZodDto(ProfilePatchSchema) {}

export type ProfilePutBody = z.infer<typeof ProfilePutSchema>;
export type ProfilePatchBody = z.infer<typeof ProfilePatchSchema>;
