import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

// Entities
import { Patient } from './entities/patient.entity';
import { Allergy } from './entities/allergy.entity';
import { Vital } from './entities/vital.entity';
import { SocialHistory } from './entities/social-history.entity';
import { PastMedicalHistory } from './entities/past-medical-history.entity';
import { PastSurgicalHistory } from './entities/past-surgical-history.entity';
import { FamilyCondition } from './entities/family-condition.entity';

// Services
import { PatientsService } from './services/patients.service';
import { VitalsService } from './services/vitals.service';
import { AllergiesService } from './services/allergies.service';
import { SocialHistoryService } from './services/social-history.service';
import { MedicalHistoryService } from './services/medical-history.service';
import { SurgicalHistoryService } from './services/surgical-history.service';
import { FamilyConditionsService } from './services/family-conditions.service';
import { PatientHistoryService } from './services/patient-history.service';
import { PatientDashboardService } from './services/patient-dashboard.service';

// Controllers
import { PatientsController } from './controllers/patients.controller';
import { VitalsController } from './controllers/vitals.controller';
import { AllergiesController } from './controllers/allergies.controller';
import { PatientHistoryController } from './controllers/patient-history.controller';
import { PatientDashboardController } from './controllers/patient-dashboard.controller';

// Repositories
import { PatientRepository } from './repositories/patient.repository';
import { VitalRepository } from './repositories/vital.repository';
import { AllergyRepository } from './repositories/allergy.repository';
import { SocialHistoryRepository } from './repositories/social-history.repository';
import { MedicalHistoryRepository } from './repositories/medical-history.repository';
import { SurgicalHistoryRepository } from './repositories/surgical-history.repository';
import { FamilyConditionRepository } from './repositories/family-condition.repository';

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
 * Patients Domain Module
 * Handles all patient-related functionality including:
 * - Patient CRUD operations with full API layer (controllers)
 * - Advanced search with encrypted field support (via EncryptedRepository)
 * - Vital signs, allergies, and all history sub-domains
 * - Patient insurance management
 * - Comprehensive patient dashboard (cross-domain aggregation)
 * - Multi-tenancy support
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Patient,
      Allergy,
      Vital,
      SocialHistory,
      PastMedicalHistory,
      PastSurgicalHistory,
      FamilyCondition,
      // PatientInsurance from billing domain will be added when billing module is integrated
    ]),
    DatabaseModule,   // Global module with EncryptedRepository base class
    LoggerModule,
    AuditModule,      // HIPAA-compliant audit logging
    SecurityModule,   // WorkspaceJwtGuard, RolesGuard, PermissionsGuard
    Aes256Module.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        key: config.getOrThrow<string>('ENCRYPTION_KEY'),
        salt: config.getOrThrow<string>('ENCRYPTION_SALT'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    PatientsController,
    VitalsController,
    AllergiesController,
    PatientHistoryController,
    PatientDashboardController,
  ],
  providers: [
    // Domain services
    PatientsService,
    VitalsService,
    AllergiesService,
    SocialHistoryService,
    MedicalHistoryService,
    SurgicalHistoryService,
    FamilyConditionsService,
    PatientHistoryService,   // Facade over all history sub-services
    PatientDashboardService, // Cross-domain patient dashboard aggregator
    // Repositories (factory pattern for custom injection)
    {
      provide: PatientRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new PatientRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: VitalRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new VitalRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: AllergyRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new AllergyRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: SocialHistoryRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new SocialHistoryRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: MedicalHistoryRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new MedicalHistoryRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: SurgicalHistoryRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new SurgicalHistoryRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: FamilyConditionRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new FamilyConditionRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    // Repository injection for PatientInsurance (billing domain integration)
    // TODO: Update this when billing module is fully integrated
    {
      provide: 'PatientInsurance',
      useFactory: (dataSource: DataSource) => {
        try {
          return dataSource.getRepository('PatientInsurance');
        } catch {
          // Placeholder until billing module is integrated
          return {
            findOne: async () => null,
            save: async (entity: any) => entity,
            create: (entity: any) => entity,
          };
        }
      },
      inject: [DataSource],
    },
  ],
  exports: [
    PatientsService,
    VitalsService,
    AllergiesService,
    SocialHistoryService,
    MedicalHistoryService,
    SurgicalHistoryService,
    FamilyConditionsService,
    PatientHistoryService,
    PatientDashboardService,
    PatientRepository,
    VitalRepository,
    AllergyRepository,
    SocialHistoryRepository,
    MedicalHistoryRepository,
    SurgicalHistoryRepository,
    FamilyConditionRepository,
    TypeOrmModule,
  ],
})
export class PatientsModule {}
