import { adminPasswordMatches } from './admin-password';

describe('adminPasswordMatches', () => {
  it('returns false when env password is empty', () => {
    expect(adminPasswordMatches('anything', '')).toBe(false);
  });

  it('matches only the same password', () => {
    const env = 'sixteen-chars-min!';
    expect(adminPasswordMatches('sixteen-chars-min!', env)).toBe(true);
    expect(adminPasswordMatches('sixteen-chars-min?', env)).toBe(false);
  });
});
