import { createHmac } from 'node:crypto';

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpParams {
  secret: string; // base32
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeBase32(secret: string): string {
  return secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

export function base32Decode(input: string): Buffer {
  const clean = normalizeBase32(input);
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// RFC 6238 / RFC 4226
export function generateTotp(p: TotpParams, nowMs = Date.now()) {
  const counter = Math.floor(nowMs / 1000 / p.period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(p.algorithm.toLowerCase(), base32Decode(p.secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** p.digits;
  const code = bin.toString().padStart(p.digits, '0');
  const elapsed = Math.floor(nowMs / 1000) % p.period;
  return { code, remainingSeconds: p.period - elapsed, period: p.period };
}
