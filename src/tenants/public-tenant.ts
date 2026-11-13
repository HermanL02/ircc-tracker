import type { Tenant } from './entities/tenant.entity.js';

type Secrets = 'gckeyPassword' | 'gckeyTotpSecret';

// What the API returns for a tenant: never the credentials, only whether they are set.
export type PublicTenant = Omit<Tenant, Secrets> & { hasPassword: boolean; hasTotpSecret: boolean };

export function toPublicTenant(t: Omit<Tenant, Secrets> & Partial<Pick<Tenant, Secrets>>): PublicTenant {
  const { gckeyPassword, gckeyTotpSecret, ...rest } = t;
  return { ...rest, hasPassword: Boolean(gckeyPassword), hasTotpSecret: Boolean(gckeyTotpSecret) };
}
