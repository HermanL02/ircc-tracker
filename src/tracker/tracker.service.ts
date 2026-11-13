import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import type { Env } from '../config/env.validation.js';
import { IrccPortalService } from '../ircc/ircc-portal.service.js';
import { NotifierService } from '../notify/notifier.service.js';
import { failureRecipients, tenantSubject } from '../notify/recipients.js';
import type { Tenant } from '../tenants/entities/tenant.entity.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { Check, type CheckTrigger } from './entities/check.entity.js';
import { describeChanges, hashSnapshot, type Snapshot } from './lib/snapshot.js';
import { RunQueue } from './run-queue.js';

@Injectable()
export class TrackerService {
  private readonly logger = new Logger(TrackerService.name);
  // Every check goes through this queue: one Chrome at a time, with a gap between sign-ins.
  readonly queue: RunQueue;

  constructor(
    @InjectRepository(Check)
    private readonly checks: Repository<Check>,
    private readonly tenants: TenantsService,
    private readonly portal: IrccPortalService,
    private readonly notifier: NotifierService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.queue = new RunQueue({
      run: (tenantId, trigger) => this.runCheck(tenantId, trigger),
      isRunnable: (tenantId) => this.tenants.isEnabled(tenantId),
      gapMs: this.config.get('CHECK_TENANT_GAP_SECONDS', { infer: true }) * 1000,
      sleep: (ms) => sleep(ms),
      now: () => Date.now(),
    });
  }

  // True while this tenant's check is the one running right now.
  isRunning(tenantId: string): boolean {
    return this.queue.current === tenantId;
  }

  // Queues a check for one tenant; `front` puts it ahead of everything still waiting.
  enqueue(tenantId: string, trigger: CheckTrigger, front = false): { position: number } {
    return { position: this.queue.enqueue(tenantId, trigger, { front }) };
  }

  // Queues a check for every enabled tenant.
  async enqueueAll(trigger: CheckTrigger): Promise<{ queued: string[] }> {
    const queued = await this.tenants.listEnabledIds();
    for (const id of queued) this.queue.enqueue(id, trigger);
    return { queued };
  }

  // Signs in, fetches the application, and compares it with the tenant's last successful check.
  // Only the run queue calls this, so two checks never run at once (the lookup form allows
  // 3 attempts per 15 minutes).
  async runCheck(tenantId: string, trigger: CheckTrigger): Promise<void> {
    const tenant = await this.tenants.getWithSecrets(tenantId);
    if (!tenant) {
      this.logger.warn(`Tenant ${tenantId} not found; check skipped`);
      return;
    }
    const subject = (s: string) => tenantSubject(tenant.name, s);
    const check = await this.checks.save(
      this.checks.create({ tenantId, trigger, status: 'running', startedAt: new Date() }),
    );
    try {
      const snapshot = await this.portal.fetchSnapshot(tenant);
      const previous = await this.latestSnapshot(tenant);
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
      this.logger.log(
        `Check ${check.id} (${tenantId}): ${changes.length ? `${changes.length} change(s)` : previous ? 'no changes' : 'baseline saved'}`,
      );

      if (!previous) {
        await this.notifier.send(
          tenant.notifyTo,
          subject('IRCC tracker is watching your application'),
          this.summary(snapshot, ['Baseline saved.'], true),
        );
      } else if (changes.length) {
        await this.notifier.send(tenant.notifyTo, subject(`IRCC update: ${changes[0]}`), this.summary(snapshot, changes, true));
      } else if (this.config.get('NOTIFY_EVERY_CHECK', { infer: true })) {
        await this.notifier.send(
          tenant.notifyTo,
          subject(`IRCC: no update (${snapshot.details.app.appStatus})`),
          this.summary(snapshot, ['No update since the last check.'], true),
        );
      }
    } catch (e) {
      Object.assign(check, { status: 'error', finishedAt: new Date(), error: (e as Error).message });
      await this.checks.save(check);
      await this.alertOnRepeatedFailures(tenant);
    }
  }

  async latest(tenantId: string) {
    const check = await this.checks
      .createQueryBuilder('c')
      .addSelect(['c.details', 'c.history'])
      .where("c.tenant_id = :tenantId AND c.status = 'ok'", { tenantId })
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
      lastChange: await this.checks.findOne({ where: { tenantId, status: 'ok', changed: true }, order: { startedAt: 'DESC' } }),
    };
  }

  // When the last successful check finished, or null if there has never been one.
  async lastSuccessAt(tenantId: string): Promise<Date | null> {
    const last = await this.checks.findOne({ where: { tenantId, status: 'ok' }, order: { startedAt: 'DESC' } });
    return last?.finishedAt ?? null;
  }

  list(tenantId: string, limit: number) {
    return this.checks.find({ where: { tenantId }, order: { startedAt: 'DESC' }, take: limit });
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

  // The tenant's last successful snapshot since its baseline was last reset, or null.
  private async latestSnapshot(tenant: Tenant): Promise<Snapshot | null> {
    const prev = await this.checks.findOne({
      select: { id: true, details: true, history: true },
      where: {
        tenantId: tenant.id,
        status: 'ok',
        ...(tenant.baselineAfter ? { startedAt: MoreThan(tenant.baselineAfter) } : {}),
      },
      order: { startedAt: 'DESC' },
    });
    return prev?.details ? { details: prev.details, history: prev.history ?? [] } : null;
  }

  // Email once when this tenant's failures reach the threshold, not on every failed run.
  private async alertOnRepeatedFailures(tenant: Tenant) {
    const threshold = this.config.get('NOTIFY_ERROR_AFTER', { infer: true });
    const recent = await this.checks.find({ where: { tenantId: tenant.id }, order: { startedAt: 'DESC' }, take: threshold + 1 });
    const failing = recent.slice(0, threshold);
    const justCrossed =
      failing.length === threshold && failing.every((c) => c.status === 'error') && recent[threshold]?.status !== 'error';
    if (justCrossed) {
      await this.notifier.send(
        failureRecipients(tenant.notifyTo, this.notifier.adminRecipients()),
        tenantSubject(tenant.name, `IRCC tracker: ${threshold} checks in a row failed`),
        `The last ${threshold} checks failed.\n\nLatest error:\n${failing[0].error}`,
      );
    }
  }

  private summary(s: Snapshot, lines: string[], withRaw = false): string {
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
      ...(withRaw
        ? [
            '',
            '--- Latest getApplicationDetailsForLwc response ---',
            JSON.stringify(s.details, null, 2),
            '',
            '--- Latest getRawApplicationHistory response ---',
            JSON.stringify(s.history, null, 2),
          ]
        : []),
    ].join('\n');
  }
}
