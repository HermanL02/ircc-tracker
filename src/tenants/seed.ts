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

// Which env variable each tenant field comes from, so a bad value is reported by its env name.
const ENV_FOR_FIELD = {
  gckeyUsername: 'GCKEY_USERNAME',
  gckeyPassword: 'GCKEY_PASSWORD',
  gckeyTotpSecret: 'GCKEY_TOTP_SECRET',
  surname: 'IRCC_SURNAME',
  givenName: 'IRCC_GIVEN_NAME',
  uci: 'IRCC_UCI',
  applicationNumber: 'IRCC_APPLICATION_NUMBER',
  dateOfBirth: 'IRCC_DATE_OF_BIRTH',
  countryOfBirth: 'IRCC_COUNTRY_OF_BIRTH',
  notifyTo: 'NOTIFY_EMAIL_TO',
} as const satisfies Partial<Record<keyof TenantCreate, (typeof SEED_ENV_KEYS)[number]>>;

// The `default` tenant built from a single-tenant .env, or null when GCKEY_USERNAME is empty.
// The env schema has already validated these values; parsing again applies the same
// normalisation (trimming) as a tenant created through the API. Throws an Error naming the
// env variables when a value passes the env schema but not the tenant rules (e.g. only spaces).
export function seedFromEnv(env: SeedEnv): TenantCreate | null {
  if (!env.GCKEY_USERNAME) return null;
  const fields = Object.fromEntries(Object.entries(ENV_FOR_FIELD).map(([field, key]) => [field, env[key]]));
  const result = seedSchema.safeParse({
    ...fields,
    id: SEED_TENANT_ID,
    name: 'Default',
    enabled: true,
    notifyTo: env.NOTIFY_EMAIL_TO.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const field = String(issue.path[0]);
    return `${ENV_FOR_FIELD[field as keyof typeof ENV_FOR_FIELD] ?? field}: ${issue.message}`;
  });
  throw new Error(`Cannot create tenant "${SEED_TENANT_ID}" from .env: ${problems.join('; ')}`);
}
