// Playwright error messages carry a multi-line call log that can quote values passed to
// page.fill(), e.g. `fill("<password>")`. Text built from such an error is cut to its first
// line and has every known secret replaced with ***, before it is logged or stored.
export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    variants.add(secret);
    // The call log quotes values as JSON strings, so a secret with " or \ appears escaped.
    variants.add(JSON.stringify(secret).slice(1, -1));
  }
  // Longest first, so a secret that contains another one is replaced whole.
  let result = text;
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    result = result.split(variant).join('***');
  }
  return result;
}

export function safeErrorText(message: string, secrets: readonly (string | null | undefined)[]): string {
  return redactSecrets(message.split('\n')[0], secrets);
}
