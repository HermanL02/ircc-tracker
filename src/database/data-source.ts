import { DataSource } from 'typeorm';
import { typeormOptions } from './typeorm.options.js';

// Used by the TypeORM CLI, e.g. `npm run migration:run`.
export default new DataSource(
  typeormOptions(process.env.DATABASE_URL ?? '', process.env.DATABASE_SSL === 'true'),
);
