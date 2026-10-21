# IRCC Tracker: automatic IRCC application status checker with email alerts

**Stop refreshing the IRCC application status tracker.** IRCC Tracker signs in to your Government of Canada account (GCKey) for you, checks your immigration application on a schedule, and emails you what changed: a new history entry, a milestone moving to *Completed*, or a decision. When nothing changed, you can still get an email saying so.

Self-hosted and open source. Your credentials stay on your own machine.

Works with any application shown in the [IRCC application status tracker](https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-status-tracker.html): **permanent residence (Express Entry, PNP, family sponsorship), citizenship, work permits, study permits and visitor visas.**

[![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs)](https://nestjs.com) [![Playwright](https://img.shields.io/badge/Playwright-Chrome-2EAD33?logo=playwright)](https://playwright.dev) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql)](https://www.postgresql.org) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Not affiliated with or endorsed by Immigration, Refugees and Citizenship Canada (IRCC) or the Government of Canada. It reads your own application with your own credentials, the same way you would in a browser. Use it at your own risk and within the [GCKey terms and conditions](https://clegc-gckey.gc.ca/j/eng/l).

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Run it in the background (Linux)](#run-it-in-the-background-linux)
- [Configuration](#configuration)
- [Email alerts](#email-alerts)
- [HTTP API](#http-api)
- [Running on a server or in Docker](#running-on-a-server-or-in-docker)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Security and privacy](#security-and-privacy)

## Features

- **Automatic GCKey sign-in with two-factor**: generates your authenticator code itself from your TOTP secret, so you don't type a code on each check.
- **Scheduled checks**: every 2 hours by default, with any cron schedule and time zone.
- **Change detection that reads like English**, for example:
  - `background inProgress → completed`
  - `Application status: inProgress → decisionMade`
  - `History (November 1, 2026): We received your proof of completion for the immigration medical exam`
- **Email alerts** on every change, plus an optional "No update" email after each check with the latest raw tracker data.
- **Full history in PostgreSQL**: every check and the exact data the tracker returned, so you can see when each step happened.
- **Small HTTP API**: latest status, past checks, and "check now".
- **Failure alerts**: one email if checks keep failing (for example, after a password change).
- **Runs quietly**: real Chrome on an invisible virtual display, with no browser window appearing.

## How it works

Each check does what you would do by hand:

1. Opens the IRCC portal and chooses **Sign in with GCKey**.
2. Enters your GCKey username and password, then the **two-factor code**, which it generates locally (RFC 6238 TOTP).
3. Picks **Principal applicant** and fills in the application lookup form (name, UCI, application number, date and country of birth).
4. Opens **View application → History** and records the two responses the tracker page loads: application details (status and milestones) and the readable history.
5. Compares them with the previous check, stores the result, and emails you.

GCKey protects sign-in with an invisible **hCaptcha** that rejects headless browsers. So the tracker drives **real Google Chrome in headed mode on an Xvfb virtual display** and keeps a persistent browser profile. You never see a window, and sign-in looks like a returning visitor.

## Requirements

- **Linux** (tested on Ubuntu 24.04+) on a **home or residential internet connection**. Canada.ca blocks cloud and datacenter IPs; see [Running on a server](#running-on-a-server-or-in-docker).
- **Node.js 22+** and **npm 11+**
- **Google Chrome**, installed below with `npx playwright install chrome`
- **Xvfb** and **PostgreSQL**: `sudo apt install -y xvfb postgresql`
- A **GCKey** account with **two-factor authentication through an authenticator app**, and access to the authenticator's **secret key** (see the [FAQ](#how-do-i-get-my-gckey-authenticator-secret))
- Your application details: **UCI**, **application number**, date of birth, country of birth

## Quick start

```bash
git clone https://github.com/HermanL02/ircc-tracker.git
cd ircc-tracker
npm install
npx playwright install chrome
npm run build

cp .env.example .env
chmod 600 .env
$EDITOR .env          # fill in your own values; every setting is explained inline
```

Then try one check with a visible browser:

```bash
npm run start:dev
```

You'll see Chrome sign in and open your application history. The terminal prints `baseline saved` when the first check succeeds. After that, keep it running in the background as described next.

## Run it in the background (Linux)

These steps run two **systemd user services** (no root needed after installing packages): a private PostgreSQL cluster and the tracker. They start at boot and keep running after you log out.

**1. Create a private Postgres cluster** (port 5433, localhost only):

```bash
DATA_DIR=~/.local/share/ircc-tracker
PG_BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
mkdir -p "$DATA_DIR"
openssl rand -hex 24 > "$DATA_DIR/.pgpass" && chmod 600 "$DATA_DIR/.pgpass"
"$PG_BIN/initdb" -D "$DATA_DIR/pg" -U ircc --auth=scram-sha-256 --pwfile="$DATA_DIR/.pgpass"
```

**2. Install the services** from the templates in `deploy/systemd/` (change the values at the top to customize):

```bash
NAME=ircc  PG_PORT=5433  DISPLAY_NUM=99
APP_DIR=$(pwd)  NODE_BIN=$(command -v node)
mkdir -p ~/.config/systemd/user
for t in postgres tracker; do
  sed -e "s|@NAME@|$NAME|g" -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@NODE_BIN@|$NODE_BIN|g" \
      -e "s|@PG_BIN@|$PG_BIN|g" -e "s|@DATA_DIR@|$DATA_DIR|g" -e "s|@PG_PORT@|$PG_PORT|g" \
      -e "s|@DISPLAY_NUM@|$DISPLAY_NUM|g" "deploy/systemd/$t.service.in" \
      > ~/.config/systemd/user/$NAME-$t.service
done
systemctl --user daemon-reload
systemctl --user enable --now $NAME-postgres
PGPASSWORD=$(cat "$DATA_DIR/.pgpass") "$PG_BIN/psql" -h 127.0.0.1 -p $PG_PORT -U ircc -d postgres -c "create database ircc"
```

**3. Point `.env` at it**, then start the tracker:

```bash
# in .env:
#   DATABASE_URL=postgres://ircc:<contents of ~/.local/share/ircc-tracker/.pgpass>@127.0.0.1:5433/ircc
#   BROWSER_PROFILE_DIR=/home/<you>/.local/share/ircc-tracker/browser-profile
systemctl --user enable --now $NAME-tracker
loginctl enable-linger "$USER"      # keep running when you're logged out
```

Everyday commands:

```bash
journalctl --user -u ircc-tracker -f        # follow the logs
systemctl --user restart ircc-tracker       # after editing .env or pulling updates (run npm run build first)
systemctl --user disable --now ircc-tracker ircc-postgres   # stop and uninstall
```

Checks only run while the computer is awake.

## Configuration

All settings live in `.env`; [`.env.example`](.env.example) documents each one. The main ones:

| Variable | Required | Description |
|---|---|---|
| `GCKEY_USERNAME`, `GCKEY_PASSWORD` | yes | Your GCKey sign-in |
| `GCKEY_TOTP_SECRET` | yes | Authenticator secret: the base32 key or the whole `otpauth://` link |
| `IRCC_SURNAME`, `IRCC_GIVEN_NAME` | yes | As entered in the tracker's lookup form |
| `IRCC_UCI` | yes | Unique client identifier, digits only |
| `IRCC_APPLICATION_NUMBER` | yes | e.g. `E001234567` |
| `IRCC_DATE_OF_BIRTH` | yes | `YYYY-MM-DD` |
| `IRCC_COUNTRY_OF_BIRTH` | yes | As spelled in the tracker's country list |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `API_KEYS` | yes | Key(s) for the HTTP API (`openssl rand -hex 32`) |
| `CHECK_CRON` | | Schedule, default `17 */2 * * *` (every 2 hours) |
| `CHECK_TIMEZONE` | | IANA time zone, default: the machine's |
| `NOTIFY_EVERY_CHECK` | | `true` (default) also emails "No update" |
| `BROWSER_PROXY_URL` | | Residential proxy for servers (see below) |

## Email alerts

Email goes through [useSend](https://usesend.com), an open-source email platform you can self-host or use as a service, backed by Amazon SES. Set:

```bash
USESEND_API_URL=https://your-usesend-instance
USESEND_API_KEY=...
NOTIFY_EMAIL_TO=you@example.com
NOTIFY_EMAIL_FROM=IRCC Tracker <noreply@your-verified-domain.com>
```

You'll receive:

| When | Subject |
|---|---|
| First successful check | `IRCC tracker is watching your application` |
| Something changed | `IRCC update: <first change>` with the full list |
| Nothing changed (if `NOTIFY_EVERY_CHECK=true`) | `IRCC: no update (<status>)` |
| Checks keep failing | `IRCC tracker: N checks in a row failed` |

Every email includes the status, the milestones, and the latest raw tracker responses.

## HTTP API

The API listens on `HOST:PORT` (default `127.0.0.1:3460`). Every route except `/health` needs `x-api-key: <one of API_KEYS>`. Interactive Swagger docs are at `/docs`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/status` | Latest status, milestones, readable history and the last change |
| `GET` | `/checks?limit=20` | Recent checks and what changed in each |
| `GET` | `/checks/:id` | One check including the raw IRCC responses |
| `POST` | `/checks` | Run a check now (about a minute) |
| `GET` | `/health` | Database health (no key needed) |

```bash
curl -s -H "x-api-key: $KEY" localhost:3460/status
curl -s -X POST -H "x-api-key: $KEY" localhost:3460/checks
```

## Running on a server or in Docker

A `Dockerfile` (headed Chrome on Xvfb) and a `docker-compose.yml` (tracker + PostgreSQL, compatible with [Coolify](https://coolify.io)) are included:

```bash
docker compose up -d --build
```

**However, Canada.ca blocks datacenter IP addresses.** From AWS, Google Cloud, Azure and similar providers, `ircc-services.canada.ca` returns `403 ERROR: The request could not be satisfied`. Google Cloud's Iowa and Toronto regions were both tested. On a server, set `BROWSER_PROXY_URL` to a Canadian **residential or ISP proxy**; only Chrome's traffic uses it. At home you don't need one.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `GCKey sign-in failed: "Security Check Failed"` | hCaptcha rejected the browser. Use Google Chrome (`BROWSER_CHANNEL=chrome`), keep `BROWSER_HEADLESS=false`, and keep `BROWSER_PROFILE_DIR` between runs. Several sign-ins in a short time can also trigger it; wait and try again. |
| Stuck on the GCKey page until `Timeout` | hCaptcha showed an image challenge, usually because the browser was headless. |
| `Failed at "open sign-in"`, `The request could not be satisfied` | Your IP is a datacenter IP. Use a residential proxy or run at home. |
| `Application lookup was rejected` | An `IRCC_*` value doesn't match IRCC's records. The form allows **3 attempts per 15 minutes**. |
| Two-factor code rejected | Wrong `GCKEY_TOTP_SECRET`, or the computer's clock is off (`timedatectl`). |
| What did the page look like? | See `BROWSER_PROFILE_DIR/last-failure.png`. |

## FAQ

### How do I get my GCKey authenticator secret?

When you turn on (or reset) two-factor authentication with an authenticator app, GCKey shows a QR code. That QR code contains an `otpauth://totp/...?secret=XXXX` link. You can either:

- choose "can't scan / enter key manually" during setup and copy the key, or
- decode the QR code with any QR reader and paste the whole `otpauth://` link into `GCKEY_TOTP_SECRET`.

If you already set up your phone app, most apps can export or show the key. Google Authenticator's "Transfer accounts" export is an `otpauth-migration://` QR code that holds several accounts in one code and has to be converted first. Keep using your phone app too: the code is the same everywhere.

### Is this allowed?

It signs in to **your own** account with **your own** credentials and reads the same page you'd read in a browser, at a modest rate (every 2 hours by default). It doesn't bypass any access control. You're responsible for using it in line with the GCKey terms of use. Don't run it against other people's accounts.

### How often should it check?

IRCC updates the tracker roughly daily, so every 2 to 6 hours is plenty. Don't go below every 15 minutes: the lookup form allows 3 attempts per 15 minutes, and frequent sign-ins make captcha challenges more likely.

### Does it work for Express Entry, PNP, spousal sponsorship, citizenship, work and study permits?

Yes. It reads whatever the IRCC application status tracker shows for your application number. Applications that aren't in the tracker yet (for example, some paper applications) can't be checked.

### Can it track several applications or family members?

Every person on the application is included: milestones are reported per person. For a separate application number, run a second copy with its own `.env`, `NAME` and ports.

## Security and privacy

- Credentials live only in your `.env` (keep it `chmod 600`) and never leave your machine, except to sign in to Canada.ca and to send emails to you.
- The authenticator code is generated locally; no third-party service is involved.
- The API binds to `127.0.0.1` by default and requires an API key.
- The database stores your application data, so treat it like any other personal document.

## Tech stack

[NestJS](https://nestjs.com) 12, [TypeORM](https://typeorm.io) with migrations, [PostgreSQL](https://www.postgresql.org), [Playwright](https://playwright.dev) driving Google Chrome, Xvfb, [@nestjs/schedule](https://docs.nestjs.com/techniques/task-scheduling), Zod-validated configuration, Swagger, Vitest.

```bash
npm test          # unit tests: TOTP (RFC 6238 vectors) and change detection
npm run lint
```

## License

[MIT](LICENSE). Contributions and issues are welcome.

**Keywords:** IRCC tracker, IRCC application status tracker, IRCC status checker, IRCC email notification, GCKey automation, Canada immigration application status, PR application tracker, Express Entry tracker, PNP application status, citizenship application tracker, work permit status, study permit status, IRCC portal, self-hosted, NestJS, Playwright.
