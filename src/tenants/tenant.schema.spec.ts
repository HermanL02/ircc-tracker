import { describe, expect, it } from 'vitest';
import { envSchema } from '../config/env.validation.js';
import { tenantCreateSchema, tenantUpdateSchema } from './tenant.schema.js';

const validTenant = {
  id: 'mom',
  name: 'Mom',
  gckeyUsername: 'mom-gckey',
  gckeyPassword: 'secret-password',
  gckeyTotpSecret: 'JBSWY3DPEHPK3PXP',
  surname: 'Doe',
  givenName: 'Jane',
  uci: '12345678',
  applicationNumber: 'E000000000',
  dateOfBirth: '1960-01-31',
  countryOfBirth: 'China',
  notifyTo: ['mom@example.com'],
};

describe('tenantCreateSchema', () => {
  it('parses a valid body and defaults enabled to true', () => {
    const parsed = tenantCreateSchema.parse(validTenant);
    expect(parsed).toEqual({ ...validTenant, enabled: true });
  });

  it('normalises an otpauth:// link to the base32 secret', () => {
    const parsed = tenantCreateSchema.parse({
      ...validTenant,
      gckeyTotpSecret: 'otpauth://totp/x?secret=jbsw y3dp ehpk 3pxp',
    });
    expect(parsed.gckeyTotpSecret).toBe('JBSWY3DPEHPK3PXP');
  });

  it.each([
    ['uppercase id', { id: 'Mom' }],
    ['id over 64 chars', { id: 'a'.repeat(65) }],
    ['non-digit uci', { uci: '12-34' }],
    ['slash date of birth', { dateOfBirth: '1990/01/01' }],
    ['empty notifyTo', { notifyTo: [] }],
    ['non-email notifyTo', { notifyTo: ['x'] }],
    ['bad totp secret', { gckeyTotpSecret: 'not-base32!' }],
    ['malformed otpauth link', { gckeyTotpSecret: 'otpauth://%' }],
  ])('rejects %s', (_label, override) => {
    expect(tenantCreateSchema.safeParse({ ...validTenant, ...override }).success).toBe(false);
  });

  it('accepts a lowercase id with digits and hyphens', () => {
    expect(tenantCreateSchema.safeParse({ ...validTenant, id: 'mom-2' }).success).toBe(true);
  });
});

describe('tenantUpdateSchema', () => {
  it('rejects id because ids are immutable', () => {
    expect(() => tenantUpdateSchema.parse({ id: 'x' })).toThrow();
  });

  it('accepts a partial update', () => {
    expect(tenantUpdateSchema.parse({ notifyTo: ['a@b.co'] })).toEqual({ notifyTo: ['a@b.co'] });
  });

  it('does not inject the enabled default into a partial update', () => {
    expect(tenantUpdateSchema.parse({})).toEqual({});
  });
});

describe('envSchema credentials', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    API_KEYS: 'a-key-that-is-long-enough',
  };
  const fullCredentials = {
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

  it('parses without any GCKEY_* or IRCC_* variables', () => {
    const env = envSchema.parse(base);
    expect(env.GCKEY_USERNAME).toBe('');
    expect(env.GCKEY_TOTP_SECRET).toBe('');
    expect(env.IRCC_UCI).toBe('');
    expect(env.CHECK_TENANT_GAP_SECONDS).toBe(300);
  });

  it('parses a full single-tenant config and normalises the TOTP secret', () => {
    const env = envSchema.parse({ ...base, ...fullCredentials });
    expect(env.GCKEY_TOTP_SECRET).toBe('JBSWY3DPEHPK3PXP');
    expect(env.IRCC_UCI).toBe('12345678');
  });

  it('requires IRCC_UCI when GCKEY_USERNAME is set', () => {
    const { IRCC_UCI: _omit, ...partial } = fullCredentials;
    const result = envSchema.safeParse({ ...base, ...partial });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toEqual([['IRCC_UCI']]);
  });

  it('keeps the existing format rules when GCKEY_USERNAME is set', () => {
    const result = envSchema.safeParse({
      ...base,
      ...fullCredentials,
      GCKEY_TOTP_SECRET: 'bad!',
      IRCC_DATE_OF_BIRTH: '1960/01/31',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual(['GCKEY_TOTP_SECRET', 'IRCC_DATE_OF_BIRTH']);
  });

  it('rejects a negative CHECK_TENANT_GAP_SECONDS', () => {
    expect(envSchema.safeParse({ ...base, CHECK_TENANT_GAP_SECONDS: '-1' }).success).toBe(false);
  });
});
