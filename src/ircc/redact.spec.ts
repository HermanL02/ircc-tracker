import { redactSecrets, safeErrorText } from './redact.js';

describe('redactSecrets', () => {
  it('replaces every occurrence of each secret with ***', () => {
    expect(redactSecrets('fill("hunter2") then fill("123456") and hunter2 again', ['hunter2', '123456'])).toBe(
      'fill("***") then fill("***") and *** again',
    );
  });

  it('replaces the JSON-escaped form of a secret', () => {
    const password = 'pa"ss\\word';
    expect(redactSecrets(`fill(${JSON.stringify(password)})`, [password])).toBe('fill("***")');
  });

  it('replaces a longer secret whole even when it contains a shorter one', () => {
    expect(redactSecrets('x ABCDEF123456 y', ['123456', 'ABCDEF123456'])).toBe('x *** y');
  });

  it('ignores empty and missing secrets', () => {
    expect(redactSecrets('nothing secret', ['', null, undefined])).toBe('nothing secret');
  });
});

describe('safeErrorText', () => {
  it('keeps only the first line and redacts it', () => {
    const message = [
      'page.fill: Timeout 45000ms exceeded while filling hunter2',
      'Call log:',
      '  - fill("hunter2")',
      '  - fill("JBSWY3DPEHPK3PXP")',
    ].join('\n');
    expect(safeErrorText(message, ['hunter2', 'JBSWY3DPEHPK3PXP'])).toBe(
      'page.fill: Timeout 45000ms exceeded while filling ***',
    );
  });
});
