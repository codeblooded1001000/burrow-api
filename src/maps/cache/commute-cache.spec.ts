import { buildCommuteCacheKey } from './commute-cache';

describe('buildCommuteCacheKey', () => {
  it('is deterministic for the same coordinates', () => {
    const a = buildCommuteCacheKey(28.451234, 77.091234, 28.401234, 77.031234);
    const b = buildCommuteCacheKey(28.451234, 77.091234, 28.401234, 77.031234);
    expect(a).toBe(b);
    expect(a).toBe('commute:28.4512_77.0912:28.4012_77.0312');
  });

  it('rounds to four decimal places so nearby pins share a key', () => {
    const k1 = buildCommuteCacheKey(28.45123, 77.09123, 28.40123, 77.03123);
    const k2 = buildCommuteCacheKey(28.45124, 77.09124, 28.40124, 77.03124);
    expect(k1).toBe(k2);
  });
});
