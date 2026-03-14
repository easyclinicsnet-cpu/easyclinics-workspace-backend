import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';

// Entities
import { AuditLog } from './entities/audit-log.entity';
import { AuditContext } from './entities/audit-context.entity';
import { NoteAuditLog } from './entities/note-audit-log.entity';

// Controllers
import { AuditLogController }     from './controllers/audit-log.controller';
import { AuditContextController } from './controllers/audit-context.controller';
import { NoteAuditController }    from './controllers/note-audit.controller';

// Services
import { AuditLogService } from './services/audit-log.service';
import { AuditContextService } from './services/audit-context.service';
import { NoteAuditService } from './services/note-audit.service';

// Repositories
import { AuditLogRepository } from './repositories/audit-log.repository';
import { AuditContextRepository } from './repositories/audit-context.repository';
import { NoteAuditLogRepository } from './repositories/note-audit-log.repository';

// Common modules
import { LoggerModule } from '../../common/logger/logger.module';
import { LoggerService } from '../../common/logger/logger.service';
import { DatabaseModule } from '../../common/database/database.module';
import { SecurityModule } from '../../common/security/security.module';

/**
 * Audit Domain Module
 * Handles comprehensive audit logging for HIPAA compliance and security tracking
 *
 * Features:
 * - General audit logging with PHI redaction
 * - Audit context tracking for complex operations
 * - Specialized note audit logging for clinical documentation
 * - Multi-tenancy support (workspaceId in all entities)
 * - HIPAA compliance (patient access tracking, justification, immutable logs)
 * - Winston logging throughout
 */
@Module({
  controllers: [AuditLogController, AuditContextController, NoteAuditController],
  imports: [
    TypeOrmModule.forFeature([AuditLog, AuditContext, NoteAuditLog]),
    DatabaseModule,   // Global module with base utilities
    LoggerModule,     // Global module for Winston logging
    ConfigModule,     // For audit configuration
    SecurityModule,   // WorkspaceJwtGuard, RolesGuard, PermissionsGuard, JwtService, CACHE_MANAGER
  ],
  providers: [
    // Services
    AuditLogService,
    AuditContextService,
    NoteAuditService,

    // Repositories with factory pattern (similar to patients module)
    {
      provide: AuditLogRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new AuditLogRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: AuditContextRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new AuditContextRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide: NoteAuditLogRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new NoteAuditLogRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
  ],
  exports: [
    // Export services for use by other domains
    AuditLogService,
    AuditContextService,
    NoteAuditService,

    // Export repositories for advanced use cases
    AuditLogRepository,
    AuditContextRepository,
    NoteAuditLogRepository,

    // Export TypeOrmModule for entity access
    TypeOrmModule,
  ],
})
export class AuditModule {}
