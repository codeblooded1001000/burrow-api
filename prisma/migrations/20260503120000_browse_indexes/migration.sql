-- Browse: sort and filter performance
CREATE INDEX IF NOT EXISTS "listings_availableFrom_isActive_idx" ON "listings" ("availableFrom", "isActive");
CREATE INDEX IF NOT EXISTS "listings_createdAt_isActive_idx" ON "listings" ("createdAt", "isActive");
CREATE INDEX IF NOT EXISTS "profiles_createdAt_idx" ON "profiles" ("createdAt");
