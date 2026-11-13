import { describe, expect, it } from 'vitest';
import { envSchema } from '../config/env.validation.js';
import { seedFromEnv } from './seed.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  API_KEYS: 'a-key-that-is-long-enough',
};
const credentials = {
  GCKEY_USERNAME: 'user',
  GCKEY_PASSWORD: 'pass',
  GCKEY_TOTP_SECRET: 'otpauth://totp/x?secret=jbsw y3dp ehpk 3pxp',
  IRCC_SURNAME: 'Doe',
  IRCC_GIVEN_NAME: 'Jane',
  IRCC_UCI: '12345678',
  IRCC_APPLICATION_NUMBER: 'E000000000',
  IRCC_DATE_OF_BIRTH: '1960-01-31',
  IRCC_COUNTRY_OF_BIRTH: 'China',
};

describe('seedFromEnv', () => {
  it('returns null when GCKEY_USERNAME is empty', () => {
    expect(seedFromEnv(envSchema.parse(base))).toBeNull();
  });

  it('builds the default tenant from a full single-tenant env', () => {
    const env = envSchema.parse({ ...base, ...credentials, NOTIFY_EMAIL_TO: 'a@x.co, b@x.co' });
    expect(seedFromEnv(env)).toEqual({
      id: 'default',
      name: 'Default',
      enabled: true,
      gckeyUsername: 'user',
      gckeyPassword: 'pass',
      gckeyTotpSecret: 'JBSWY3DPEHPK3PXP',
      surname: 'Doe',
      givenName: 'Jane',
      uci: '12345678',
      applicationNumber: 'E000000000',
      dateOfBirth: '1960-01-31',
      countryOfBirth: 'China',
      notifyTo: ['a@x.co', 'b@x.co'],
    });
  });

  it('trims free-text fields the same way as the API', () => {
    const env = envSchema.parse({ ...base, ...credentials, GCKEY_USERNAME: ' user ', IRCC_SURNAME: ' Doe ' });
    const seed = seedFromEnv(env);
    expect(seed?.gckeyUsername).toBe('user');
    expect(seed?.surname).toBe('Doe');
  });

  it('seeds with no recipients when NOTIFY_EMAIL_TO is empty', () => {
    expect(seedFromEnv(envSchema.parse({ ...base, ...credentials }))?.notifyTo).toEqual([]);
  });
});
