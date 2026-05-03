import { type PipeTransform } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

/** Global validation pipe factory — use in `main.ts`. */
export function createGlobalZodPipe(): PipeTransform {
  return new ZodValidationPipe();
}
