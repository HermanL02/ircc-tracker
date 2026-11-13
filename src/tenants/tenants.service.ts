import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import type { Env } from '../config/env.validation.js';
import { Check } from '../tracker/entities/check.entity.js';
import { resetsBaseline } from './baseline.js';
import { AppState } from './entities/app-state.entity.js';
import { Tenant } from './entities/tenant.entity.js';
import { toPublicTenant, type PublicTenant } from './public-tenant.js';
import { SEED_ENV_KEYS, SEED_TENANT_ID, seedFromEnv, type SeedEnv } from './seed.js';
import type { TenantCreate, TenantUpdate } from './tenant.schema.js';

const ENV_SEEDED = 'env_seeded';
const UNIQUE_VIOLATION = '23505';

const pgCode = (e: unknown): string | undefined =>
  e instanceof QueryFailedError ? (e.driverError as { code?: string }).code : undefined;

// Safety net behind the zod schemas: Postgres "data exception" errors (class 22, e.g. a value
// too long or an invalid date) are the caller's bad input, so they become 400, not 500.
const rethrowBadData = (e: unknown): never => {
  if (pgCode(e)?.startsWith('22')) throw new BadRequestException({ message: 'Invalid tenant', issues: (e as Error).message });
  throw e;
};

@Injectable()
export class TenantsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantsService.name);
  private markSeeded!: () => void;
  private readonly seeded = new Promise<void>((resolve) => (this.markSeeded = resolve));

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(): Promise<PublicTenant[]> {
    const rows = await this.withSecrets().orderBy('t.id', 'ASC').getMany();
    return rows.map(toPublicTenant);
  }

  async get(id: string): Promise<PublicTenant> {
    const tenant = await this.getWithSecrets(id);
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return toPublicTenant(tenant);
  }

  // The full row including credentials; for the check runner only, never for API responses.
  getWithSecrets(id: string): Promise<Tenant | null> {
    return this.withSecrets().where('t.id = :id', { id }).getOne();
  }

  async create(body: TenantCreate): Promise<PublicTenant> {
    try {
      await this.tenants.insert(body);
    } catch (e) {
      if (pgCode(e) === UNIQUE_VIOLATION) throw new ConflictException(`Tenant ${body.id} already exists`);
      rethrowBadData(e);
    }
    return this.get(body.id);
  }

  // Omitted fields, including the password and TOTP secret, are left unchanged.
  async update(id: string, patch: TenantUpdate): Promise<PublicTenant> {
    const stored = await this.tenants.findOneBy({ id });
    if (!stored) throw new NotFoundException(`Tenant ${id} not found`);
    const changes: Partial<Tenant> = { ...patch };
    if (resetsBaseline(stored, patch)) changes.baselineAfter = new Date();
    if (Object.keys(changes).length) await this.tenants.update(id, changes).catch(rethrowBadData);
    return this.get(id);
  }

  // The tenant's checks go with it (ON DELETE CASCADE).
  async remove(id: string): Promise<void> {
    const { affected } = await this.tenants.delete(id);
    if (!affected) throw new NotFoundException(`Tenant ${id} not found`);
  }

  async isEnabled(id: string): Promise<boolean> {
    return (await this.tenants.findOneBy({ id }))?.enabled === true;
  }

  async listEnabledIds(): Promise<string[]> {
    const rows = await this.tenants.find({ select: { id: true }, where: { enabled: true }, order: { id: 'ASC' } });
    return rows.map((t) => t.id);
  }

  // One-time upgrade from a single-tenant .env: create tenant `default` and give it the
  // existing checks. `env_seeded` is set either way, so deleting every tenant later never
  // brings `default` back; from then on the database is the source of truth.
  async onApplicationBootstrap(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (await manager.existsBy(AppState, { key: ENV_SEEDED })) {
        if (this.config.get('GCKEY_USERNAME', { infer: true })) {
          this.logger.log('GCKEY_*/IRCC_* in .env are ignored; tenants live in the database');
        }
        return;
      }
      const env = Object.fromEntries(SEED_ENV_KEYS.map((key) => [key, this.config.get(key, { infer: true })])) as SeedEnv;
      const seed = seedFromEnv(env);
      if (seed) {
        await manager.insert(Tenant, seed);
        const { affected } = await manager.update(Check, { tenantId: IsNull() }, { tenantId: SEED_TENANT_ID });
        this.logger.log(`Created tenant "${SEED_TENANT_ID}" from .env and assigned ${affected ?? 0} existing check(s) to it`);
      }
      await manager
        .createQueryBuilder()
        .insert()
        .into(AppState)
        .values({ key: ENV_SEEDED, value: new Date().toISOString() })
        .orIgnore()
        .execute();
    });
    this.markSeeded();
  }

  // Resolves once the one-time .env seed above has committed (or was found already done).
  // Nest does not order onApplicationBootstrap between sibling modules, so code that reads
  // tenants at start-up waits on this instead of relying on hook order.
  whenSeeded(): Promise<void> {
    return this.seeded;
  }

  private withSecrets() {
    return this.tenants.createQueryBuilder('t').addSelect(['t.gckeyPassword', 't.gckeyTotpSecret']);
  }
}
