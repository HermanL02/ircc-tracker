import { profileDirFor } from './profile-dir.js';

describe('profileDirFor', () => {
  it('keeps the base dir for the default tenant', () => {
    expect(profileDirFor('/p', 'default')).toBe('/p');
  });

  it('nests other tenants under tenants/<id>', () => {
    expect(profileDirFor('/p', 'mom')).toBe('/p/tenants/mom');
  });
});
