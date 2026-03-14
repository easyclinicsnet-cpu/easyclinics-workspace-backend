import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Consultation } from './entities/consultation.entity';
import { ConsultationCollaborator } from './entities/consultation-collaborator.entity';
import { ConsultationJoinRequest } from './entities/consultation-join-request.entity';
import { Patient } from '../patients/entities/patient.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { Prescription } from '../care-notes/entities/prescription.entity';
import { CareNote } from '../care-notes/entities/care-note.entity';
import { CareNoteTimeline } from '../care-notes/entities/care-note-timeline.entity';

// Controllers
import { ConsultationsController }           from './controllers/consultations.controller';
import { ConsultationCollaborationController } from './controllers/consultation-collaboration.controller';
import { ConsultationJoinRequestController }  from './controllers/consultation-join-request.controller';

// Repositories
import {
  ConsultationRepository,
  ConsultationCollaboratorRepository,
  ConsultationJoinRequestRepository,
} from './repositories';

// Services
import {
  ConsultationsService,
  ConsultationCollaborationService,
  ConsultationJoinRequestService,
  ConsultationAuthService,
} from './services';

// Modules
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { LoggerService } from '../../common/logger/logger.service';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { Aes256Module } from '../../common/security/encryption/aes-256.module';
import { Aes256Service } from '../../common/security/encryption/aes-256.service';
import { SecurityModule } from '../../common/security/security.module';

/**
 * Consultations Domain Module
 * Handles medical consultation sessions and collaboration
 *
 * Features:
 * - Full CRUD for consultations
 * - Collaborator management
 * - Join request lifecycle
 * - Multi-tenancy enforcement
 * - HIPAA-compliant audit logging
 * - Winston logging throughout
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Consultation,
      ConsultationCollaborator,
      ConsultationJoinRequest,
      Patient,
      Appointment,
      Prescription,
      CareNote,
      CareNoteTimeline,
    ]),
    DatabaseModule,
    LoggerModule,
    SecurityModule,
    AuditModule,
    BillingModule,
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
    ConsultationsController,
    ConsultationCollaborationController,
    ConsultationJoinRequestController,
  ],
  providers: [
    // Repositories with factory pattern for EncryptedRepository
    {
      provide: ConsultationRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, logger: LoggerService) => {
        return new ConsultationRepository(dataSource, aesService, logger);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: ConsultationCollaboratorRepository,
      useFactory: (dataSource: DataSource, logger: LoggerService) => {
        return new ConsultationCollaboratorRepository(dataSource, logger);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: ConsultationJoinRequestRepository,
      useFactory: (dataSource: DataSource, logger: LoggerService) => {
        return new ConsultationJoinRequestRepository(dataSource, logger);
      },
      inject: [DataSource, LoggerService],
    },

    // Services
    ConsultationsService,
    ConsultationCollaborationService,
    ConsultationJoinRequestService,
    ConsultationAuthService,
  ],
  exports: [
    TypeOrmModule,
    ConsultationRepository,
    ConsultationCollaboratorRepository,
    ConsultationJoinRequestRepository,
    ConsultationsService,
    ConsultationCollaborationService,
    ConsultationJoinRequestService,
    ConsultationAuthService,
  ],
})
export class ConsultationsModule {}
