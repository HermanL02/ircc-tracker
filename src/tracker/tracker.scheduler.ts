import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Env } from '../config/env.validation.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TrackerService } from './tracker.service.js';

const CRON_JOB_NAME = 'ircc-check';
const BOOT_CHECK_DELAY_MS = 15_000;
const BOOT_CHECK_SKIP_MS = 60 * 60 * 1000;

// The cron expression comes from CHECK_CRON, so the job is registered at runtime
// instead of with a static @Cron() decorator. Every check goes through the run queue.
@Injectable()
export class TrackerScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TrackerScheduler.name);
  private job: CronJob | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly tracker: TrackerService,
    private readonly tenants: TenantsService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap() {
    const cron = this.config.get('CHECK_CRON', { infer: true });
    const timeZone = this.config.get('CHECK_TIMEZONE', { infer: true });
    const job = CronJob.from({ cronTime: cron, timeZone, onTick: () => void this.tick() });
    this.registry.addCronJob(CRON_JOB_NAME, job);
    job.start();
    this.job = job;
    this.logger.log(`Checks scheduled "${cron}" (${timeZone}), next at ${job.nextDate().toISO()}`);

    // Not awaited: TenantsService may bootstrap after this hook, so waiting here could deadlock.
    if (this.config.get('CHECK_ON_BOOT', { infer: true })) {
      void this.tenants.whenSeeded().then(() => {
        if (!this.stopped) this.bootTimer = setTimeout(() => void this.bootCheck(), BOOT_CHECK_DELAY_MS);
      });
    }
  }

  onApplicationShutdown() {
    this.stopped = true;
    void this.job?.stop();
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  // Each tick reads the enabled tenants from the database, so API changes apply without a restart.
  // Tenants still queued from the previous tick are not added twice.
  async tick(): Promise<void> {
    try {
      const { queued } = await this.tracker.enqueueAll('schedule');
      this.logger.log(`Scheduled check queued for ${queued.length} tenant(s)`);
    } catch (e) {
      this.logger.error(`Scheduled check failed to queue: ${(e as Error).message}`);
    }
  }

  // Skip a tenant's start-up check when it had a success in the last hour, so restarts don't
  // send duplicate emails.
  async bootCheck(): Promise<void> {
    try {
      for (const id of await this.tenants.listEnabledIds()) {
        if (this.stopped) return;
        const last = await this.tracker.lastSuccessAt(id);
        if (last && Date.now() - last.getTime() < BOOT_CHECK_SKIP_MS) {
          this.logger.log(`Skipping start-up check for ${id}; last successful check was at ${last.toISOString()}`);
          continue;
        }
        this.tracker.enqueue(id, 'boot');
      }
    } catch (e) {
      this.logger.error(`Start-up check failed to queue: ${(e as Error).message}`);
    }
  }
}
