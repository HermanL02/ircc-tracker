import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Env } from '../config/env.validation.js';

interface LiveCode {
  label: string;
  issuer: string | null;
  code: string;
  remainingSeconds: number;
}

// Reads the GCKey second-factor code from Authkeep (github.com/HermanL02/authkeep).
@Injectable()
export class AuthkeepClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async currentCode(): Promise<string> {
    const label = this.config.get('AUTHKEEP_TOTP_LABEL', { infer: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(new URL('/totp/codes', this.config.get('AUTHKEEP_API_URL', { infer: true })), {
        headers: { 'x-api-key': this.config.get('AUTHKEEP_API_KEY', { infer: true }) },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Authkeep returned ${res.status}`);
      const match = ((await res.json()) as LiveCode[]).find((c) => c.label === label);
      if (!match) throw new Error(`No Authkeep account labelled "${label}"`);
      // Don't submit a code that is about to roll over.
      if (match.remainingSeconds >= 5) return match.code;
      await sleep((match.remainingSeconds + 1) * 1000);
    }
    throw new Error('Could not get a fresh code from Authkeep');
  }
}
