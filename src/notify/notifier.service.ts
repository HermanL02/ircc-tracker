import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';

// Sends email through useSend's HTTP API. A no-op when USESEND_API_KEY or NOTIFY_EMAIL_TO is empty.
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return Boolean(this.config.get('USESEND_API_KEY', { infer: true }) && this.config.get('NOTIFY_EMAIL_TO', { infer: true }));
  }

  async send(subject: string, text: string): Promise<void> {
    if (!this.enabled) {
      this.logger.log(`Email disabled; would have sent "${subject}"`);
      return;
    }
    const res = await fetch(new URL('/api/v1/emails', this.config.get('USESEND_API_URL', { infer: true })), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.get('USESEND_API_KEY', { infer: true })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: this.config.get('NOTIFY_EMAIL_TO', { infer: true }).split(',').map((s) => s.trim()),
        from: this.config.get('NOTIFY_EMAIL_FROM', { infer: true }),
        subject,
        text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) this.logger.error(`useSend returned ${res.status}: ${await res.text()}`);
  }
}
