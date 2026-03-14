import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

// ── Timezone — Central Africa Time (CAT / UTC+2, Zimbabwe) ───────────────────
// Must be set before any async work so that new Date() local-time calls,
// date-fns helpers, and audit log timestamps all display in CAT.
// Prefer the OS/container TZ env var; fall back to Africa/Harare.
process.env.TZ = process.env.TZ ?? 'Africa/Harare';

/**
 * Bootstrap the NestJS application
 * Configures global settings, CORS, validation, and logging
 */
async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create NestJS application
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // Get configuration service
  const configService = app.get(ConfigService);

  // Get configuration values
  const port = configService.get<number>('app.port', 3000);
  const corsEnabled = configService.get<boolean>('app.corsEnabled', true);
  const corsOrigin = configService.get<string[]>('app.corsOrigin', ['http://localhost:3000']);

  // ── Versioning ─────────────────────────────────────────────────────────────
  // URI versioning: /api/v1/... , /api/v2/... etc.
  // Controllers decorated with @Version('v1') resolve at /api/v1/<path>.
  // Controllers WITHOUT @Version() use defaultVersion 'v1' so existing routes
  // are unaffected by this change (they continue to respond at /api/v1/...).
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: 'v1',
    prefix: false,           // version string already includes 'v' → /api/v1/...
  });

  // Enable CORS
  // corsOrigin may arrive as a string[] from app.config or as a single comma-
  // separated string from an env override. Normalise to a clean string[].
  if (corsEnabled) {
    const rawOrigins: string | string[] = corsOrigin as any;
    const origins: string[] = (Array.isArray(rawOrigins)
      ? rawOrigins
      : (rawOrigins ?? '').split(',')
    ).map(o => o.trim()).filter(Boolean);

    app.enableCors({
      origin: origins.length === 1 ? origins[0] : origins,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: 'Content-Type, Accept, Authorization, X-Requested-With, Idempotency-Key',
    });
    logger.log(`CORS allowed origins: ${origins.join(', ')}`);
  }

  // Global validation pipe
  // Note: enableImplicitConversion is intentionally NOT set — it converts any
  // non-empty string to Boolean("string") = true, which breaks boolean query
  // params like `isActive=false`. All conversions use explicit @Transform decorators.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Start the application
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}/api/v1`);
  logger.log(`Environment: ${configService.get('app.nodeEnv')}`);
  logger.log(`Database: ${configService.get('database.database')}`);
  logger.log(`Timezone: ${process.env.TZ} (${new Date().toLocaleTimeString('en-ZW', { timeZoneName: 'short' })})`);
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
