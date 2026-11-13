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
] as const satisfies readonly (keyof TenantUpdate)[];

export function resetsBaseline(patch: TenantUpdate): boolean {
  return BASELINE_FIELDS.some((field) => patch[field] !== undefined);
}
