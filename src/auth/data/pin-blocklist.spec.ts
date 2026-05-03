import { isWeakPin } from './pin-blocklist';

describe('pin-blocklist', () => {
  it('rejects obvious weak PINs', () => {
    expect(isWeakPin('123456')).toBe(true);
    expect(isWeakPin('000000')).toBe(true);
    expect(isWeakPin('111111')).toBe(true);
    expect(isWeakPin('654321')).toBe(true);
    expect(isWeakPin('121212')).toBe(true);
    expect(isWeakPin('123123')).toBe(true);
  });

  it('accepts a non-listed 6-digit PIN', () => {
    expect(isWeakPin('482917')).toBe(false);
  });

  it('rejects non-6-digit', () => {
    expect(isWeakPin('12345')).toBe(true);
    expect(isWeakPin('abcdef')).toBe(true);
  });
});
