import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateChecks1761080000000 implements MigrationInterface {
  name = 'CreateChecks1761080000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "checks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trigger" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL,
        "error" text,
        "started_at" timestamptz NOT NULL,
        "finished_at" timestamptz,
        "content_hash" varchar(64),
        "changed" boolean NOT NULL DEFAULT false,
        "changes" jsonb NOT NULL DEFAULT '[]',
        "app_status" varchar(64),
        "last_updated" timestamptz,
        "details" jsonb,
        "history" jsonb
      )
    `);
    await q.query(`CREATE INDEX "checks_started_at_idx" ON "checks" ("started_at" DESC)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "checks"`);
  }
}
