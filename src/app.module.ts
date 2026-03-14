import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Configuration
import { appConfig, auditConfig, databaseConfig, encryptionConfig, jwtConfig } from './config';

// Domain Modules
import { PatientsModule } from './domains/patients/patients.module';
import { AppointmentsModule } from './domains/appointments/appointments.module';
import { ConsultationsModule } from './domains/consultations/consultations.module';
import { InventoryModule } from './domains/inventory/inventory.module';
import { BillingModule } from './domains/billing/billing.module';
import { InsuranceModule } from './domains/insurance/insurance.module';
import { CareNotesModule } from './domains/care-notes/care-notes.module';
import { NotificationsModule } from './domains/notifications/notifications.module';
import { AuditModule } from './domains/audit/audit.module';

// Load .env files early (falls back gracefully if no file exists).
// On Plesk/Passenger, environment variables are injected into process.env
// directly, so this is a no-op on production servers without .env files.
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

/**
 * Root Application Module
 * Configures the entire application following Domain-Driven Design principles
 */
@Module({
  imports: [
    // Global configuration — reads process.env (Plesk/Passenger vars) + .env files
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, auditConfig, databaseConfig, encryptionConfig, jwtConfig],
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),

    // Database configuration
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...configService.get('database'),
      }),
    }),

    // Domain modules (feature-first organization)
    PatientsModule,
    AppointmentsModule,
    ConsultationsModule,
    InventoryModule,
    BillingModule,
    InsuranceModule,
    CareNotesModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
