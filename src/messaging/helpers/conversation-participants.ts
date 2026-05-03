import { orderedParticipantIds } from '../../common/types/conversation-order';

/**
 * Conversation rows require `participantAUserId < participantBUserId` (lexicographic).
 * @returns `[smallerId, largerId]` for storage and unique lookups.
 */
export function normalizeConversationParticipants(idA: string, idB: string): readonly [string, string] {
  const o = orderedParticipantIds(idA, idB);
  return [o.participantAUserId, o.participantBUserId] as const;
}

export { orderedParticipantIds } from '../../common/types/conversation-order';
