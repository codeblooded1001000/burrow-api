import { HttpException } from '@nestjs/common';
import { decodeBrowseCursor, encodeBrowseCursor, type NewestCursorPayload, type SoonestCursorPayload } from './cursor';

describe('browse cursor', () => {
  it('roundtrips newest cursor encoding/decoding with sort newest', () => {
    const payload: NewestCursorPayload = {
      v: 1,
      sort: 'newest',
      createdAt: '2026-05-01T12:00:00.000Z',
      id: 'clisting123',
    };
    const encoded = encodeBrowseCursor(payload);
    expect(decodeBrowseCursor(encoded, 'newest')).toEqual(payload);
    expect(decodeBrowseCursor(encoded, 'best_match')).toEqual(payload);
  });

  it('roundtrips soonest_move_in cursor', () => {
    const payload: SoonestCursorPayload = {
      v: 1,
      sort: 'soonest_move_in',
      availableFrom: '2026-06-15T00:00:00.000Z',
      id: 'clisting456',
    };
    const encoded = encodeBrowseCursor(payload);
    expect(decodeBrowseCursor(encoded, 'soonest_move_in')).toEqual(payload);
  });

  it('rejects newest cursor when sort is soonest_move_in', () => {
    const payload: NewestCursorPayload = {
      v: 1,
      sort: 'newest',
      createdAt: '2026-05-01T12:00:00.000Z',
      id: 'a',
    };
    const encoded = encodeBrowseCursor(payload);
    expect(() => decodeBrowseCursor(encoded, 'soonest_move_in')).toThrow(HttpException);
  });

  it('returns null for empty cursor', () => {
    expect(decodeBrowseCursor(undefined, 'newest')).toBeNull();
    expect(decodeBrowseCursor('', 'newest')).toBeNull();
  });
});
