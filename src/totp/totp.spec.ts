import { generateTotp } from './totp.js';
import { TotpService } from './totp.service.js';

describe('generateTotp', () => {
  // RFC 6238 Appendix B vectors (SHA1, 8 digits); secret is "12345678901234567890" in base32.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('t=%i -> %s', (t, expected) => {
    expect(generateTotp({ secret, digits: 8, period: 30, algorithm: 'SHA1' }, t * 1000).code).toBe(expected);
  });

  it('reports remaining seconds in the window', () => {
    expect(generateTotp({ secret, digits: 6, period: 30, algorithm: 'SHA1' }, 65_000).remainingSeconds).toBe(25);
  });
});

describe('TotpService.currentCode', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  afterEach(() => vi.useRealTimers());

  it('generates the code from the secret it is given', async () => {
    // t=65s: 25 seconds left in the window, so no wait.
    vi.useFakeTimers({ now: 65_000 });
    const expected = generateTotp({ secret, digits: 6, period: 30, algorithm: 'SHA1' }, 65_000).code;
    await expect(new TotpService().currentCode(secret)).resolves.toBe(expected);
  });
});
