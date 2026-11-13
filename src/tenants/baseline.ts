import type { Tenant } from './entities/tenant.entity.js';
import type { TenantUpdate } from './tenant.schema.js';

// Fields that identify whose application is being watched. Changing any of them means
// old snapshots belong to someone else, so change detection must start from a new baseline.
const BASELINE_FIELDS = [
  'gckeyUsername',
  'uci',
  'applicationNumber',
  'surname',
  'givenName',
  'dateOfBirth',
  'countryOfBirth',
] as const satisfies readonly (keyof TenantUpdate & keyof Tenant)[];

export type BaselineIdentity = Pick<Tenant, (typeof BASELINE_FIELDS)[number]>;

// Dates are compared as YYYY-MM-DD, whatever form the stored value comes back in.
const comparable = (field: (typeof BASELINE_FIELDS)[number], value: string): string =>
  field === 'dateOfBirth' ? String(value).slice(0, 10) : value;

// True only when the patch actually changes an identity field: re-sending the stored values
// (e.g. a client PATCHing the full record) keeps the baseline, so no real change is swallowed.
export function resetsBaseline(stored: BaselineIdentity, patch: TenantUpdate): boolean {
  return BASELINE_FIELDS.some((field) => {
    const next = patch[field];
    return next !== undefined && comparable(field, next) !== comparable(field, stored[field]);
  });
}
