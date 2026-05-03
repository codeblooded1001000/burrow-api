-- Profile: optional fields for progressive onboarding / API nulls
ALTER TABLE "profiles" ALTER COLUMN "profession" DROP NOT NULL;
ALTER TABLE "profiles" ALTER COLUMN "workSchedule" DROP NOT NULL;
ALTER TABLE "profiles" ALTER COLUMN "budgetMin" DROP NOT NULL;
ALTER TABLE "profiles" ALTER COLUMN "budgetMax" DROP NOT NULL;
ALTER TABLE "profiles" ALTER COLUMN "moveInDate" DROP NOT NULL;
ALTER TABLE "profiles" ALTER COLUMN "smokingPref" DROP NOT NULL;
ALTER TABLE "profiles" ALTER COLUMN "foodPref" DROP NOT NULL;

-- Listing: optional prefs on listing card
ALTER TABLE "listings" ALTER COLUMN "foodPref" DROP NOT NULL;
ALTER TABLE "listings" ALTER COLUMN "workSchedulePref" DROP NOT NULL;
