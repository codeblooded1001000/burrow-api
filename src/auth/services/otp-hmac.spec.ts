import { createHmac } from 'node:crypto';

describe('OTP HMAC', () => {
  it('is deterministic for the same secret and OTP', () => {
    const secret = 'test-secret';
    const otp = '384920';
    const a = createHmac('sha256', secret).update(otp).digest('hex');
    const b = createHmac('sha256', secret).update(otp).digest('hex');
    expect(a).toBe(b);
    expect(a).not.toBe(otp);
  });

  it('differs for different OTPs', () => {
    const secret = 'test-secret';
    const a = createHmac('sha256', secret).update('111111').digest('hex');
    const b = createHmac('sha256', secret).update('222222').digest('hex');
    expect(a).not.toBe(b);
  });
});
