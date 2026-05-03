import { createZodDto } from 'nestjs-zod';
import { FoodPref, Gender, WorkSchedule } from '@prisma/client';
import { z } from 'zod';
import {
  CURATED_PROFESSIONS,
  GURGAON_LOCALITIES,
  LISTING_AMENITIES,
  MAX_PHOTOS_PER_LISTING,
  MAX_RENT,
  MIN_RENT,
} from '../../common/constants';

const localitySet = new Set<string>(GURGAON_LOCALITIES as readonly string[]);
const amenitySet = new Set<string>(LISTING_AMENITIES as readonly string[]);
const professionSet = new Set<string>(CURATED_PROFESSIONS as readonly string[]);

const preferredGenderField = z.enum(['WOMAN', 'MAN', 'ANYONE']);

const availableFromSchema = z.string().refine(
  (s) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return false;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return d >= start;
  },
  { message: 'Available-from must be today or a future date (UTC midnight comparison).' },
);

const photosSchema = z
  .array(z.string().min(1).max(2048))
  .max(MAX_PHOTOS_PER_LISTING);

const amenitiesSchema = z
  .array(z.string())
  .refine((arr) => arr.every((a) => amenitySet.has(a)), {
    message: 'Each amenity must be from the known amenities list',
  });

const professionsSchema = z
  .array(z.string())
  .max(20)
  .refine((arr) => arr.every((p) => professionSet.has(p)), {
    message: 'Each profession must be from the curated professions list',
  });

const listingCore = {
  localityName: z.string().refine((v) => localitySet.has(v), {
    message: 'Unknown locality',
  }),
  lat: z.number().finite(),
  lng: z.number().finite(),
  bhk: z.number().int().min(1).max(5),
  totalRent: z.number().int().min(MIN_RENT).max(MAX_RENT),
  yourShare: z.number().int().min(MIN_RENT).max(MAX_RENT),
  availableFrom: availableFromSchema,
  photos: photosSchema,
  description: z.string().min(1).max(1000),
  amenities: amenitiesSchema,
  preferredGender: preferredGenderField,
  preferredProfessions: professionsSchema,
  smokingAllowed: z.boolean(),
  foodPref: z.nativeEnum(FoodPref).nullable().optional(),
  workSchedulePref: z.nativeEnum(WorkSchedule).nullable().optional(),
};

export const ListingPutSchema = z.object(listingCore);

export class ListingPutBodyDto extends createZodDto(ListingPutSchema) {}

export const ListingPatchSchema = ListingPutSchema.partial();

export class ListingPatchBodyDto extends createZodDto(ListingPatchSchema) {}

export type ListingPutBody = z.infer<typeof ListingPutSchema>;
export type ListingPatchBody = z.infer<typeof ListingPatchSchema>;

export function toPrismaListingPreferredGender(v: z.infer<typeof preferredGenderField>): Gender {
  if (v === 'ANYONE') return Gender.PREFER_NOT;
  return v;
}

export function fromPrismaListingPreferredGender(g: Gender): 'WOMAN' | 'MAN' | 'ANYONE' {
  if (g === Gender.PREFER_NOT) return 'ANYONE';
  return g;
}
