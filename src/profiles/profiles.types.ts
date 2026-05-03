import type { Gender } from '@prisma/client';

export interface ProfileUserSnippetDto {
  id: string;
  companyName: string;
  companyVerified: boolean;
}

export interface ProfilePublicDto {
  id: string;
  userId: string;
  fullName: string;
  age: number;
  gender: Gender;
  photoUrl: string | null;
  bio: string;
  profession: string | null;
  workSchedule: 'HOME' | 'OFFICE' | 'FLEXIBLE' | null;
  budgetMin: number | null;
  budgetMax: number | null;
  moveInDate: string | null;
  preferredLocalities: string[];
  lifestyleTags: string[];
  smokingPref: 'NON_SMOKER' | 'SMOKER' | 'FLEXIBLE' | null;
  foodPref: 'PURE_VEG' | 'EGGETARIAN' | 'NON_VEG_OK' | null;
  user: ProfileUserSnippetDto;
}

export interface ProfileOwnDto extends ProfilePublicDto {
  officeLat: number | null;
  officeLng: number | null;
}
