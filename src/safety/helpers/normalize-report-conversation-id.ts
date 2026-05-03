/** Normalize optional conversation id for report dedupe queries (null = no conversation). */
export function normalizeReportConversationId(conversationId: string | undefined): string | null {
  if (conversationId === undefined) return null;
  const t = conversationId.trim();
  return t.length === 0 ? null : t;
}
