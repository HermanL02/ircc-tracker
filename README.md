# IRCC Tracker

Checks an IRCC application on the [application status tracker](https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-status-tracker.html) on a schedule, stores every result in Postgres, and emails you when anything changes.

Each check signs in like a person would:

1. GCKey username and password
2. Two-factor code, generated locally (RFC 6238) from `GCKEY_TOTP_SECRET`
3. Role "Principal applicant", then the application lookup form
4. View application → History

It records the two responses the tracker page itself uses (`getApplicationDetailsForLwc` and `getRawApplicationHistory`), then compares them with the last successful check. Changes are described in plain lines, for example `background inProgress → completed` or `History (November 1, 2026): …`.

Built with NestJS 12, TypeORM, Playwright and Postgres.

## Why headed Chrome

GCKey uses an invisible hCaptcha that rejects headless and automation-flagged browsers. The tracker therefore runs **real Google Chrome, headed, on an Xvfb virtual display**, with the automation flags removed. It also uses a **persistent browser profile** so later sign-ins look like a returning visitor. If a step fails, a screenshot is saved to `$BROWSER_PROFILE_DIR/last-failure.png`.

The lookup form allows 3 attempts per 15 minutes. Checks never overlap, and the default schedule is every 6 hours.

## API

Every route except `GET /health` needs `x-api-key: <key>`. Interactive docs are at `/docs`.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/status` | Latest status, milestones, readable history and the last change |
| `GET` | `/checks?limit=20` | Recent checks and what changed in each |
| `GET` | `/checks/:id` | One check, including the raw IRCC responses |
| `POST` | `/checks` | Run a check now (about a minute) |

## Configuration

Everything comes from environment variables; see [`.env.example`](.env.example). Nothing personal lives in the code.

Email is optional and goes through a [useSend](https://usesend.com) instance. Set `USESEND_API_KEY` and `NOTIFY_EMAIL_TO` to turn it on. You get an email when tracking starts, on every change, and once after `NOTIFY_ERROR_AFTER` failed checks in a row.

## Run locally

```bash
cp .env.example .env     # fill it in
npm install              # npm 11+
npx playwright install chrome
npm run start:dev        # headed Chrome opens on your display
npm test
```

## Deploy on Coolify

Create a **Docker Compose** application from this repo (base directory `/`). Set the non-`SERVICE_*` variables from `docker-compose.yml` under Environment Variables, give the `tracker` service a domain on port 3000, and deploy. The API key is generated as `SERVICE_PASSWORD_64_APIKEY`.
