import type { DataSourceOptions } from 'typeorm';
import { Check } from '../tracker/entities/check.entity.js';
import { CreateChecks1761080000000 } from './migrations/1761080000000-create-checks.js';

// Shared by the Nest app and the TypeORM CLI data source.
export function typeormOptions(url: string, ssl: boolean): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    entities: [Check],
    migrations: [CreateChecks1761080000000],
    // Never auto-sync the schema in production; migrations run on boot instead.
    synchronize: false,
    migrationsRun: true,
  };
}
