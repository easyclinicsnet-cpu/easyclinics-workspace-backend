import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

// Controllers
import { CareNotesController }          from './controllers/care-notes.controller';
import { NotePermissionsController }     from './controllers/note-permissions.controller';
import { NoteTemplateController }        from './controllers/note-template.controller';
import { NoteTimelineController }        from './controllers/note-timeline.controller';
import { AiNoteController }              from './controllers/ai-note.controller';
import { LettersController }             from './controllers/letters.controller';
import { TranscriptionJobController }    from './controllers/transcription-job.controller';
import { RepeatPrescriptionController } from './controllers/repeat-prescription.controller';
import { SickNoteService }              from './services/sick-note.service';

// Gateways
import { TranscriptionJobGateway }       from './gateways/transcription-job.gateway';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  CareNote,
  Prescription,
  RecordingsTranscript,
  NoteVersion,
  CareNotePermission,
  CareNoteTemplate,
  CareNoteTimeline,
  CareAiNoteSource,
  SickNote,
  ReferralLetter,
  RepeatPrescription,
  TranscriptionJob,
} from './entities';

// Services
import { PrescriptionsService } from './services/prescriptions.service';
import { RepeatPrescriptionsService } from './services/repeat-prescriptions.service';
import { CareNotesService } from './services/care-notes.service';
import { NotePermissionService } from './services/note-permission.service';
import { NoteTemplateService } from './services/note-template.service';
import { NoteVersionService } from './services/note-version.service';
import { NoteTimelineService } from './services/note-timeline.service';
import { AiNoteService } from './services/ai-note.service';
import { LetterGenerationService } from './services/letter-generation.service';
import { LetterAiGenerationService } from './services/letter-ai-generation.service';
import { NoteAuditService } from './services/note-audit.service';
import { NoteAuditService as AuditDomainNoteAuditService } from '../audit/services/note-audit.service';
import { HealthCheckService } from './services/health-check.service';
import { TranscriptionJobService } from './services/transcription-job.service';
import { AiUsageReportingService } from './services/ai-usage-reporting.service';

// AI Strategies
import {
  OpenAiStrategy,
  AnthropicStrategy,
  GeminiStrategy,
  AiStrategyFactory,
} from './strategies';

// Repositories
import { PrescriptionRepository } from './repositories/prescription.repository';
import { RepeatPrescriptionRepository } from './repositories/repeat-prescription.repository';
import { CareNoteRepository } from './repositories/care-note.repository';
import { NotePermissionRepository } from './repositories/note-permission.repository';
import { NoteTemplateRepository } from './repositories/note-template.repository';
import { NoteVersionRepository } from './repositories/note-version.repository';
import { NoteTimelineRepository } from './repositories/note-timeline.repository';
import { RecordingsTranscriptRepository } from './repositories/recordings-transcript.repository';
import { ReferralLetterRepository } from './repositories/referral-letter.repository';
import { SickNoteRepository } from './repositories/sick-note.repository';
import { TranscriptionJobRepository } from './repositories/transcription-job.repository';
import { PatientRepository } from '../patients/repositories/patient.repository';

// Common modules
import { LoggerModule } from '../../common/logger/logger.module';
import { LoggerService } from '../../common/logger/logger.service';
import { Aes256Module } from '../../common/security/encryption/aes-256.module';
import { Aes256Service } from '../../common/security/encryption/aes-256.service';
import { DatabaseModule } from '../../common/database/database.module';
import { FileStorageModule } from '../../common/storage/file-storage.module';
import { AudioProcessor } from '../../common/file-upload/audio-optimizer.service';
import { SecurityModule } from '../../common/security/security.module';

// Audit module
import { AuditModule } from '../audit/audit.module';

// Patients module for PatientRepository
import { PatientsModule } from '../patients/patients.module';

// Notifications module for push notification dispatch
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Care Notes Domain Module
 * Manages medical notes, prescriptions, and documentation
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CareNote,
      Prescription,
      RecordingsTranscript,
      NoteVersion,
      // NoteAuditLog is owned by the audit domain — registered in AuditModule
      CareNotePermission,
      CareNoteTemplate,
      CareNoteTimeline,
      CareAiNoteSource,
      SickNote,
      ReferralLetter,
      RepeatPrescription,
      TranscriptionJob,
    ]),
    ScheduleModule.forRoot(), // Required for HealthCheckService @Cron
    DatabaseModule, // Global module with EncryptedRepository base class
    LoggerModule,
    SecurityModule,
    FileStorageModule, // File storage for audio/documents
    AuditModule, // Audit module for HIPAA compliance
    PatientsModule, // Import for PatientRepository
    NotificationsModule, // Push notifications for background transcription
    HttpModule.register({ timeout: 10000 }), // HTTP client for portal API calls
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
    CareNotesController,
    NotePermissionsController,
    NoteTemplateController,
    NoteTimelineController,
    AiNoteController,
    LettersController,
    TranscriptionJobController,
    RepeatPrescriptionController,
  ],
  providers: [
    // Existing services
    PrescriptionsService,
    RepeatPrescriptionsService,
    SickNoteService,

    // New services
    CareNotesService,
    NotePermissionService,
    NoteTemplateService,
    NoteVersionService,
    NoteTimelineService,
    AiNoteService,
    LetterGenerationService,
    LetterAiGenerationService,
    // NoteAuditService (facade) — delegates to audit domain's NoteAuditService
    {
      provide: NoteAuditService,
      useFactory: (
        auditDomainService: AuditDomainNoteAuditService,
        careNoteRepository: CareNoteRepository,
        permissionRepository: NotePermissionRepository,
        loggerService: LoggerService,
      ) => {
        return new NoteAuditService(
          auditDomainService,
          careNoteRepository,
          permissionRepository,
          loggerService,
        );
      },
      inject: [AuditDomainNoteAuditService, CareNoteRepository, NotePermissionRepository, LoggerService],
    },
    HealthCheckService,
    TranscriptionJobService,
    TranscriptionJobGateway,

    // AI Usage Reporting (portal billing integration)
    AiUsageReportingService,

    // AI Strategies
    AudioProcessor, // Audio processing for transcription
    OpenAiStrategy,
    AnthropicStrategy,
    GeminiStrategy,
    AiStrategyFactory,

    // Existing repositories
    {
      provide: PrescriptionRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new PrescriptionRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: RepeatPrescriptionRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new RepeatPrescriptionRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },

    // New repositories (Encrypted)
    {
      provide: CareNoteRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new CareNoteRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: NoteTemplateRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new NoteTemplateRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: RecordingsTranscriptRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new RecordingsTranscriptRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: ReferralLetterRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new ReferralLetterRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
    {
      provide: SickNoteRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new SickNoteRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },

    // New repositories (Non-encrypted)
    {
      provide: NotePermissionRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new NotePermissionRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: NoteVersionRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new NoteVersionRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: NoteTimelineRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new NoteTimelineRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },

    // Background Transcription repository (encrypted — PHI fields at rest)
    {
      provide: TranscriptionJobRepository,
      useFactory: (dataSource: DataSource, aesService: Aes256Service, loggerService: LoggerService) => {
        return new TranscriptionJobRepository(dataSource, aesService, loggerService);
      },
      inject: [DataSource, Aes256Service, LoggerService],
    },
  ],
  exports: [
    TypeOrmModule,
    // Services
    PrescriptionsService,
    RepeatPrescriptionsService,
    SickNoteService,
    CareNotesService,
    NotePermissionService,
    NoteTemplateService,
    NoteVersionService,
    NoteTimelineService,
    AiNoteService,
    LetterGenerationService,
    LetterAiGenerationService,
    NoteAuditService,
    HealthCheckService,
    TranscriptionJobService,
    TranscriptionJobGateway,
    // Repositories
    PrescriptionRepository,
    RepeatPrescriptionRepository,
    CareNoteRepository,
    NotePermissionRepository,
    NoteTemplateRepository,
    NoteVersionRepository,
    NoteTimelineRepository,
    RecordingsTranscriptRepository,
    ReferralLetterRepository,
    SickNoteRepository,
    TranscriptionJobRepository,
    // AI Strategies
    AiStrategyFactory,
    // AI Usage
    AiUsageReportingService,
  ],
})
export class CareNotesModule {}
