import { describeChanges, hashSnapshot, type Snapshot } from './snapshot.js';

const base = (): Snapshot => ({
  details: {
    success: true,
    app: {
      appStatus: 'inProgress',
      appStatusCode: '01',
      finalDecisionCode: '',
      lastUpdated: '2026-10-15T22:38:38Z',
      dateReceived: '2026-09-30T04:00:00Z',
      appNumber: 'E000000000',
    },
    relations: [
      {
        relationId: 1,
        firstName: 'jane',
        lastName: 'doe',
        milestones: { background: 'inProgress', eligibility: 'notStarted' },
        history: [{ key: 'Medical', dateCreated: '2026-10-15T00:00:52Z', dateLoaded: '2025-12-18T23:30:59Z', actType: '03', actStatus: '33' }],
        tasks: 0,
        actions: [],
        docs: [],
      },
    ],
  },
  history: [{ DateLog1: 'October 15, 2026', TitleEng: 'Complete', BodyEng: 'Medical Exam' }],
});

describe('describeChanges', () => {
  it('reports nothing for identical snapshots', () => {
    expect(describeChanges(base(), base())).toEqual([]);
    expect(hashSnapshot(base())).toBe(hashSnapshot(base()));
  });

  it('hash ignores key order', () => {
    const a = base();
    const b = base();
    b.details.app = Object.fromEntries(Object.entries(a.details.app).reverse()) as Snapshot['details']['app'];
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
  });

  it('describes status, milestone, event and history changes', () => {
    const next = base();
    next.details.app.appStatus = 'decisionMade';
    next.details.app.lastUpdated = '2026-11-01T12:00:00Z';
    next.details.relations[0].milestones.background = 'completed';
    next.details.relations[0].history.push({ key: 'Eligibility', dateCreated: '2026-11-01T12:00:00Z', dateLoaded: 'x', actType: '01', actStatus: '10' });
    next.history.push({ DateLog1: 'November 1, 2026', TitleEng: 'Complete', BodyEng: 'Background check' });

    expect(describeChanges(base(), next)).toEqual([
      'Application status: inProgress → decisionMade',
      'Last updated: 2026-10-15T22:38:38Z → 2026-11-01T12:00:00Z',
      'jane doe: background inProgress → completed',
      'jane doe: new history event Eligibility (type 01, status 10) on 2026-11-01',
      'History (November 1, 2026): Complete: Background check',
    ]);
  });

  it('falls back to a generic line for unrecognised changes', () => {
    const next = base();
    next.details.relations[0].phone = '5550000000';
    expect(describeChanges(base(), next)).toEqual(['Other application details changed (see the stored snapshot).']);
  });
});
