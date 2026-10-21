import { z } from 'zod';

const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

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

  // GCKey sign-in
  GCKEY_USERNAME: z.string().min(1),
  GCKEY_PASSWORD: z.string().min(1),

  // The GCKey authenticator secret: either the base32 secret or the whole otpauth:// link
  // from the QR code shown when you set up the authenticator app.
  GCKEY_TOTP_SECRET: z
    .string()
    .transform((v) => (v.startsWith('otpauth://') ? (new URL(v).searchParams.get('secret') ?? '') : v))
    .transform((v) => v.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase())
    .pipe(z.string().regex(/^[A-Z2-7]{16,}$/, 'GCKEY_TOTP_SECRET must be a base32 secret or an otpauth:// link')),

  // Application lookup form
  IRCC_SURNAME: z.string().min(1),
  IRCC_GIVEN_NAME: z.string().min(1),
  IRCC_UCI: z.string().regex(/^\d{8,10}$/, 'IRCC_UCI must be 8-10 digits'),
  IRCC_APPLICATION_NUMBER: z.string().min(1),
  IRCC_DATE_OF_BIRTH: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'IRCC_DATE_OF_BIRTH must be YYYY-MM-DD'),
  IRCC_COUNTRY_OF_BIRTH: z.string().min(1),

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
  if (!env.USESEND_API_KEY) return;
  for (const key of ['USESEND_API_URL', 'NOTIFY_EMAIL_TO', 'NOTIFY_EMAIL_FROM'] as const) {
    if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when USESEND_API_KEY is set` });
  }
});

export type Env = z.infer<typeof envSchema>;
