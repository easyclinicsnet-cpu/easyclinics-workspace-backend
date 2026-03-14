/**
 * TypeORM CLI Data Source Configuration
 *
 * Used ONLY by the TypeORM CLI for running/generating/reverting migrations.
 * Not imported by the NestJS application at runtime.
 *
 * Usage:
 *   npx typeorm-ts-node-commonjs migration:run    -d data-source.ts
 *   npx typeorm-ts-node-commonjs migration:revert -d data-source.ts
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'mysql',
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || '',
  charset:  'utf8mb4',
  timezone: '+00:00',

  // Entity paths (not used by migrations, but needed for migration:generate)
  entities: ['src/**/*.entity{.ts,.js}'],

  // Migration paths
  migrations: ['src/migrations/*{.ts,.js}'],

  // Never auto-sync when running migrations
  synchronize: false,
  logging:     true,
});
