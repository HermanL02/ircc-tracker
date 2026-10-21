import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';
import { envSchema, type Env } from './config/env.validation.js';
import { typeormOptions } from './database/typeorm.options.js';
import { HealthModule } from './health/health.module.js';
import { TrackerModule } from './tracker/tracker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        typeormOptions(config.get('DATABASE_URL', { infer: true }), config.get('DATABASE_SSL', { infer: true })),
    }),
    ScheduleModule.forRoot(),
    TrackerModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
