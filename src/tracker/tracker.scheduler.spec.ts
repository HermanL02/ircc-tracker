import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Env } from '../config/env.validation.js';
import type { TenantsService } from '../tenants/tenants.service.js';
import { TrackerScheduler } from './tracker.scheduler.js';
import type { TrackerService } from './tracker.service.js';

const HOUR = 60 * 60 * 1000;

function setup(opts: { checkOnBoot?: boolean; lastSuccess?: Record<string, Date | null> } = {}) {
  let markSeeded!: () => void;
  const seeded = new Promise<void>((resolve) => (markSeeded = resolve));
  const tenants = {
    whenSeeded: () => seeded,
    listEnabledIds: vi.fn(async () => ['a', 'b', 'c']),
  };
  const tracker = {
    enqueue: vi.fn(() => ({ position: 1 })),
    enqueueAll: vi.fn(async () => ({ queued: ['a', 'b'] })),
    lastSuccessAt: vi.fn(async (id: string) => opts.lastSuccess?.[id] ?? null),
  };
  const values: Partial<Env> = {
    CHECK_CRON: '0 0 1 1 *',
    CHECK_TIMEZONE: 'America/Toronto',
    CHECK_ON_BOOT: opts.checkOnBoot ?? true,
  };
  const config = { get: (key: keyof Env) => values[key] };
  const registry = new SchedulerRegistry();
  const scheduler = new TrackerScheduler(
    tracker as unknown as TrackerService,
    tenants as unknown as TenantsService,
    registry,
    config as unknown as ConfigService<Env, true>,
  );
  return { scheduler, tracker, tenants, registry, markSeeded };
}

let logError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TrackerScheduler', () => {
  it('cron tick queues every enabled tenant with trigger "schedule"', async () => {
    const { scheduler, tracker } = setup();
    await scheduler.tick();
    expect(tracker.enqueueAll).toHaveBeenCalledWith('schedule');
  });

  it('a failing tick is logged, not thrown', async () => {
    const { scheduler, tracker } = setup();
    tracker.enqueueAll.mockRejectedValueOnce(new Error('db down'));
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });

  it('boot check queues each enabled tenant unless it succeeded in the last hour', async () => {
    const { scheduler, tracker } = setup({
      lastSuccess: { a: new Date(Date.now() - 10 * 60 * 1000), b: new Date(Date.now() - 2 * HOUR), c: null },
    });
    await scheduler.bootCheck();
    expect(tracker.enqueue.mock.calls).toEqual([
      ['b', 'boot'],
      ['c', 'boot'],
    ]);
  });

  it('boot check waits for the tenant seed, then 15 s', async () => {
    vi.useFakeTimers();
    const { scheduler, tracker, tenants, markSeeded } = setup();
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tenants.listEnabledIds).not.toHaveBeenCalled();

    markSeeded();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(tenants.listEnabledIds).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(tracker.enqueue).toHaveBeenCalledTimes(3);
    scheduler.onApplicationShutdown();
  });

  it('no boot check when CHECK_ON_BOOT is false', async () => {
    vi.useFakeTimers();
    const { scheduler, tenants, markSeeded } = setup({ checkOnBoot: false });
    scheduler.onApplicationBootstrap();
    markSeeded();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tenants.listEnabledIds).not.toHaveBeenCalled();
    scheduler.onApplicationShutdown();
  });

  it('shutdown stops the cron job and cancels a pending boot check', async () => {
    vi.useFakeTimers();
    const { scheduler, tenants, registry, markSeeded } = setup();
    scheduler.onApplicationBootstrap();
    const job = registry.getCronJob('ircc-check');
    expect(job.isActive).toBe(true);

    markSeeded();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.onApplicationShutdown();
    expect(job.isActive).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tenants.listEnabledIds).not.toHaveBeenCalled();
  });
});
