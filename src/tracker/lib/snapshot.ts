import { createHash } from 'node:crypto';

// Shapes of the IRCC tracker Apex responses we rely on. Everything else is kept as-is.
export interface HistoryEvent {
  key: string;
  dateCreated: string;
  dateLoaded: string;
  actStatus?: string;
  actType?: string;
}

export interface Relation {
  relationId: number;
  firstName: string;
  lastName: string;
  milestones: Record<string, string>;
  history: HistoryEvent[];
  tasks: number;
  actions: unknown[];
  docs: unknown[];
  [key: string]: unknown;
}

export interface ApplicationDetails {
  success: boolean;
  app: {
    appStatus: string;
    appStatusCode: string;
    finalDecisionCode: string;
    lastUpdated: string;
    dateReceived: string;
    appNumber: string;
    [key: string]: unknown;
  };
  relations: Relation[];
  [key: string]: unknown;
}

// One entry of getRawApplicationHistory: the readable text shown on the History page.
export interface HistoryItem {
  DateLog1: string;
  TitleEng?: string;
  BodyEng?: string;
  [key: string]: unknown;
}

export interface Snapshot {
  details: ApplicationDetails;
  history: HistoryItem[];
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function hashSnapshot(s: Snapshot): string {
  return createHash('sha256').update(JSON.stringify(stable(s))).digest('hex');
}

const eventId = (e: HistoryEvent) => [e.key, e.dateCreated, e.actType ?? '', e.actStatus ?? ''].join('|');
const itemId = (i: HistoryItem) => [i.DateLog1, i.TitleEng ?? '', i.BodyEng ?? ''].join('|');
const itemText = (i: HistoryItem) => [i.TitleEng, i.BodyEng].filter(Boolean).join(': ');

// Human-readable list of what changed between two snapshots. Empty when nothing did.
export function describeChanges(prev: Snapshot, next: Snapshot): string[] {
  const out: string[] = [];
  const a = prev.details.app;
  const b = next.details.app;

  if (a.appStatus !== b.appStatus) out.push(`Application status: ${a.appStatus} → ${b.appStatus}`);
  if (a.finalDecisionCode !== b.finalDecisionCode) {
    out.push(`Final decision code: ${a.finalDecisionCode || '(none)'} → ${b.finalDecisionCode || '(none)'}`);
  }
  if (a.lastUpdated !== b.lastUpdated) out.push(`Last updated: ${a.lastUpdated} → ${b.lastUpdated}`);

  for (const rel of next.details.relations) {
    const old = prev.details.relations.find((r) => r.relationId === rel.relationId);
    const who = `${rel.firstName} ${rel.lastName}`.trim();
    if (!old) {
      out.push(`New person on the application: ${who}`);
      continue;
    }
    for (const key of new Set([...Object.keys(old.milestones ?? {}), ...Object.keys(rel.milestones ?? {})])) {
      const from = old.milestones?.[key] ?? '(none)';
      const to = rel.milestones?.[key] ?? '(none)';
      if (from !== to) out.push(`${who}: ${key} ${from} → ${to}`);
    }
    const seen = new Set((old.history ?? []).map(eventId));
    for (const e of rel.history ?? []) {
      if (!seen.has(eventId(e))) {
        const act = e.actType ? ` (type ${e.actType}, status ${e.actStatus})` : '';
        out.push(`${who}: new history event ${e.key}${act} on ${e.dateCreated.slice(0, 10)}`);
      }
    }
    for (const field of ['tasks', 'actions', 'docs'] as const) {
      const n = (v: unknown) => (Array.isArray(v) ? v.length : Number(v ?? 0));
      if (n(old[field]) !== n(rel[field])) out.push(`${who}: ${field} ${n(old[field])} → ${n(rel[field])}`);
    }
  }

  const seenItems = new Set(prev.history.map(itemId));
  for (const item of next.history) {
    if (!seenItems.has(itemId(item))) out.push(`History (${item.DateLog1}): ${itemText(item)}`);
  }

  if (out.length === 0 && hashSnapshot(prev) !== hashSnapshot(next)) {
    out.push('Other application details changed (see the stored snapshot).');
  }
  return out;
}
