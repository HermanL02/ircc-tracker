import { Logger } from '@nestjs/common';
import type { CheckTrigger } from './entities/check.entity.js';
import { RunQueue, type RunQueueDeps } from './run-queue.js';

interface RunRecord {
  tenantId: string;
  trigger: CheckTrigger;
  start: number;
  end: number;
}

const RUN_DURATION_MS = 60_000;

/** Builds deps on a virtual clock: `sleep` advances time instead of waiting. */
function makeDeps(overrides: Partial<RunQueueDeps> = {}) {
  let clock = 0;
  const runs: RunRecord[] = [];
  let active = 0;
  let maxActive = 0;
  const sleep = async (ms: number) => {
    clock += ms;
    await Promise.resolve();
  };
  const deps: RunQueueDeps = {
    gapMs: 0,
    now: () => clock,
    sleep,
    isRunnable: async () => true,
    run: async (tenantId, trigger) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const start = clock;
      await sleep(RUN_DURATION_MS);
      runs.push({ tenantId, trigger, start, end: clock });
      active--;
    },
    ...overrides,
  };
  return { deps, runs, maxActive: () => maxActive };
}

describe('RunQueue', () => {
  it('runs in FIFO order one at a time', async () => {
    const { deps, runs, maxActive } = makeDeps();
    const queue = new RunQueue(deps);
    queue.enqueue('a', 'boot');
    queue.enqueue('b', 'schedule');
    queue.enqueue('c', 'manual');
    await queue.whenIdle();

    expect(runs.map((r) => [r.tenantId, r.trigger])).toEqual([
      ['a', 'boot'],
      ['b', 'schedule'],
      ['c', 'manual'],
    ]);
    expect(maxActive()).toBe(1);
    for (let i = 1; i < runs.length; i++)
      expect(runs[i].start).toBeGreaterThanOrEqual(runs[i - 1].end);
    expect(queue.current).toBeNull();
    expect(queue.pending).toEqual([]);
  });

  it('waits gapMs between any two runs', async () => {
    const { deps, runs } = makeDeps({ gapMs: 300_000 });
    const queue = new RunQueue(deps);
    queue.enqueue('a', 'schedule');
    queue.enqueue('b', 'schedule');
    queue.enqueue('c', 'schedule');
    await queue.whenIdle();

    expect(runs.map((r) => r.tenantId)).toEqual(['a', 'b', 'c']);
    expect(runs[0].start).toBe(0);
    expect(runs[1].start).toBeGreaterThanOrEqual(runs[0].end + 300_000);
    expect(runs[2].start).toBeGreaterThanOrEqual(runs[1].end + 300_000);
  });

  it('measures the gap from the end of the previous run, also across idle periods', async () => {
    const { deps, runs } = makeDeps({ gapMs: 300_000 });
    const queue = new RunQueue(deps);
    queue.enqueue('a', 'schedule');
    await queue.whenIdle();
    queue.enqueue('b', 'manual');
    await queue.whenIdle();

    expect(runs.map((r) => r.tenantId)).toEqual(['a', 'b']);
    expect(runs[1].start).toBe(runs[0].end + 300_000);
  });

  it('de-duplicates', () => {
    const { deps } = makeDeps();
    const queue = new RunQueue(deps);
    queue.enqueue('x', 'schedule'); // becomes current once the worker starts
    const first = queue.enqueue('a', 'schedule');
    queue.enqueue('b', 'schedule');
    const second = queue.enqueue('a', 'manual');

    expect(second).toBe(first);
    expect(queue.pending.filter((id) => id === 'a')).toHaveLength(1);
  });

  it('front', async () => {
    const { deps } = makeDeps();
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    deps.run = () => {
      markStarted();
      return gate;
    };
    const queue = new RunQueue(deps);
    queue.enqueue('a', 'schedule');
    await started;
    expect(queue.current).toBe('a');
    queue.enqueue('b', 'schedule');
    queue.enqueue('c', 'schedule');

    expect(queue.enqueue('c', 'manual', { front: true })).toBe(1);
    expect(queue.pending).toEqual(['c', 'b']);

    // The tenant currently running is queued again at the front.
    expect(queue.enqueue('a', 'manual', { front: true })).toBe(1);
    expect(queue.pending).toEqual(['a', 'c', 'b']);

    release();
    await queue.whenIdle();
  });

  it('drops tenants that are no longer runnable', async () => {
    const logSpy = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { deps, runs } = makeDeps({ isRunnable: async (id) => id !== 'b' });
    const queue = new RunQueue(deps);
    queue.enqueue('a', 'schedule');
    queue.enqueue('b', 'schedule');
    queue.enqueue('c', 'schedule');
    await queue.whenIdle();

    expect(runs.map((r) => r.tenantId)).toEqual(['a', 'c']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('b'));
    logSpy.mockRestore();
  });

  it('continues after a failing run', async () => {
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { deps, runs } = makeDeps({ gapMs: 300_000 });
    const baseRun = deps.run.bind(deps);
    deps.run = async (tenantId, trigger) => {
      if (tenantId === 'a') {
        await deps.sleep(RUN_DURATION_MS);
        throw new Error('boom');
      }
      await baseRun(tenantId, trigger);
    };
    const queue = new RunQueue(deps);
    queue.enqueue('a', 'schedule');
    queue.enqueue('b', 'schedule');
    await queue.whenIdle();

    expect(runs.map((r) => r.tenantId)).toEqual(['b']);
    // The failed run still counts as finished for the gap.
    expect(runs[0].start).toBe(RUN_DURATION_MS + 300_000);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('boom');
    errorSpy.mockRestore();
  });

  it('whenIdle resolves immediately when nothing was enqueued', async () => {
    const { deps } = makeDeps();
    await expect(new RunQueue(deps).whenIdle()).resolves.toBeUndefined();
  });
});
