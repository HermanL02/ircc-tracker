import { describe, expect, it } from 'vitest';
import type { Tenant } from './entities/tenant.entity.js';
import { toPublicTenant } from './public-tenant.js';

const tenant: Tenant = {
  id: 'mom',
  name: 'Mom',
  enabled: true,
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
  baselineAfter: null,
  createdAt: new Date('2026-11-13T00:00:00Z'),
  updatedAt: new Date('2026-11-13T00:00:00Z'),
};

describe('toPublicTenant', () => {
  it('drops both secrets and reports that they are set', () => {
    const pub = toPublicTenant(tenant);
    expect(pub).not.toHaveProperty('gckeyPassword');
    expect(pub).not.toHaveProperty('gckeyTotpSecret');
    expect(pub.hasPassword).toBe(true);
    expect(pub.hasTotpSecret).toBe(true);
    expect(pub.gckeyUsername).toBe('mom-gckey');
    expect(pub.notifyTo).toEqual(['mom@example.com']);
  });

  it('reports missing secrets as false', () => {
    const { gckeyPassword: _p, gckeyTotpSecret: _s, ...withoutSecrets } = tenant;
    const pub = toPublicTenant(withoutSecrets);
    expect(pub.hasPassword).toBe(false);
    expect(pub.hasTotpSecret).toBe(false);
  });
});
