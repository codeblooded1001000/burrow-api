import type { Gender } from '@prisma/client';

export interface ListingListerSnippetDto {
  id: string;
  fullName: string;
  age: number;
  gender: Gender;
  photoUrl: string | null;
  profession: string | null;
  companyName: string;
  companyVerified: boolean;
}

export interface ListingDto {
  id: string;
  userId: string;
  localityName: string;
  lat: number;
  lng: number;
  bhk: number;
  totalRent: number;
  yourShare: number;
  availableFrom: string;
  photos: string[];
  description: string;
  amenities: string[];
  preferredGender: 'WOMAN' | 'MAN' | 'ANYONE';
  preferredProfessions: string[];
  smokingAllowed: boolean;
  foodPref: 'PURE_VEG' | 'EGGETARIAN' | 'NON_VEG_OK' | null;
  workSchedulePref: 'HOME' | 'OFFICE' | 'FLEXIBLE' | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lister: ListingListerSnippetDto;
}
