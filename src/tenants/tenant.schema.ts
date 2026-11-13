import { z } from 'zod';

// A malformed link yields '' so the totpSecret regex reports it, instead of the URL constructor throwing.
const secretFromOtpauthLink = (link: string): string => {
  try {
    return new URL(link).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
};

// Accepts either the base32 secret or the whole otpauth:// link from the QR code shown when
// setting up a GCKey authenticator app. Applying it to an already normalised value is a no-op.
export const normaliseTotpSecret = (v: string): string =>
  (v.startsWith('otpauth://') ? secretFromOtpauthLink(v) : v)
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '')
    .toUpperCase();

export const totpSecret = z
  .string()
  .transform(normaliseTotpSecret)
  .pipe(z.string().regex(/^[A-Z2-7]{16,}$/, 'must be a base32 secret or an otpauth:// link'));

export const uci = z.string().regex(/^\d{8,10}$/, 'must be 8-10 digits');
export const dateOfBirth = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const tenantShape = z.object({
  id: z
    .string()
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase letters, digits and hyphens, starting with a letter or digit'),
  name: z.string().trim().min(1),
  enabled: z.boolean(),

  // GCKey sign-in
  gckeyUsername: z.string().trim().min(1),
  gckeyPassword: z.string().min(1),
  gckeyTotpSecret: totpSecret,

  // Application lookup form
  surname: z.string().trim().min(1),
  givenName: z.string().trim().min(1),
  uci,
  applicationNumber: z.string().trim().min(1),
  dateOfBirth,
  countryOfBirth: z.string().trim().min(1),

  notifyTo: z.array(z.email()).min(1),
});

export const tenantCreateSchema = tenantShape.extend({ enabled: z.boolean().default(true) });

// The id is immutable, so it is not accepted on update; unknown keys are rejected.
// Built from tenantShape rather than tenantCreateSchema: zod keeps .default() under .partial(),
// which would make every update silently set enabled back to true.
export const tenantUpdateSchema = tenantShape.omit({ id: true }).partial().strict();

export type TenantCreate = z.infer<typeof tenantCreateSchema>;
export type TenantUpdate = z.infer<typeof tenantUpdateSchema>;
