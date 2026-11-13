// Who receives a failure alert: the tenant's own recipients plus the admin copy,
// de-duplicated case-insensitively, keeping the first spelling seen (tenant first).
export function failureRecipients(tenantTo: string[], adminTo: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const address of [...tenantTo, ...adminTo]) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }
  return result;
}

// Every tenant email subject starts with the tenant name, so shared inboxes can tell them apart.
export function tenantSubject(name: string, subject: string): string {
  return `[${name}] ${subject}`;
}
