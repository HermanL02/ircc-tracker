import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Env } from '../config/env.validation.js';
import { IrccPortalService } from '../ircc/ircc-portal.service.js';
import { NotifierService } from '../notify/notifier.service.js';
import { Check, type CheckTrigger } from './entities/check.entity.js';
import { describeChanges, hashSnapshot, type Snapshot } from './lib/snapshot.js';

@Injectable()
export class TrackerService {
  private readonly logger = new Logger(TrackerService.name);
  private running = false;

  constructor(
    @InjectRepository(Check)
    private readonly checks: Repository<Check>,
    private readonly portal: IrccPortalService,
    private readonly notifier: NotifierService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get isRunning() {
    return this.running;
  }

  // Signs in, fetches the application, and compares it with the last successful check.
  async runCheck(trigger: CheckTrigger): Promise<Check> {
    // The lookup form allows 3 attempts per 15 minutes, so never run two checks at once.
    if (this.running) throw new ConflictException('A check is already running');
    this.running = true;
    const check = await this.checks.save(
      this.checks.create({ trigger, status: 'running', startedAt: new Date() }),
    );
    try {
      const snapshot = await this.portal.fetchSnapshot();
      const previous = await this.latestSnapshot();
      const changes = previous ? describeChanges(previous, snapshot) : [];
      Object.assign(check, {
        status: 'ok',
        finishedAt: new Date(),
        contentHash: hashSnapshot(snapshot),
        changed: changes.length > 0,
        changes,
        appStatus: snapshot.details.app.appStatus,
        lastUpdated: snapshot.details.app.lastUpdated ? new Date(snapshot.details.app.lastUpdated) : null,
        details: snapshot.details,
        history: snapshot.history,
      });
      await this.checks.save(check);
      this.logger.log(`Check ${check.id}: ${changes.length ? `${changes.length} change(s)` : previous ? 'no changes' : 'baseline saved'}`);

      if (!previous) await this.notifier.send('IRCC tracker is watching your application', this.summary(snapshot, ['Baseline saved. You will get an email when anything changes.']));
      else if (changes.length) await this.notifier.send(`IRCC update: ${changes[0]}`, this.summary(snapshot, changes));
    } catch (e) {
      Object.assign(check, { status: 'error', finishedAt: new Date(), error: (e as Error).message });
      await this.checks.save(check);
      await this.alertOnRepeatedFailures();
    } finally {
      this.running = false;
    }
    return this.findOne(check.id);
  }

  async latest() {
    const check = await this.checks
      .createQueryBuilder('c')
      .addSelect(['c.details', 'c.history'])
      .where("c.status = 'ok'")
      .orderBy('c.started_at', 'DESC')
      .getOne();
    if (!check) throw new NotFoundException('No successful check yet');
    const app = check.details!.app;
    return {
      checkedAt: check.finishedAt,
      appNumber: app.appNumber,
      appStatus: app.appStatus,
      finalDecisionCode: app.finalDecisionCode || null,
      dateReceived: app.dateReceived,
      lastUpdated: app.lastUpdated,
      people: check.details!.relations.map((r) => ({ name: `${r.firstName} ${r.lastName}`, milestones: r.milestones })),
      history: check.history,
      lastChange: await this.checks.findOne({ where: { changed: true }, order: { startedAt: 'DESC' } }),
    };
  }

  list(limit: number) {
    return this.checks.find({ order: { startedAt: 'DESC' }, take: limit });
  }

  async findOne(id: string) {
    const check = await this.checks
      .createQueryBuilder('c')
      .addSelect(['c.details', 'c.history'])
      .where('c.id = :id', { id })
      .getOne();
    if (!check) throw new NotFoundException(`Check ${id} not found`);
    return check;
  }

  private async latestSnapshot(): Promise<Snapshot | null> {
    const prev = await this.checks
      .createQueryBuilder('c')
      .addSelect(['c.details', 'c.history'])
      .where("c.status = 'ok'")
      .orderBy('c.started_at', 'DESC')
      .getOne();
    return prev?.details ? { details: prev.details, history: prev.history ?? [] } : null;
  }

  // Email once when failures reach the threshold, not on every failed run.
  private async alertOnRepeatedFailures() {
    const threshold = this.config.get('NOTIFY_ERROR_AFTER', { infer: true });
    const recent = await this.checks.find({ order: { startedAt: 'DESC' }, take: threshold + 1 });
    const failing = recent.slice(0, threshold);
    const justCrossed =
      failing.length === threshold && failing.every((c) => c.status === 'error') && recent[threshold]?.status !== 'error';
    if (justCrossed) {
      await this.notifier.send(
        `IRCC tracker: ${threshold} checks in a row failed`,
        `The last ${threshold} checks failed.\n\nLatest error:\n${failing[0].error}`,
      );
    }
  }

  private summary(s: Snapshot, lines: string[]): string {
    const app = s.details.app;
    const people = s.details.relations
      .map((r) => `${r.firstName} ${r.lastName}: ${Object.entries(r.milestones).map(([k, v]) => `${k} ${v}`).join(', ')}`)
      .join('\n');
    return [
      ...lines.map((l) => `• ${l}`),
      '',
      `Application ${app.appNumber}: ${app.appStatus} (last updated ${app.lastUpdated})`,
      people,
      '',
      'https://ircc-services.canada.ca/2/ast',
    ].join('\n');
  }
}
