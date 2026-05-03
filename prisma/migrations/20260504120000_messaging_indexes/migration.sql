-- Speed up conversation list by participant + recency
CREATE INDEX IF NOT EXISTS "conversations_participant_a_last_message_idx"
  ON "conversations" ("participantAUserId", "lastMessageAt" DESC NULLS LAST, "id" DESC);
CREATE INDEX IF NOT EXISTS "conversations_participant_b_last_message_idx"
  ON "conversations" ("participantBUserId", "lastMessageAt" DESC NULLS LAST, "id" DESC);
