import { Injectable } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { generateTotp } from './totp.js';

// Generates a GCKey two-factor code locally from a tenant's base32 TOTP secret.
@Injectable()
export class TotpService {
  async currentCode(secret: string): Promise<string> {
    const params = { secret, digits: 6, period: 30, algorithm: 'SHA1' as const };
    const now = generateTotp(params);
    // Don't submit a code that is about to roll over.
    if (now.remainingSeconds >= 5) return now.code;
    await sleep((now.remainingSeconds + 1) * 1000);
    return generateTotp(params).code;
  }
}
