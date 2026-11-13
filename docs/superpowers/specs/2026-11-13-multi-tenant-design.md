# Multi-tenant IRCC Tracker — design

Date: 2026-11-13 · Status: draft, awaiting approval

## Intent

One running tracker watches several IRCC applications, each with its own GCKey account
(username, password, TOTP secret), its own application details, and its own email recipients.
Herman manages tenants for family/friends. Tenants are added, changed and removed through the
HTTP API while the service runs, with no restart.

## Goals

- Many tenants in one process, each checked on the shared schedule.
- Tenants stored in Postgres and managed through an admin API (CRUD).
- Per-tenant email recipients; all mail goes through the existing shared useSend config.
- Per-tenant history, change detection, failure alerts and status endpoints.
- Existing single-tenant `.env` deployments keep working after upgrade.

## Non-goals

- Tenants logging in or calling the API themselves (no per-tenant API keys; existing `API_KEYS` are admin keys).
- Encrypting credentials at rest. Security stays at today's level: secrets are plaintext, like `.env` on disk; Postgres stays bound to localhost.
- A web UI.
- Per-tenant schedules.

## Anti-goals

- Two Chromes running at once (RAM; the laptop has OOM history), or bursts of lookups from one IP that trip IRCC's rate limit.
- The API ever returning a GCKey password or TOTP secret.
- One tenant's bad credentials stopping checks for the others.

## Approaches considered

- **A. `tenants.json` file, re-read each run.** Simple, no restart, but editing a file by hand; no self-service later.
- **B. One instance per tenant.** No code, but a Chrome + Xvfb per instance and uncoordinated sign-ins from one IP. Rejected.
- **C. Tenants in Postgres, admin API (chosen).** Herman picked this. RAM is the same as A (one Chrome at a time); extra cost is the API surface. No encryption, by Herman's decision.

## Design

### Data

New table `tenants`:

| column | type | notes |
|---|---|---|
| id | varchar(64) PK | slug, `^[a-z0-9][a-z0-9-]*$`, e.g. `herman`, `mom` |
| name | varchar(128) | display name used in email subjects |
| enabled | boolean, default true | disabled tenants are skipped by the scheduler |
| gckey_username, gckey_password, gckey_totp_secret | text | plaintext; `select: false` on the entity |
| surname, given_name, uci, application_number, date_of_birth (date), country_of_birth | text/date | lookup form fields |
| notify_to | jsonb string[] | recipients for this tenant |
| created_at, updated_at | timestamptz | |

`checks` gets `tenant_id varchar(64) REFERENCES tenants(id) ON DELETE CASCADE` and an index on
`(tenant_id, started_at DESC)`. Column is nullable in the migration (see Upgrade), and the app always sets it.

Validation reuses the existing zod rules from `env.validation.ts` (TOTP secret normalisation from
base32 or `otpauth://`, UCI 8–10 digits, DOB `YYYY-MM-DD`), moved into a shared `tenant.schema.ts`.

### Admin API (existing `API_KEYS` guard)

- `GET /tenants` — list; credentials replaced by `hasPassword`, `hasTotpSecret` booleans.
- `GET /tenants/:id`
- `POST /tenants` — create (full body, validated).
- `PATCH /tenants/:id` — partial update; omitted password/secret are left unchanged.
- `DELETE /tenants/:id` — deletes the tenant and its checks.
- `GET /tenants/:id/status`, `GET /tenants/:id/checks?limit=`, `POST /tenants/:id/checks` (run one tenant now; blocks ~1 min; 409 if any check is running).
- `GET /checks/:id` stays global.
- `POST /checks` — queue a run of all enabled tenants; returns 202 immediately.
- `GET /status` and `GET /checks` are kept for back-compat and act on the `default` tenant if it exists (404 otherwise).

### Scheduler and checks

- Each cron tick loads enabled tenants from the DB (so API changes apply on the next tick, no restart) and checks them **one at a time**.
- A global lock stays: only one Chrome at a time across all tenants and triggers.
- **Gap between tenants:** `CHECK_TENANT_GAP_SECONDS`, default 300 (keeps ≤3 lookups per 15 min even if IRCC's limit is per IP rather than per account). *My call — we don't know which; 300s is the safe side. With a 2-hour cron this fits ~20 tenants.* If a tick fires while the previous round is still running, it is skipped.
- Boot check: per tenant, skipped if that tenant had a success in the last hour.
- `IrccPortalService.fetchSnapshot(tenant)` takes credentials/details as an argument instead of reading env. `TotpService` takes the secret as an argument.
- Browser profile per tenant: `${BROWSER_PROFILE_DIR}/tenants/<id>`; failure screenshot goes in that dir. *My call:* the seeded `default` tenant reuses the existing `BROWSER_PROFILE_DIR` root so its hCaptcha cookies survive the upgrade.

### Email

- `NotifierService.send(to: string[], subject, text)`. Shared `USESEND_*` and `NOTIFY_EMAIL_FROM`.
- Change / no-update / baseline emails go to the tenant's `notify_to`; subjects prefixed with the tenant name, e.g. `[Mom] IRCC update: …`.
- Failure alerts (`NOTIFY_ERROR_AFTER`, counted per tenant) go to the tenant's recipients **and** to `NOTIFY_EMAIL_TO` from `.env` as the admin copy, since a broken password is usually Herman's to fix. *My call.*
- `NOTIFY_EVERY_CHECK` stays global.

### Upgrade / back-compat

- `GCKEY_*` and `IRCC_*` env vars become optional.
- On boot, if the `tenants` table is empty and `GCKEY_USERNAME` is set, seed tenant `default` from env (recipients = `NOTIFY_EMAIL_TO`) and assign all checks with `tenant_id IS NULL` to it. After that, env credentials are ignored (logged once) — the DB is the source of truth.
- README: new "Multiple applications" section with curl examples; `.env.example` notes.

## Left to the builder

- Exact DTO/zod wiring for Nest controllers, Swagger annotations.
- Whether the round runner is part of `TrackerService` or its own small class.
- Tests: tenant schema validation, change detection scoped per tenant, scheduler skipping disabled tenants and serialising runs (vitest, mocking the portal).
