import { normalizeReportConversationId } from './normalize-report-conversation-id';

describe('normalizeReportConversationId', () => {
  it('maps undefined and blank to null', () => {
    expect(normalizeReportConversationId(undefined)).toBeNull();
    expect(normalizeReportConversationId('')).toBeNull();
    expect(normalizeReportConversationId('  ')).toBeNull();
  });

  it('trims and preserves non-empty ids', () => {
    expect(normalizeReportConversationId('  cmabc  ')).toBe('cmabc');
  });
});
