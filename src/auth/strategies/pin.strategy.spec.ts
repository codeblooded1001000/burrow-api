import { Test, type TestingModule } from '@nestjs/testing';
import { PinStrategy } from './pin.strategy';

describe('PinStrategy', () => {
  let strategy: PinStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PinStrategy],
    }).compile();
    strategy = module.get(PinStrategy);
  });

  it('produces different hashes for the same PIN (salt)', async () => {
    const pin = '482917';
    const a = await strategy.hash(pin);
    const b = await strategy.hash(pin);
    expect(a).not.toBe(b);
    expect(a.startsWith('$argon2id$')).toBe(true);
    expect(b.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies correct PIN', async () => {
    const pin = '582039';
    const hash = await strategy.hash(pin);
    await expect(strategy.verify(hash, pin)).resolves.toBe(true);
    await expect(strategy.verify(hash, '000000')).resolves.toBe(false);
  });
});
