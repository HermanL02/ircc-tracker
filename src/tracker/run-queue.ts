import { Logger } from '@nestjs/common';
import type { CheckTrigger } from './entities/check.entity.js';

export interface RunQueueDeps {
  /** Runs one check. Should not throw; the queue catches and logs anyway. */
  run(tenantId: string, trigger: CheckTrigger): Promise<void>;
  /** True when the tenant still exists and is enabled. */
  isRunnable(tenantId: string): Promise<boolean>;
  /** Minimum time between the end of one run and the start of the next. */
  gapMs: number;
  sleep(ms: number): Promise<void>;
  now(): number;
}

interface QueueEntry {
  tenantId: string;
  trigger: CheckTrigger;
}

/**
 * Serialises all checks (one Chrome at a time) with a fixed gap between
 * sign-ins. A single worker loop is started lazily by `enqueue` and stops
 * when the queue is empty.
 */
export class RunQueue {
  private readonly logger = new Logger(RunQueue.name);
  private readonly queue: QueueEntry[] = [];
  private running: string | null = null;
  private lastFinishedAt: number | null = null;
  private draining = false;
  private idle: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RunQueueDeps) {}

  /**
   * Adds a tenant to the queue and returns its 1-based position in `pending`.
   * A tenant already pending keeps its entry; with `front` it moves to the front
   * (taking the new trigger). The tenant currently running counts as not pending.
   */
  enqueue(
    tenantId: string,
    trigger: CheckTrigger,
    opts: { front?: boolean } = {},
  ): number {
    const index = this.queue.findIndex((e) => e.tenantId === tenantId);
    let position: number;
    if (opts.front) {
      if (index >= 0) this.queue.splice(index, 1);
      this.queue.unshift({ tenantId, trigger });
      position = 1;
    } else if (index >= 0) {
      position = index + 1;
    } else {
      position = this.queue.push({ tenantId, trigger });
    }
    this.startWorker();
    return position;
  }

  /** Tenant id being checked right now, or null. */
  get current(): string | null {
    return this.running;
  }

  /** Tenant ids waiting for their turn, in order. */
  get pending(): string[] {
    return this.queue.map((e) => e.tenantId);
  }

  /** Resolves once the queue is empty and nothing is running. */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  private startWorker(): void {
    if (this.draining) return;
    this.draining = true;
    this.idle = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        await this.waitForGap();
        const entry = this.queue.shift();
        if (!entry) break;
        this.running = entry.tenantId;
        try {
          if (!(await this.isRunnable(entry.tenantId))) continue;
          try {
            await this.deps.run(entry.tenantId, entry.trigger);
          } catch (err) {
            this.logger.error(
              `Check for tenant ${entry.tenantId} failed: ${errorMessage(err)}`,
            );
          }
          this.lastFinishedAt = this.deps.now();
        } finally {
          this.running = null;
        }
      }
    } finally {
      // No await between the empty-queue check and this line, so an enqueue
      // can never land in a queue whose worker has already stopped.
      this.draining = false;
    }
  }

  private async waitForGap(): Promise<void> {
    if (this.lastFinishedAt === null) return;
    const readyAt = this.lastFinishedAt + this.deps.gapMs;
    for (
      let remaining = readyAt - this.deps.now();
      remaining > 0;
      remaining = readyAt - this.deps.now()
    ) {
      await this.deps.sleep(remaining);
    }
  }

  private async isRunnable(tenantId: string): Promise<boolean> {
    try {
      if (await this.deps.isRunnable(tenantId)) return true;
      this.logger.log(`Skipping tenant ${tenantId}: no longer runnable`);
    } catch (err) {
      this.logger.error(
        `Skipping tenant ${tenantId}: runnable check failed: ${errorMessage(err)}`,
      );
    }
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
