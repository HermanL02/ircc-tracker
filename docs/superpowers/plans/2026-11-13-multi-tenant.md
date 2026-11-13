# Multi-tenant IRCC Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tracker process checks many IRCC applications (tenants stored in Postgres, managed via an admin API), each with its own GCKey credentials and email recipients.

**Architecture:** New `tenants` + `app_state` tables and `checks.tenant_id`. A single in-process `RunQueue` serialises every check (one Chrome at a time, fixed gap between sign-ins). Portal/TOTP/notifier take tenant data as arguments instead of reading env. `.env` credentials seed a `default` tenant once.

**Tech Stack:** NestJS 12, TypeORM 1 (Postgres, hand-written migrations), zod 4, Playwright, vitest (unit tests only, `*.spec.ts` next to source).

**Spec:** `docs/superpowers/specs/2026-11-13-multi-tenant-design.md`

## Global Constraints

- Credentials stored plaintext (no encryption); entity columns for `gckey_password` and `gckey_totp_secret` are `select: false`; no API response ever contains them — use `hasPassword` / `hasTotpSecret` booleans.
- Only one Chrome at a time; every check goes through `RunQueue`.
- `CHECK_TENANT_GAP_SECONDS` default `300`, applied between any two checks.
- Tenant id regex `^[a-z0-9][a-z0-9-]*$`, max 64 chars, immutable.
- Email subjects prefixed `[<tenant name>] `.
- Existing `.env` single-tenant installs must keep working with no config change.
- Never run migrations or tests against the live DB `ircc` on port 5433 during development; use scratch DB `ircc_mt_dev` on the same server.
- Do not restart or stop the `ircc-tracker` systemd service during development; never `pkill` node broadly.
- File contents in English.

## Review Focus

1. Upgrade from current prod DB: existing checks with `tenant_id IS NULL` must all land on `default`, and `/status` must keep returning the same data → Task 9 manual verification on a copy of prod data.
2. A tenant with wrong password failing every round must not delay or break other tenants → Task 5 test `continues after a failing run`.
3. PATCH with only `notifyTo` must not reset the baseline (no spurious "now watching" email) → Task 6 test.
4. Deleting/disabling a tenant while it is queued → Task 5 test `drops tenants that are no longer runnable`.
5. Invalid `otpauth://` link or 2FA secret via API returns 400 with a readable message, not 500 → Task 1 test.

---

### Task 1: Tenant validation schema and optional env credentials

**Files:**
- Create: `src/tenants/tenant.schema.ts`, `src/tenants/tenant.schema.spec.ts`
- Modify: `src/config/env.validation.ts`

**Interfaces:**
- Produces:
  - `totpSecret: ZodType<string>` (moved from env.validation: accepts base32 or `otpauth://`, normalises).
  - `tenantCreateSchema` (zod object): `id, name, enabled?=true, gckeyUsername, gckeyPassword, gckeyTotpSecret, surname, givenName, uci, applicationNumber, dateOfBirth (YYYY-MM-DD), countryOfBirth, notifyTo: string[] (≥1 email)`.
  - `tenantUpdateSchema` = create schema `.omit({id})` `.partial()` `.strict()`.
  - types `TenantCreate`, `TenantUpdate`.
  - `env.validation.ts`: `GCKEY_*` and `IRCC_*` become optional (default `''`); a `superRefine` requires all of them (with today's rules) when `GCKEY_USERNAME` is non-empty. New `CHECK_TENANT_GAP_SECONDS: z.coerce.number().int().min(0).default(300)`.

- [ ] **Step 1: Write failing tests** in `tenant.schema.spec.ts`:
  - valid create body parses; `gckeyTotpSecret: 'otpauth://totp/x?secret=jbsw y3dp ehpk 3pxp'` → `'JBSWY3DPEHPK3PXP'`.
  - `id: 'Mom'` fails; `id: 'mom-2'` passes; `uci: '12-34'` fails; `dateOfBirth: '1990/01/01'` fails; `notifyTo: []` fails; `notifyTo: ['x']` fails.
  - `tenantUpdateSchema.parse({ id: 'x' })` throws (strict); `tenantUpdateSchema.parse({ notifyTo: ['a@b.co'] })` passes.
  - `envSchema` parses with no `GCKEY_*`/`IRCC_*` set (only `DATABASE_URL`, `API_KEYS`); with `GCKEY_USERNAME` set but `IRCC_UCI` missing, it fails with path `IRCC_UCI`.
- [ ] **Step 2:** `npx vitest run src/tenants` → FAIL (module not found).
- [ ] **Step 3:** Implement the schemas above.
- [ ] **Step 4:** `npx vitest run` → all PASS; `npx tsc --noEmit -p tsconfig.json` → no errors (callers of the env keys will still compile since types stay `string`).
- [ ] **Step 5:** Commit `feat: tenant validation schema; env credentials optional`.

### Task 2: Schema migration and entities

**Files:**
- Create: `src/database/migrations/1763000000000-multi-tenant.ts`, `src/tenants/entities/tenant.entity.ts`, `src/tenants/entities/app-state.entity.ts`
- Modify: `src/tracker/entities/check.entity.ts`, `src/database/typeorm.options.ts`

**Interfaces:**
- Produces:
  - `Tenant` entity, table `tenants`: `id varchar(64) PK`, `name varchar(128)`, `enabled bool default true`, `gckeyUsername text`, `gckeyPassword text select:false`, `gckeyTotpSecret text select:false`, `surname, givenName, uci, applicationNumber, countryOfBirth text`, `dateOfBirth date` (string in TS), `notifyTo jsonb string[]`, `baselineAfter timestamptz null`, `createdAt`, `updatedAt` (snake_case column names like `checks`).
  - `AppState` entity, table `app_state`: `key text PK`, `value text`.
  - `Check.tenantId: string | null`, column `tenant_id varchar(64) REFERENCES tenants(id) ON DELETE CASCADE`, nullable; index `checks_tenant_started_idx (tenant_id, started_at DESC)`.
  - `down()` drops the index, column and both tables.

- [ ] **Step 1:** Create scratch DB: `psql "postgres://ircc:<pw>@127.0.0.1:5433/postgres" -c 'CREATE DATABASE ircc_mt_dev'` (password from `.env`).
- [ ] **Step 2:** Write entities + migration; register both entities and the migration in `typeormOptions`.
- [ ] **Step 3:** `npm run build && DATABASE_URL=postgres://ircc:<pw>@127.0.0.1:5433/ircc_mt_dev npm run migration:run` → both migrations run. Then `\d checks` shows `tenant_id` and FK; `\d tenants` matches the table above.
- [ ] **Step 4:** Revert check: `npx typeorm migration:revert -d dist/database/data-source.js` (same URL) succeeds, then run again.
- [ ] **Step 5:** Commit `feat: tenants and app_state tables, checks.tenant_id`.

### Task 3: Portal and TOTP take tenant data

**Files:**
- Modify: `src/ircc/ircc-portal.service.ts`, `src/totp/totp.service.ts`, `src/totp/totp.spec.ts`
- Create: `src/ircc/profile-dir.ts`, `src/ircc/profile-dir.spec.ts`

**Interfaces:**
- Consumes: `Tenant` (Task 2).
- Produces:
  - `TotpService.currentCode(secret: string): Promise<string>` (no ConfigService).
  - `profileDirFor(base: string, tenantId: string): string` → `base` when `tenantId === 'default'`, else `join(base, 'tenants', tenantId)`.
  - `IrccPortalService.fetchSnapshot(tenant: Tenant): Promise<Snapshot>` — all `GCKEY_*`/`IRCC_*` reads replaced by tenant fields; profile dir and `last-failure.png` use `profileDirFor`; browser settings still from env. Lookup rejection message becomes `'Application lookup was rejected (check the tenant application details)'`.

- [ ] **Step 1:** Failing tests: `profileDirFor('/p','default') === '/p'`; `profileDirFor('/p','mom') === '/p/tenants/mom'`.
- [ ] **Step 2:** `npx vitest run src/ircc` → FAIL.
- [ ] **Step 3:** Implement; `mkdir -p` the profile dir (`fs.mkdir recursive`) before launch.
- [ ] **Step 4:** `npx vitest run` PASS; `npx tsc --noEmit` shows errors only in `tracker.service.ts` (fixed in Task 6).
- [ ] **Step 5:** Commit `refactor: portal and TOTP take tenant credentials`.

### Task 4: Notifier takes recipients

**Files:**
- Modify: `src/notify/notifier.service.ts`
- Create: `src/notify/recipients.ts`, `src/notify/recipients.spec.ts`

**Interfaces:**
- Produces:
  - `NotifierService.send(to: string[], subject: string, text: string): Promise<void>` — no-op (logged) when `USESEND_API_KEY` empty or `to` empty.
  - `NotifierService.adminRecipients(): string[]` — parsed `NOTIFY_EMAIL_TO`.
  - `failureRecipients(tenantTo: string[], adminTo: string[]): string[]` — union, case-insensitive de-dup, order: tenant first.
  - `tenantSubject(name: string, subject: string): string` → `` `[${name}] ${subject}` ``.
  - `env.validation` superRefine: `NOTIFY_EMAIL_TO` is no longer required when `USESEND_API_KEY` is set (only URL and FROM are).

- [ ] **Step 1:** Failing tests: `failureRecipients(['A@x.co','b@x.co'], ['a@x.co','me@x.co'])` → `['A@x.co','b@x.co','me@x.co']`; `tenantSubject('Mom','IRCC update: x') === '[Mom] IRCC update: x'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run` PASS.
- [ ] **Step 5:** Commit `refactor: notifier sends to explicit recipients`.

### Task 5: RunQueue

**Files:**
- Create: `src/tracker/run-queue.ts`, `src/tracker/run-queue.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RunQueueDeps {
    run(tenantId: string, trigger: CheckTrigger): Promise<void>; // must not throw; errors are caught & logged by queue anyway
    isRunnable(tenantId: string): Promise<boolean>;          // exists && enabled
    gapMs: number;
    sleep(ms: number): Promise<void>;
    now(): number;
  }
  export class RunQueue {
    constructor(deps: RunQueueDeps);
    enqueue(tenantId: string, trigger: CheckTrigger, opts?: { front?: boolean }): number; // returns 1-based position; existing entry → its current position (moved to front if front)
    get current(): string | null;   // tenant id being checked
    get pending(): string[];
    whenIdle(): Promise<void>;      // for tests and shutdown
  }
  ```
  Single worker loop started lazily by `enqueue`; before each run waits until `now() >= lastFinishedAt + gapMs` (no wait before the very first run). Re-checks `isRunnable` when a tenant's turn comes and drops it if false.

- [ ] **Step 1:** Failing tests with fake `sleep`/`now` (advance a virtual clock in `sleep`):
  - `runs in FIFO order one at a time` — enqueue a,b,c; `run` records start/end; assert order `a,b,c` and no overlap.
  - `waits gapMs between any two runs` — gap 300_000; virtual start times of b and c ≥ previous end + 300_000; first run starts at t=0.
  - `de-duplicates` — enqueue a twice → `pending` has one a; second call returns same position.
  - `front` — with a running and b,c pending, `enqueue('c','manual',{front:true})` → pending `['c','b']`, returns 1.
  - `drops tenants that are no longer runnable` — isRunnable false for b → run never called for b.
  - `continues after a failing run` — run rejects for a → b still runs.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: serial run queue with gap between sign-ins`.

### Task 6: TrackerService per tenant

**Files:**
- Modify: `src/tracker/tracker.service.ts`, `src/tracker/tracker.module.ts`
- Create: `src/tenants/baseline.ts`, `src/tenants/baseline.spec.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `resetsBaseline(patch: TenantUpdate): boolean` — true iff patch has any of `gckeyUsername, uci, applicationNumber, surname, givenName, dateOfBirth, countryOfBirth`.
  - `TrackerService` provides a `RunQueue` instance (deps wired to `runCheck`, tenant lookup, `CHECK_TENANT_GAP_SECONDS`, `timers/promises` sleep).
  - `TrackerService.enqueue(tenantId: string, trigger: CheckTrigger, front = false): { position: number }`.
  - `TrackerService.enqueueAll(trigger: CheckTrigger): Promise<{ queued: string[] }>` — all enabled tenants.
  - `TrackerService.runCheck(tenantId: string, trigger): Promise<void>` (called only by the queue) — loads tenant with secrets (`addSelect`), saves check with `tenantId`, compares with `latestSnapshot(tenant)` which filters `tenant_id = :id AND status='ok' AND (baseline_after IS NULL OR started_at > baseline_after)`; emails go to `tenant.notifyTo` with `tenantSubject`; failure threshold counted over this tenant's checks only, sent to `failureRecipients(tenant.notifyTo, notifier.adminRecipients())`.
  - `latest(tenantId)`, `list(tenantId, limit)`, `lastSuccessAt(tenantId)`, `findOne(id)` (unchanged), `isRunning(tenantId): boolean` (`queue.current === tenantId`).
  - Remove the boolean `running` flag and `ConflictException` path.

- [ ] **Step 1:** Failing tests: `resetsBaseline({ notifyTo: ['a@b.co'] }) === false`; `resetsBaseline({ name: 'X', enabled: false }) === false`; `resetsBaseline({ applicationNumber: 'E1' }) === true`; `resetsBaseline({ gckeyPassword: 'p' }) === false`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `baseline.ts` and the service changes.
- [ ] **Step 4:** `npx vitest run` PASS; `npx tsc --noEmit` errors only in controller/scheduler (Task 8).
- [ ] **Step 5:** Commit `feat: per-tenant checks, baselines and alerts`.

### Task 7: TenantsService, admin API and one-time seed

**Files:**
- Create: `src/tenants/tenants.service.ts`, `src/tenants/tenants.controller.ts`, `src/tenants/tenants.module.ts`, `src/tenants/public-tenant.ts`, `src/tenants/public-tenant.spec.ts`, `src/tenants/seed.ts`, `src/tenants/seed.spec.ts`, `src/common/pipes/zod.pipe.ts`
- Modify: `src/app.module.ts`, `src/tracker/tracker.module.ts`. Module layout: `TenantsModule` provides/exports `TenantsService` only; `TrackerModule` imports it and registers `TenantsController` (the controller needs `TrackerService` for the DELETE 409 check). No circular imports.

**Interfaces:**
- Produces:
  - `ZodPipe(schema)` — Nest `PipeTransform`; on failure throws `BadRequestException({ message: 'Invalid tenant', issues: z.flattenError(err) })`.
  - `toPublicTenant(t: Tenant & { gckeyPassword?: string; gckeyTotpSecret?: string }): PublicTenant` — all fields except the two secrets, plus `hasPassword`, `hasTotpSecret`.
  - `seedFromEnv(env: Env): TenantCreate | null` — null when `GCKEY_USERNAME` empty; else `{ id: 'default', name: 'Default', notifyTo: NOTIFY_EMAIL_TO split, ...}`. If `NOTIFY_EMAIL_TO` empty, `notifyTo` is `[]` — the seed bypasses `tenantCreateSchema`'s ≥1 rule (emails just skip).
  - `TenantsService`: `list(): Promise<PublicTenant[]>`, `get(id)`, `getWithSecrets(id): Promise<Tenant | null>`, `create(body: TenantCreate)` (409 on duplicate id), `update(id, patch: TenantUpdate)` (sets `baselineAfter = now()` when `resetsBaseline(patch)`), `remove(id)`, `listEnabledIds(): Promise<string[]>`, and `onApplicationBootstrap()` that, in one transaction, if `app_state` has no `env_seeded`: inserts the seed tenant (if any), `UPDATE checks SET tenant_id='default' WHERE tenant_id IS NULL` (only when seeded), inserts `env_seeded=<ISO now>`. If already seeded and `GCKEY_USERNAME` set, log once: `GCKEY_*/IRCC_* in .env are ignored; tenants live in the database`.
  - `TenantsController` (`@ApiTags('tenants')`, `@ApiSecurity('api-key')`): `GET /tenants`, `GET /tenants/:id`, `POST /tenants` (201), `PATCH /tenants/:id`, `DELETE /tenants/:id` (204; 409 if `tracker.isRunning(id)` — wire via Task 8).

- [ ] **Step 1:** Failing tests: `toPublicTenant` output has no `gckeyPassword`/`gckeyTotpSecret` keys and `hasPassword === true`; `seedFromEnv` with empty `GCKEY_USERNAME` → null; with full env → `id 'default'`, `notifyTo` split/trimmed from `'a@x.co, b@x.co'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run` PASS.
- [ ] **Step 5:** Commit `feat: tenant admin API and one-time seed from .env`.

### Task 8: Scheduler and tracker routes

**Files:**
- Modify: `src/tracker/tracker.scheduler.ts`, `src/tracker/tracker.controller.ts`, `src/tenants/tenants.controller.ts`

**Interfaces:**
- Consumes: `TrackerService.enqueue/enqueueAll/latest/list/isRunning/lastSuccessAt(tenantId)`, `TenantsService.listEnabledIds`.
- Produces routes:
  - `GET /tenants/:id/status`, `GET /tenants/:id/checks?limit=` (1–200, default 20), `POST /tenants/:id/checks` → 202 `{ position }` (404 unknown/disabled tenant).
  - `POST /checks` → 202 `{ queued: string[] }`.
  - `GET /status`, `GET /checks` → same as tenant routes for `default`; 404 `No default tenant` if absent.
  - `GET /checks/:id` unchanged.
  - Scheduler: cron tick → `enqueueAll('schedule')`. Boot (after 15 s, if `CHECK_ON_BOOT`): for each enabled tenant, enqueue `'boot'` unless its last success < 1 h ago.

- [ ] **Step 1:** `npx tsc --noEmit` and `npm run lint` → clean.
- [ ] **Step 2:** `npx vitest run` → all PASS.
- [ ] **Step 3:** Commit `feat: per-tenant routes and queued scheduling`.

### Task 9: Docs and end-to-end verification on scratch data

**Files:**
- Modify: `README.md` (new "Multiple applications" section: create/list/patch/delete with curl, gap explanation, seed behaviour; update HTTP API table), `.env.example` (`CHECK_TENANT_GAP_SECONDS`, note that `GCKEY_*`/`IRCC_*` seed the `default` tenant once and are then ignored).

- [ ] **Step 1:** Copy prod data into scratch: `pg_dump` of `ircc` → restore into a fresh `ircc_mt_dev` (drop/recreate first). Read-only on `ircc`.
- [ ] **Step 2:** Start the built app against scratch on another port with emails off and no boot check: `DATABASE_URL=…/ircc_mt_dev PORT=3461 USESEND_API_KEY= CHECK_ON_BOOT=false CHECK_CRON='0 0 1 1 *' node dist/main.js` (run in background, note PID). Expected logs: migration ran, `default` seeded.
- [ ] **Step 3:** Verify with curl (`x-api-key` from `.env`):
  - `GET /tenants` → one `default`, no secrets, `hasPassword: true`.
  - `GET /status` equals `GET /tenants/default/status`; `GET /checks?limit=200` count equals prod `SELECT count(*) FROM checks`.
  - `POST /tenants` with bad `uci` → 400 with issues; valid fake tenant `test` → 201; `PATCH /tenants/test {"notifyTo":["x@y.co"]}` → `baselineAfter` stays null; `PATCH {"uci":"12345678"}` → `baselineAfter` set; `DELETE /tenants/test` → 204.
  - Restart the app; `GET /tenants` still only `default` (seed not repeated); delete `default`, restart, still empty.
- [ ] **Step 4:** One real check for `default` on scratch: `POST /tenants/default/checks` → 202; within ~2 min `GET /tenants/default/checks?limit=1` shows `status: ok`. (Uses the real GCKey once; profile dir must be the same as prod's so hCaptcha cookies apply. Make sure the prod service is not mid-check: `journalctl --user -u ircc-tracker -n 5`.)
- [ ] **Step 5:** Kill the test app by its PID; drop `ircc_mt_dev`.
- [ ] **Step 6:** Commit `docs: multiple applications`.
