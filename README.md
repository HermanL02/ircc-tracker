# IRCC Tracker

Checks an IRCC application on the [application status tracker](https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-status-tracker.html) on a schedule, stores every result in Postgres, and emails you after every check: what changed, or "No update" with the latest raw responses.

Each check signs in like a person would:

1. GCKey username and password
2. Two-factor code, generated locally (RFC 6238) from `GCKEY_TOTP_SECRET`
3. Role "Principal applicant", then the application lookup form
4. View application → History

It records the two responses the tracker page itself uses (`getApplicationDetailsForLwc` and `getRawApplicationHistory`), then compares them with the last successful check. Changes are described in plain lines, for example `background inProgress → completed` or `History (November 1, 2026): …`.

Built with NestJS 12, TypeORM, Playwright and Postgres.

## Why headed Chrome

GCKey uses an invisible hCaptcha that rejects headless and automation-flagged browsers. The tracker therefore runs **real Google Chrome, headed, on an Xvfb virtual display**, with the automation flags removed. It also uses a **persistent browser profile** so later sign-ins look like a returning visitor. If a step fails, a screenshot is saved to `$BROWSER_PROFILE_DIR/last-failure.png`.

**Canada.ca blocks datacenter IPs.** Requests from GCP (Iowa and Toronto both tested) get a CloudFront 403. On a server, set `BROWSER_PROXY_URL` to a residential proxy; only Chrome's traffic uses it.

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

## Run locally as a service (how it runs today)

Canada.ca blocks datacenter IPs, so the tracker runs on a home machine as two systemd **user** services: a private Postgres cluster and the tracker itself. Chrome runs headed on an invisible Xvfb display, so no window appears.

```bash
sudo apt install -y xvfb postgresql          # once
npm install && npx playwright install chrome && npm run build

# Private Postgres cluster on 127.0.0.1:5433, owned by your user
D=~/.local/share/ircc-tracker; mkdir -p $D
openssl rand -hex 24 > $D/.pgpass-ircc && chmod 600 $D/.pgpass-ircc
/usr/lib/postgresql/18/bin/initdb -D $D/pg -U ircc --auth=scram-sha-256 --pwfile=$D/.pgpass-ircc

cp deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ircc-postgres
PGPASSWORD=$(cat $D/.pgpass-ircc) psql -h 127.0.0.1 -p 5433 -U ircc -d postgres -c "create database ircc"

cp .env.example .env    # fill it in: DATABASE_URL=postgres://ircc:<password>@127.0.0.1:5433/ircc, HOST=127.0.0.1
systemctl --user enable --now ircc-tracker
loginctl enable-linger $USER   # keep running when logged out
```

Useful commands:

```bash
journalctl --user -u ircc-tracker -f          # logs
systemctl --user restart ircc-tracker         # after editing .env or rebuilding
curl -H "x-api-key: $KEY" localhost:3460/status
curl -X POST -H "x-api-key: $KEY" localhost:3460/checks   # check now
```

Checks only run while the machine is awake.

## Development

```bash
npm run start:dev        # headed Chrome opens on your display
npm test
```

## Deploy on a server

The Docker image and `docker-compose.yml` still work (Coolify: Docker Compose build pack), but a server **must** set `BROWSER_PROXY_URL` to a residential proxy, because Canada.ca returns 403 to datacenter IPs.
