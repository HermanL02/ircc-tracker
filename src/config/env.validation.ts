import { z } from 'zod';
import { dateOfBirth, normaliseTotpSecret, totpSecret, uci } from '../tenants/tenant.schema.js';

const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

const required = z.string().min(1, 'must not be empty');

// The rules the single-tenant GCKEY_* / IRCC_* variables must meet once GCKEY_USERNAME is set.
const singleTenantCredentials = z.object({
  GCKEY_USERNAME: required,
  GCKEY_PASSWORD: required,
  GCKEY_TOTP_SECRET: totpSecret,
  IRCC_SURNAME: required,
  IRCC_GIVEN_NAME: required,
  IRCC_UCI: uci,
  IRCC_APPLICATION_NUMBER: required,
  IRCC_DATE_OF_BIRTH: dateOfBirth,
  IRCC_COUNTRY_OF_BIRTH: required,
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: bool('false'),
  // Comma-separated so keys can be rotated without downtime.
  API_KEYS: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((k) => k.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(16, 'Each API key must be at least 16 characters')).min(1)),

  // Single-tenant credentials. All optional: leave GCKEY_USERNAME empty when tenants are managed
  // through the API instead. When GCKEY_USERNAME is set, every one of them is required (see below).
  // GCKey sign-in
  GCKEY_USERNAME: z.string().default(''),
  GCKEY_PASSWORD: z.string().default(''),
  // The GCKey authenticator secret: either the base32 secret or the whole otpauth:// link
  // from the QR code shown when you set up the authenticator app.
  GCKEY_TOTP_SECRET: z.string().default('').transform((v) => (v ? normaliseTotpSecret(v) : v)),

  // Application lookup form
  IRCC_SURNAME: z.string().default(''),
  IRCC_GIVEN_NAME: z.string().default(''),
  IRCC_UCI: z.string().default(''),
  IRCC_APPLICATION_NUMBER: z.string().default(''),
  IRCC_DATE_OF_BIRTH: z.string().default(''),
  IRCC_COUNTRY_OF_BIRTH: z.string().default(''),

  // hCaptcha rejects headless Chrome, so production runs headed under Xvfb.
  BROWSER_HEADLESS: bool('false'),
  BROWSER_CHANNEL: z.string().default('chrome'),
  // Optional proxy for Chrome, e.g. http://user:pass@host:port or socks5://host:port.
  // Canada.ca blocks datacenter IPs, so a server deployment needs a residential proxy.
  BROWSER_PROXY_URL: z.union([z.literal(''), z.string().url()]).default(''),
  // Mount this as a volume in Docker; it also holds last-failure.png for debugging.
  BROWSER_PROFILE_DIR: z.string().default('./.browser-profile'),

  CHECK_CRON: z.string().default('17 */2 * * *'),
  // Defaults to this machine's time zone.
  CHECK_TIMEZONE: z
    .string()
    .default('')
    .transform((v) => v || Intl.DateTimeFormat().resolvedOptions().timeZone),
  CHECK_ON_BOOT: bool('true'),
  // Pause between any two checks, so tenants are never checked back to back.
  CHECK_TENANT_GAP_SECONDS: z.coerce.number().int().min(0).default(300),

  // Optional email alerts through a useSend instance (https://usesend.com).
  // Leave USESEND_API_KEY empty to disable email; the other three are then ignored.
  USESEND_API_URL: z.union([z.literal(''), z.string().url()]).default(''),
  USESEND_API_KEY: z.string().default(''),
  NOTIFY_EMAIL_TO: z.string().default(''),
  NOTIFY_EMAIL_FROM: z.string().default(''),
  // Also email when nothing changed, with the latest raw responses.
  NOTIFY_EVERY_CHECK: bool('true'),
  NOTIFY_ERROR_AFTER: z.coerce.number().int().min(1).default(2),
}).superRefine((env, ctx) => {
  if (env.GCKEY_USERNAME) {
    const result = singleTenantCredentials.safeParse(env);
    for (const issue of result.error?.issues ?? []) {
      const key = String(issue.path[0]);
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} ${issue.message} (required when GCKEY_USERNAME is set)` });
    }
  }

  if (!env.USESEND_API_KEY) return;
  for (const key of ['USESEND_API_URL', 'NOTIFY_EMAIL_TO', 'NOTIFY_EMAIL_FROM'] as const) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when USESEND_API_KEY is set` });
  }
});

export type Env = z.infer<typeof envSchema>;
