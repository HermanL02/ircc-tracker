import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { Env } from '../../config/env.validation.js';

export const API_KEY_HEADER = 'x-api-key';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly keys: Buffer[];

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.keys = config.get('API_KEYS', { infer: true }).map((k) => Buffer.from(k));
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const given = Buffer.from(String(req.headers[API_KEY_HEADER] ?? bearer ?? ''));
    const ok = this.keys.some((k) => k.length === given.length && timingSafeEqual(k, given));
    if (!ok) throw new UnauthorizedException('Invalid or missing API key');
    return true;
  }
}
