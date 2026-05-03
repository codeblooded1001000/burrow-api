import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import {
  CURATED_PROFESSIONS,
  GURGAON_LOCALITIES,
  LISTING_AMENITIES,
  LIFESTYLE_INTERESTS,
  LIFESTYLE_PERSONALITY,
  LIFESTYLE_SCHEDULE,
  LIFESTYLE_VIBES,
} from '../common/constants';

@Controller('constants')
@Public()
export class ConstantsController {
  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  getConstants(): {
    localities: readonly string[];
    vibes: readonly string[];
    schedule: readonly string[];
    interests: readonly string[];
    personality: readonly string[];
    professions: readonly string[];
    amenities: readonly string[];
  } {
    return {
      localities: GURGAON_LOCALITIES,
      vibes: LIFESTYLE_VIBES,
      schedule: LIFESTYLE_SCHEDULE,
      interests: LIFESTYLE_INTERESTS,
      personality: LIFESTYLE_PERSONALITY,
      professions: CURATED_PROFESSIONS,
      amenities: LISTING_AMENITIES,
    };
  }
}
