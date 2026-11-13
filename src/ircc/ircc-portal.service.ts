import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page, type Response } from 'playwright';
import type { Env } from '../config/env.validation.js';
import type { Tenant } from '../tenants/entities/tenant.entity.js';
import { TotpService } from '../totp/totp.service.js';
import type { ApplicationDetails, HistoryItem, Snapshot } from '../tracker/lib/snapshot.js';
import { profileDirFor } from './profile-dir.js';

const START_URL = 'https://ircc-services.canada.ca/2/ast';
const APEX_PATH = '/webruntime/api/apex/execute';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Drives the IRCC application status tracker the way a person would:
// GCKey sign-in → two-factor (code generated locally) → role → application lookup → history.
@Injectable()
export class IrccPortalService {
  private readonly logger = new Logger(IrccPortalService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly totp: TotpService,
  ) {}

  async fetchSnapshot(tenant: Tenant): Promise<Snapshot> {
    const env = <K extends keyof Env>(k: K) => this.config.get(k, { infer: true });
    const profileDir = profileDirFor(env('BROWSER_PROFILE_DIR'), tenant.id);
    await mkdir(profileDir, { recursive: true });
    // hCaptcha on GCKey rejects headless and automation-flagged browsers.
    // A persistent profile keeps hCaptcha's cookies, so later sign-ins look like a returning visitor.
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: env('BROWSER_HEADLESS'),
      channel: env('BROWSER_CHANNEL') || undefined,
      // --ozone-platform=x11 keeps Chrome on DISPLAY (Xvfb) even when a Wayland session is around.
      args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--ozone-platform=x11'],
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: { width: 1280, height: 900 },
      locale: 'en-CA',
      proxy: this.proxy(env('BROWSER_PROXY_URL')),
    });
    await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
    // Start signed out every time; the tracker session is not reused.
    await context.clearCookies({ domain: /canada\.ca$|gc\.ca$/ });
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(45_000);
    let step = 'start';

    try {
      step = 'open sign-in';
      await page.goto(START_URL, { waitUntil: 'networkidle' });
      await page.click('#login-btn-1'); // "Sign in or create an account with GCKey"

      step = 'GCKey sign-in';
      await page.waitForSelector('#token1');
      await page.fill('#token1', tenant.gckeyUsername);
      await page.fill('#token2', tenant.gckeyPassword);
      await page.click('#button');
      await page.waitForURL(/\/we\?|gckey_login/, { timeout: 60_000 });
      const heading = (await page.textContent('h1'))?.trim() ?? '';
      if (!/welcome/i.test(heading)) throw new Error(`GCKey sign-in failed: "${heading}"`);
      await page.click('#continue');

      step = 'two-factor';
      await page.waitForSelector('#code');
      await page.fill('#code', await this.totp.currentCode(tenant.gckeyTotpSecret));
      await page.click('#continue-btn');
      await page.waitForSelector('h1:has-text("Authentication success")');
      await page.click('#continue-btn');

      step = 'identify role';
      await page.waitForSelector('#principalApplicantId-label', { timeout: 60_000 });
      await page.click('#principalApplicantId-label');
      await page.click('#continue');

      step = 'application lookup';
      await page.waitForSelector('#surname');
      const [year, month, day] = tenant.dateOfBirth.split('-');
      await page.fill('#surname', tenant.surname);
      await page.fill('#givenName', tenant.givenName);
      await page.fill('#uci', tenant.uci);
      await page.fill('#applicationNumber', tenant.applicationNumber);
      await page.fill('#dateOfBirthYear', year);
      await this.pickOption(page, '#dateOfBirthMonth', MONTHS[Number(month) - 1]);
      await page.fill('#dateOfBirthDay', day);
      await this.pickOption(page, '#countryOfBirth', tenant.countryOfBirth);
      const detailsResponse = this.waitForApex(page, 'getApplicationDetailsForLwc');
      await page.click('#submitButton');
      const details = await this.apexValue<ApplicationDetails>(await detailsResponse);
      if (!details?.success) throw new Error('Application lookup was rejected (check the tenant application details)');

      step = 'history';
      await page.getByRole('button', { name: /view application/i }).first().click();
      await page.getByRole('link', { name: /^history$/i }).first().click();
      const history = await this.apexValue<HistoryItem[]>(await this.waitForApex(page, 'getRawApplicationHistory'));

      await page.click('#signOutButton').catch(() => undefined);
      return { details, history: history ?? [] };
    } catch (e) {
      const where = `${await page.title().catch(() => '?')} (${page.url()})`;
      const shot = join(profileDir, 'last-failure.png');
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
      this.logger.error(`Failed at "${step}" on ${where}: ${(e as Error).message}`);
      throw new Error(`Failed at "${step}" on ${where}: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }

  private proxy(raw: string) {
    if (!raw) return undefined;
    const url = new URL(raw);
    return {
      server: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
    };
  }

  private async pickOption(page: Page, selector: string, label: string) {
    await page.click(selector);
    await page.keyboard.type(label.slice(0, 5));
    await page
      .locator('[role=option], li')
      .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
      .first()
      .click();
  }

  private waitForApex(page: Page, method: string): Promise<Response> {
    return page.waitForResponse(
      (r) => r.url().includes(APEX_PATH) && (r.request().postData() ?? '').includes(`"method":"${method}"`),
      { timeout: 60_000 },
    );
  }

  private async apexValue<T>(res: Response): Promise<T> {
    if (!res.ok()) throw new Error(`Apex call returned ${res.status()}`);
    return ((await res.json()) as { returnValue: T }).returnValue;
  }
}
