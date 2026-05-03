/**
 * Conversation rows use participantAUserId < participantBUserId (lexicographic string order).
 * CUIDs are sortable as strings for this invariant — always normalize with this helper before insert.
 */
export function orderedParticipantIds(
  userIdA: string,
  userIdB: string,
): { participantAUserId: string; participantBUserId: string } {
  if (userIdA === userIdB) {
    throw new Error('Cannot create a conversation with the same user twice');
  }
  return userIdA < userIdB
    ? { participantAUserId: userIdA, participantBUserId: userIdB }
    : { participantAUserId: userIdB, participantBUserId: userIdA };
}
