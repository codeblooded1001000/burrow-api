-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- AlterTable: add nullable columns first for safe backfill
ALTER TABLE "conversations" ADD COLUMN "status" "ConversationStatus",
ADD COLUMN "initiatedByUserId" TEXT,
ADD COLUMN "acceptedAt" TIMESTAMP(3),
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "rejectedByUserId" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "rejectReason" VARCHAR(200);

-- Backfill existing rows (pre-launch test data): treat as already-accepted chats
UPDATE "conversations"
SET
  "status" = 'ACTIVE',
  "initiatedByUserId" = "participantAUserId",
  "acceptedAt" = "createdAt"
WHERE "initiatedByUserId" IS NULL;

ALTER TABLE "conversations" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "conversations" ALTER COLUMN "initiatedByUserId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "conversations_status_createdAt_idx" ON "conversations"("status", "createdAt");
