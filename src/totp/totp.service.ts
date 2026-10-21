import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Env } from '../config/env.validation.js';
import { generateTotp } from './totp.js';

// Generates the GCKey two-factor code locally from GCKEY_TOTP_SECRET.
@Injectable()
export class TotpService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async currentCode(): Promise<string> {
    const params = { secret: this.config.get('GCKEY_TOTP_SECRET', { infer: true }), digits: 6, period: 30, algorithm: 'SHA1' as const };
    const now = generateTotp(params);
    // Don't submit a code that is about to roll over.
    if (now.remainingSeconds >= 5) return now.code;
    await sleep((now.remainingSeconds + 1) * 1000);
    return generateTotp(params).code;
  }
}
