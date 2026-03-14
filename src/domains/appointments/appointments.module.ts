import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

// Entities
import { Appointment } from './entities/appointment.entity';
import { Patient } from '../patients/entities/patient.entity';
import { Consultation } from '../consultations/entities/consultation.entity';
import { PatientInsurance } from '../insurance/entities/patient-insurance.entity';
import { Prescription } from '../care-notes/entities/prescription.entity';
import { PatientBill } from '../billing/entities/patient-bill.entity';
import { ConsumablePartialUsage } from '../inventory/entities/consumable-partial-usage.entity';
import { MedicationPartialSale } from '../inventory/entities/medication-partial-sale.entity';

// Services
import { AppointmentsService } from './services/appointments.service';

// Controllers
import { AppointmentsController } from './controllers/appointments.controller';

// Repositories
import { AppointmentRepository } from './repositories/appointment.repository';

// Common modules
import { LoggerModule } from '../../common/logger/logger.module';
import { LoggerService } from '../../common/logger/logger.service';
import { Aes256Module } from '../../common/security/encryption/aes-256.module';
import { Aes256Service } from '../../common/security/encryption/aes-256.service';
import { DatabaseModule } from '../../common/database/database.module';
import { SecurityModule } from '../../common/security/security.module';

// Audit module
import { AuditModule } from '../audit/audit.module';

/**
 * Appointments Domain Module
 * Handles all appointment-related functionality including:
 * - Appointment CRUD operations
 * - Advanced search with encrypted field support (via EncryptedRepository)
 * - Encrypted field handling with caching and fuzzy matching
 * - Patient insurance management integration
 * - Multi-tenancy support via workspaceId
 * - Appointment status transitions
 * - Consultation synchronization
 *
 * Business Logic:
 * - Insurance validation when paymentMethod = INSURANCE
 * - Patient insurance creation/update logic
 * - Appointment status transitions (SCHEDULED → COMPLETED, CANCELLED)
 * - Consultation status synchronization
 * - Transaction handling for atomic operations
 * - Encrypted search with caching
 * - Batch processing for large datasets
 *
 * API Layer:
 * AppointmentsController (v1) exposes REST endpoints at /api/v1/appointments.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      // Core appointment entities
      Appointment,

      // Related domain entities
      Patient,
      Consultation,
      PatientInsurance,
      Prescription,
      PatientBill,
      ConsumablePartialUsage,
      MedicationPartialSale,
    ]),
    DatabaseModule, // Global module with EncryptedRepository base class
    LoggerModule,
    SecurityModule,
    AuditModule, // Audit module for HIPAA compliance
    Aes256Module.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        key: config.getOrThrow<string>('ENCRYPTION_KEY'),
        salt: config.getOrThrow<string>('ENCRYPTION_SALT'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    {
      provide: AppointmentRepository,
      useFactory: (
        dataSource: DataSource,
        aesService: Aes256Service,
        loggerService: LoggerService,
      ) => {
        return new AppointmentRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
  ],
  exports: [AppointmentsService, AppointmentRepository, TypeOrmModule],
})
export class AppointmentsModule {}
