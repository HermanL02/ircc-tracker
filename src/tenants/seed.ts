import type { Env } from '../config/env.validation.js';
import { z } from 'zod';
import { tenantCreateSchema, type TenantCreate } from './tenant.schema.js';

export const SEED_TENANT_ID = 'default';

export const SEED_ENV_KEYS = [
  'GCKEY_USERNAME',
  'GCKEY_PASSWORD',
  'GCKEY_TOTP_SECRET',
  'IRCC_SURNAME',
  'IRCC_GIVEN_NAME',
  'IRCC_UCI',
  'IRCC_APPLICATION_NUMBER',
  'IRCC_DATE_OF_BIRTH',
  'IRCC_COUNTRY_OF_BIRTH',
  'NOTIFY_EMAIL_TO',
] as const satisfies readonly (keyof Env)[];

export type SeedEnv = Pick<Env, (typeof SEED_ENV_KEYS)[number]>;

// The API's tenant rules, except that the seed allows no recipients: with NOTIFY_EMAIL_TO
// empty the tenant simply gets no emails.
const seedSchema = tenantCreateSchema.extend({ notifyTo: z.array(z.string()) });

// The `default` tenant built from a single-tenant .env, or null when GCKEY_USERNAME is empty.
// The env schema has already validated these values; parsing again applies the same
// normalisation (trimming) as a tenant created through the API.
export function seedFromEnv(env: SeedEnv): TenantCreate | null {
  if (!env.GCKEY_USERNAME) return null;
  return seedSchema.parse({
    id: SEED_TENANT_ID,
    name: 'Default',
    enabled: true,
    gckeyUsername: env.GCKEY_USERNAME,
    gckeyPassword: env.GCKEY_PASSWORD,
    gckeyTotpSecret: env.GCKEY_TOTP_SECRET,
    surname: env.IRCC_SURNAME,
    givenName: env.IRCC_GIVEN_NAME,
    uci: env.IRCC_UCI,
    applicationNumber: env.IRCC_APPLICATION_NUMBER,
    dateOfBirth: env.IRCC_DATE_OF_BIRTH,
    countryOfBirth: env.IRCC_COUNTRY_OF_BIRTH,
    notifyTo: env.NOTIFY_EMAIL_TO.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
}
