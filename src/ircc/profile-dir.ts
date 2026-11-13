import { join } from 'node:path';

// The default tenant keeps the original profile dir so existing hCaptcha cookies survive;
// every other tenant gets its own Chrome profile.
export function profileDirFor(base: string, tenantId: string): string {
  return tenantId === 'default' ? base : join(base, 'tenants', tenantId);
}
