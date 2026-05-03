import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CommuteQuerySchema = z.object({
  listingId: z.string().min(1),
});
export class CommuteQueryDto extends createZodDto(CommuteQuerySchema) {}

export const ValidatePlaceBodySchema = z.object({
  placeId: z.string().min(1),
});
export class ValidatePlaceBodyDto extends createZodDto(ValidatePlaceBodySchema) {}
