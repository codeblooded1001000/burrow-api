/** Shared with burrow-web — keep in sync; note in SCHEMAS_CHANGELOG.md when changed. */

export const GURGAON_LOCALITIES = [
  'Cyber City',
  'Golf Course Road',
  'Sohna Road',
  'DLF Phase 1',
  'DLF Phase 2',
  'DLF Phase 3',
  'DLF Phase 4',
  'DLF Phase 5',
  'Sushant Lok 1',
  'Sushant Lok 2',
  'Sushant Lok 3',
  'Sector 14',
  'Sector 23',
  'Sector 28',
  'Sector 29',
  'Sector 31',
  'Sector 38',
  'Sector 39',
  'Sector 42',
  'Sector 43',
  'Sector 44',
  'Sector 45',
  'Sector 46',
  'Sector 47',
  'Sector 48',
  'Sector 49',
  'Sector 50',
  'Sector 54',
  'Sector 56',
  'Sector 57',
  'Sector 65',
  'Sector 66',
  'Sector 67',
  'Sector 70',
  'Sector 82',
  'Sector 83',
  'MG Road',
  'Udyog Vihar',
  'Galleria',
] as const;

export const LIFESTYLE_VIBES = [
  'Party-friendly',
  'Chill',
  'Social butterfly',
  'Homebody',
  'Bakchod',
  'Foodie',
] as const;

export const LIFESTYLE_SCHEDULE = ['Early bird', 'Night owl', 'Flexible'] as const;

export const LIFESTYLE_INTERESTS = [
  'Fitness-focused',
  'Gamer',
  'Bookworm',
  'Plant parent',
  'Pet person',
  'Cinephile',
] as const;

export const LIFESTYLE_PERSONALITY = [
  'Introvert',
  'Ambivert',
  'Extrovert',
  "I'll let you find out",
] as const;

export const MAX_LIFESTYLE_TAGS = 3;
export const MAX_PHOTOS_PER_LISTING = 6;
export const MAX_NEW_CONVERSATIONS_PER_DAY = 10;
export const MIN_AGE = 18;
export const MAX_AGE = 60;
export const MIN_RENT = 5000;
export const MAX_RENT = 100000;

/** Curated profession labels for profile + listing filters (keep in sync with burrow-web). */
export const CURATED_PROFESSIONS = [
  'Software engineer',
  'Product manager',
  'Designer',
  'Data scientist',
  'Consultant',
  'Investment banking',
  'Chartered accountant',
  'Lawyer',
  'Doctor',
  'Marketing',
  'Sales',
  'Operations',
  'HR',
  'Research',
  'Teacher',
  'Founder',
  'Other corporate',
] as const;

/** Listing amenity chips (subset; expand in SCHEMAS_CHANGELOG when changed). */
export const LISTING_AMENITIES = [
  'Wi-Fi',
  'Power backup',
  'Parking',
  'Gated society',
  'Lift',
  'Modular kitchen',
  'Gym',
  'Swimming pool',
  'Clubhouse',
  'Security',
  'Servant room',
  'Balcony',
  'Park view',
  'Pet-friendly',
] as const;
