import { normalizeConversationParticipants } from './conversation-participants';

describe('normalizeConversationParticipants', () => {
  it('orders lexicographically (smaller first)', () => {
    const a = 'clowerxxxxxxxxxxxxxxxx';
    const b = 'cupperzzzzzzzzzzzzzzzz';
    expect(normalizeConversationParticipants(b, a)).toEqual([a, b]);
    expect(normalizeConversationParticipants(a, b)).toEqual([a, b]);
  });

  it('throws when both ids are equal', () => {
    expect(() => normalizeConversationParticipants('same', 'same')).toThrow();
  });
});
