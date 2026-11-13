import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiTenant1763000000000 implements MigrationInterface {
  name = 'MultiTenant1763000000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "tenants" (
        "id" varchar(64) PRIMARY KEY,
        "name" varchar(128) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "gckey_username" text NOT NULL,
        "gckey_password" text NOT NULL,
        "gckey_totp_secret" text NOT NULL,
        "surname" text NOT NULL,
        "given_name" text NOT NULL,
        "uci" text NOT NULL,
        "application_number" text NOT NULL,
        "date_of_birth" date NOT NULL,
        "country_of_birth" text NOT NULL,
        "notify_to" jsonb NOT NULL,
        "baseline_after" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      CREATE TABLE "app_state" (
        "key" text PRIMARY KEY,
        "value" text NOT NULL
      )
    `);
    // Nullable so existing rows survive; the boot seed assigns them to the `default` tenant.
    await q.query(
      `ALTER TABLE "checks" ADD COLUMN "tenant_id" varchar(64) REFERENCES "tenants"("id") ON DELETE CASCADE`,
    );
    await q.query(`CREATE INDEX "checks_tenant_started_idx" ON "checks" ("tenant_id", "started_at" DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "checks_tenant_started_idx"`);
    await q.query(`ALTER TABLE "checks" DROP COLUMN "tenant_id"`);
    await q.query(`DROP TABLE "app_state"`);
    await q.query(`DROP TABLE "tenants"`);
  }
}
