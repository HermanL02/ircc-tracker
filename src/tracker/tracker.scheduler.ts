import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Env } from '../config/env.validation.js';
import { TrackerService } from './tracker.service.js';

// The cron expression comes from CHECK_CRON, so the job is registered at runtime
// instead of with a static @Cron() decorator.
@Injectable()
export class TrackerScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(TrackerScheduler.name);

  constructor(
    private readonly tracker: TrackerService,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap() {
    const cron = this.config.get('CHECK_CRON', { infer: true });
    const timeZone = this.config.get('CHECK_TIMEZONE', { infer: true });
    const job = CronJob.from({ cronTime: cron, timeZone, onTick: () => this.run('schedule') });
    this.registry.addCronJob('ircc-check', job);
    job.start();
    this.logger.log(`Checks scheduled "${cron}" (${timeZone}), next at ${job.nextDate().toISO()}`);

    if (this.config.get('CHECK_ON_BOOT', { infer: true })) setTimeout(() => this.run('boot'), 15_000);
  }

  private async run(trigger: 'boot' | 'schedule') {
    if (this.tracker.isRunning) return;
    await this.tracker.runCheck(trigger).catch((e: Error) => this.logger.error(e.message));
  }
}
