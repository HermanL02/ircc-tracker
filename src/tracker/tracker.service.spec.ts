import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { FindOperator, type Repository } from 'typeorm';
import type { Env } from '../config/env.validation.js';
import type { IrccPortalService } from '../ircc/ircc-portal.service.js';
import type { NotifierService } from '../notify/notifier.service.js';
import type { Tenant } from '../tenants/entities/tenant.entity.js';
import type { TenantsService } from '../tenants/tenants.service.js';
import type { Check } from './entities/check.entity.js';
import type { Snapshot } from './lib/snapshot.js';
import { TrackerService } from './tracker.service.js';

// In-memory stand-in for Repository<Check>: only what TrackerService uses, with `where`
// supporting plain equality and MoreThan, and `order` on startedAt.
class FakeChecks {
  rows: Check[] = [];
  private nextId = 1;

  create(fields: Partial<Check>): Check {
    return { error: null, changed: false, changes: [], ...fields } as Check;
  }

  async save(check: Check): Promise<Check> {
    if (!check.id) {
      check.id = `check-${this.nextId++}`;
      this.rows.push(check);
    }
    return check;
  }

  async find(opts: { where: Record<string, unknown>; order?: { startedAt?: 'ASC' | 'DESC' }; take?: number }) {
    const rows = this.query(opts.where, opts.order);
    return opts.take === undefined ? rows : rows.slice(0, opts.take);
  }

  async findOne(opts: { where: Record<string, unknown>; order?: { startedAt?: 'ASC' | 'DESC' } }) {
    return this.query(opts.where, opts.order)[0] ?? null;
  }

  private query(where: Record<string, unknown>, order?: { startedAt?: 'ASC' | 'DESC' }): Check[] {
    const matches = (row: Check) =>
      Object.entries(where).every(([key, expected]) => {
        const actual = (row as unknown as Record<string, unknown>)[key];
        if (expected instanceof FindOperator) {
          if (expected.type !== 'moreThan') throw new Error(`FakeChecks: unsupported operator ${expected.type}`);
          return (actual as Date) > (expected.value as Date);
        }
        return actual === expected;
      });
    const rows = this.rows.filter(matches);
    if (order?.startedAt) {
      const sign = order.startedAt === 'DESC' ? -1 : 1;
      rows.sort((a, b) => sign * (a.startedAt.getTime() - b.startedAt.getTime()));
    }
    return rows;
  }
}

const tenant = (id: string, name: string, notifyTo: string[]): Tenant =>
  ({
    id,
    name,
    enabled: true,
    gckeyUsername: `${id}-user`,
    gckeyPassword: `${id}-password`,
    gckeyTotpSecret: 'JBSWY3DPEHPK3PXP',
    surname: 'Doe',
    givenName: 'Jane',
    uci: '1234567890',
    applicationNumber: `E-${id}`,
    dateOfBirth: '1990-01-01',
    countryOfBirth: 'China',
    notifyTo,
    baselineAfter: null,
  }) as Tenant;

const snapshot = (appNumber: string, appStatus: string): Snapshot => ({
  details: {
    success: true,
    app: {
      appStatus,
      appStatusCode: '01',
      finalDecisionCode: '',
      lastUpdated: '2026-10-15T22:38:38Z',
      dateReceived: '2026-09-30T04:00:00Z',
      appNumber,
    },
    relations: [],
  },
  history: [],
});

function setup(env: Partial<Env> = {}) {
  const tenants: Record<string, Tenant> = {
    a: tenant('a', 'Alice', ['alice@example.com']),
    b: tenant('b', 'Bob', ['bob@example.com', 'Admin@example.com']),
  };
  // What the portal returns next for each tenant, or an Error to throw.
  const portalResult: Record<string, Snapshot | Error> = {};
  const checks = new FakeChecks();
  const tenantsService = {
    getWithSecrets: vi.fn(async (id: string) => (tenants[id] ? structuredClone(tenants[id]) : null)),
    isEnabled: vi.fn(async (id: string) => tenants[id]?.enabled === true),
    listEnabledIds: vi.fn(async () => Object.keys(tenants).filter((id) => tenants[id].enabled)),
  };
  const portal = {
    fetchSnapshot: vi.fn(async (t: Tenant) => {
      const result = portalResult[t.id];
      if (result instanceof Error) throw result;
      return structuredClone(result);
    }),
  };
  const notifier = {
    send: vi.fn(async (_to: string[], _subject: string, _text: string) => undefined),
    adminRecipients: vi.fn(() => ['admin@example.com', 'ops@example.com']),
  };
  const values: Partial<Env> = { CHECK_TENANT_GAP_SECONDS: 0, NOTIFY_EVERY_CHECK: false, NOTIFY_ERROR_AFTER: 3, ...env };
  const config = { get: (key: keyof Env) => values[key] };
  const service = new TrackerService(
    checks as unknown as Repository<Check>,
    tenantsService as unknown as TenantsService,
    portal as unknown as IrccPortalService,
    notifier as unknown as NotifierService,
    config as unknown as ConfigService<Env, true>,
  );

  // Every check starts one minute after the previous one, so their order is unambiguous.
  let clock = new Date('2026-11-13T00:00:00Z').getTime();
  const run = async (id: string, result: Snapshot | Error) => {
    portalResult[id] = result;
    clock += 60_000;
    vi.setSystemTime(clock);
    await service.runCheck(id, 'manual');
  };
  const sent = () => notifier.send.mock.calls.map(([to, subject]) => ({ to, subject }));
  return { service, tenants, checks, portal, notifier, tenantsService, run, sent, now: () => clock };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TrackerService.runCheck', () => {
  it('passes the tenant with its secrets to the portal', async () => {
    const { run, portal, tenantsService } = setup();
    await run('a', snapshot('E-a', 'inProgress'));
    expect(tenantsService.getWithSecrets).toHaveBeenCalledWith('a');
    expect(portal.fetchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', gckeyPassword: 'a-password', gckeyTotpSecret: 'JBSWY3DPEHPK3PXP' }),
    );
  });

  it('first check saves a baseline and emails the tenant with its name prefix', async () => {
    const { run, sent, checks } = setup();
    await run('a', snapshot('E-a', 'inProgress'));
    expect(sent()).toEqual([{ to: ['alice@example.com'], subject: '[Alice] IRCC tracker is watching your application' }]);
    expect(checks.rows).toMatchObject([{ tenantId: 'a', status: 'ok', changed: false, appStatus: 'inProgress' }]);
  });

  it('compares each tenant only with its own snapshots when checks interleave', async () => {
    const { run, sent, checks } = setup();
    await run('a', snapshot('E-a', 'inProgress'));
    await run('b', snapshot('E-b', 'decisionMade'));
    await run('a', snapshot('E-a', 'inProgress'));
    await run('b', snapshot('E-b', 'decisionMade'));
    await run('a', snapshot('E-a', 'approved'));

    expect(sent()).toEqual([
      { to: ['alice@example.com'], subject: '[Alice] IRCC tracker is watching your application' },
      { to: ['bob@example.com', 'Admin@example.com'], subject: '[Bob] IRCC tracker is watching your application' },
      { to: ['alice@example.com'], subject: '[Alice] IRCC update: Application status: inProgress → approved' },
    ]);
    expect(checks.rows.map((c) => [c.tenantId, c.changed])).toEqual([
      ['a', false],
      ['b', false],
      ['a', false],
      ['b', false],
      ['a', true],
    ]);
  });

  it('after a baseline reset the next check is a new baseline, not an update', async () => {
    const { run, sent, tenants, now } = setup();
    await run('a', snapshot('E-a', 'inProgress'));
    tenants.a.applicationNumber = 'E-other';
    tenants.a.baselineAfter = new Date(now() + 1);
    await run('a', snapshot('E-other', 'approved'));
    await run('a', snapshot('E-other', 'approved'));

    expect(sent()).toEqual([
      { to: ['alice@example.com'], subject: '[Alice] IRCC tracker is watching your application' },
      { to: ['alice@example.com'], subject: '[Alice] IRCC tracker is watching your application' },
    ]);
  });

  it('with NOTIFY_EVERY_CHECK, an unchanged check still emails the tenant', async () => {
    const { run, sent } = setup({ NOTIFY_EVERY_CHECK: true });
    await run('a', snapshot('E-a', 'inProgress'));
    await run('a', snapshot('E-a', 'inProgress'));
    expect(sent()[1]).toEqual({ to: ['alice@example.com'], subject: '[Alice] IRCC: no update (inProgress)' });
  });

  it('a failed check is stored as an error and sends nothing below the threshold', async () => {
    const { run, sent, checks } = setup();
    await run('a', new Error('boom'));
    expect(checks.rows).toMatchObject([{ tenantId: 'a', status: 'error', error: 'boom' }]);
    expect(sent()).toEqual([]);
  });

  it('counts failures per tenant and alerts the tenant plus admin once, de-duplicated', async () => {
    const { run, sent } = setup();
    await run('b', snapshot('E-b', 'inProgress'));
    await run('b', new Error('fail 1'));
    await run('a', new Error('a fail 1'));
    await run('b', new Error('fail 2'));
    await run('a', new Error('a fail 2'));
    expect(sent()).toHaveLength(1); // only b's baseline so far

    await run('b', new Error('fail 3'));
    await run('b', new Error('fail 4'));

    const alerts = sent().slice(1);
    expect(alerts).toEqual([
      {
        to: ['bob@example.com', 'Admin@example.com', 'ops@example.com'],
        subject: '[Bob] IRCC tracker: 3 checks in a row failed',
      },
    ]);
  });

  it('the failure alert includes the latest error', async () => {
    const { run, notifier } = setup({ NOTIFY_ERROR_AFTER: 2 });
    await run('a', new Error('first'));
    await run('a', new Error('second'));
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send.mock.calls[0][2]).toContain('second');
  });

  it('skips an unknown tenant without creating a check', async () => {
    const { service, checks, portal } = setup();
    await service.runCheck('missing', 'manual');
    expect(checks.rows).toEqual([]);
    expect(portal.fetchSnapshot).not.toHaveBeenCalled();
  });
});

describe('TrackerService queries', () => {
  it('latest reports the last change from successful checks only', async () => {
    const { run, service, checks } = setup();
    await run('a', snapshot('E-a', 'inProgress'));
    await run('a', snapshot('E-a', 'approved'));
    // A stray error row flagged as changed must not be reported as the last change.
    await checks.save(checks.create({ tenantId: 'a', status: 'error', changed: true, startedAt: new Date(Date.now() + 60_000) }));
    const okChange = checks.rows[1];
    (service as unknown as { checks: { createQueryBuilder: unknown } }).checks.createQueryBuilder = () => {
      const qb = { addSelect: () => qb, where: () => qb, orderBy: () => qb, getOne: async () => okChange };
      return qb;
    };
    const latest = await service.latest('a');
    expect(latest.lastChange?.id).toBe(okChange.id);
  });

  it('enqueueAll queues every enabled tenant', async () => {
    const { service, tenants, tenantsService } = setup();
    tenants.b.enabled = false;
    const enqueue = vi.spyOn(service.queue, 'enqueue').mockReturnValue(1);
    await expect(service.enqueueAll('schedule')).resolves.toEqual({ queued: ['a'] });
    expect(tenantsService.listEnabledIds).toHaveBeenCalled();
    expect(enqueue.mock.calls).toEqual([['a', 'schedule']]);
  });
});
