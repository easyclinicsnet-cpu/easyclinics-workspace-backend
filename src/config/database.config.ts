import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'a9fa7d31-7597-45c0-a15c-1ec2eea6ca0b2',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../migrations/*{.ts,.js}'],
    synchronize: process.env.DB_SYNCHRONIZE === 'true' || false,
    logging: process.env.DB_LOGGING === 'true' || false,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    charset: 'utf8mb4',
    timezone: '+00:00',
    extra: {
      connectionLimit: 10,
    },
    retryAttempts: 3,
    retryDelay: 3000,
  }),
);
