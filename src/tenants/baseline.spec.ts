import { describe, expect, it } from 'vitest';
import { resetsBaseline, type BaselineIdentity } from './baseline.js';

const stored: BaselineIdentity = {
  gckeyUsername: 'user',
  uci: '1234567890',
  applicationNumber: 'E000000001',
  surname: 'Doe',
  givenName: 'Jane',
  dateOfBirth: '1990-01-01',
  countryOfBirth: 'China',
};

describe('resetsBaseline', () => {
  it('is false for recipient-only changes', () => {
    expect(resetsBaseline(stored, { notifyTo: ['a@b.co'] })).toBe(false);
  });

  it('is false for name and enabled changes', () => {
    expect(resetsBaseline(stored, { name: 'X', enabled: false })).toBe(false);
  });

  it('is true when the application number changes', () => {
    expect(resetsBaseline(stored, { applicationNumber: 'E1' })).toBe(true);
  });

  it('is false for a password change', () => {
    expect(resetsBaseline(stored, { gckeyPassword: 'p' })).toBe(false);
  });

  it('is true for every identity field', () => {
    for (const patch of [
      { gckeyUsername: 'u' },
      { uci: '12345678' },
      { surname: 'S' },
      { givenName: 'G' },
      { dateOfBirth: '1991-01-01' },
      { countryOfBirth: 'India' },
    ]) {
      expect(resetsBaseline(stored, patch)).toBe(true);
    }
  });

  it('is false when the patch repeats the stored identity values', () => {
    expect(resetsBaseline(stored, { ...stored, name: 'Renamed', notifyTo: ['a@b.co'] })).toBe(false);
  });

  it('compares the date of birth as YYYY-MM-DD', () => {
    const withTimestamp = { ...stored, dateOfBirth: '1990-01-01T00:00:00.000Z' };
    expect(resetsBaseline(withTimestamp, { dateOfBirth: '1990-01-01' })).toBe(false);
    expect(resetsBaseline(withTimestamp, { dateOfBirth: '1990-01-02' })).toBe(true);
  });

  it('is true when one of several repeated fields differs', () => {
    expect(resetsBaseline(stored, { ...stored, uci: '12345678' })).toBe(true);
  });
});
