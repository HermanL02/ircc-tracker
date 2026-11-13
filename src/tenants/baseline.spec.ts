import { describe, expect, it } from 'vitest';
import { resetsBaseline } from './baseline.js';

describe('resetsBaseline', () => {
  it('is false for recipient-only changes', () => {
    expect(resetsBaseline({ notifyTo: ['a@b.co'] })).toBe(false);
  });

  it('is false for name and enabled changes', () => {
    expect(resetsBaseline({ name: 'X', enabled: false })).toBe(false);
  });

  it('is true when the application number changes', () => {
    expect(resetsBaseline({ applicationNumber: 'E1' })).toBe(true);
  });

  it('is false for a password change', () => {
    expect(resetsBaseline({ gckeyPassword: 'p' })).toBe(false);
  });

  it('is true for every identity field', () => {
    for (const patch of [
      { gckeyUsername: 'u' },
      { uci: '12345678' },
      { surname: 'S' },
      { givenName: 'G' },
      { dateOfBirth: '1990-01-01' },
      { countryOfBirth: 'China' },
    ]) {
      expect(resetsBaseline(patch)).toBe(true);
    }
  });
});
