import { failureRecipients, tenantSubject } from './recipients.js';

describe('failureRecipients', () => {
  it('unions tenant and admin recipients, tenant first, de-duplicated case-insensitively', () => {
    expect(failureRecipients(['A@x.co', 'b@x.co'], ['a@x.co', 'me@x.co'])).toEqual(['A@x.co', 'b@x.co', 'me@x.co']);
  });

  it('returns the admin recipients when the tenant has none', () => {
    expect(failureRecipients([], ['me@x.co'])).toEqual(['me@x.co']);
  });

  it('returns an empty list when both are empty', () => {
    expect(failureRecipients([], [])).toEqual([]);
  });
});

describe('tenantSubject', () => {
  it('prefixes the subject with the tenant name in brackets', () => {
    expect(tenantSubject('Mom', 'IRCC update: x')).toBe('[Mom] IRCC update: x');
  });
});
