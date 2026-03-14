import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// ─── Insurance Domain Entities ────────────────────────────────────────────────
import { InsuranceProvider }    from './entities/insurance-provider.entity';
import { InsuranceScheme }      from './entities/insurance-scheme.entity';
import { PatientInsurance }     from './entities/patient-insurance.entity';
import { InsuranceContract }    from './entities/insurance-contract.entity';
import { InsuranceClaim }       from './entities/insurance-claim.entity';
import { InsuranceClaimItem }   from './entities/insurance-claim-item.entity';

// ─── Controllers ─────────────────────────────────────────────────────────────
import { InsuranceProviderController } from './controllers/insurance-provider.controller';
import { InsuranceSchemeController }   from './controllers/insurance-scheme.controller';
import { PatientInsuranceController }  from './controllers/patient-insurance.controller';
import { InsuranceContractController } from './controllers/insurance-contract.controller';

// ─── Services ─────────────────────────────────────────────────────────────────
import { InsuranceProviderService }  from './services/insurance-provider.service';
import { InsuranceSchemeService }    from './services/insurance-scheme.service';
import { PatientInsuranceService }   from './services/patient-insurance.service';
import { InsuranceContractService }  from './services/insurance-contract.service';

// ─── Repositories ─────────────────────────────────────────────────────────────
import { InsuranceProviderRepository }  from './repositories/insurance-provider.repository';
import { InsuranceSchemeRepository }    from './repositories/insurance-scheme.repository';
import { PatientInsuranceRepository }   from './repositories/patient-insurance.repository';
import { InsuranceContractRepository }  from './repositories/insurance-contract.repository';

// ─── Common Infrastructure ────────────────────────────────────────────────────
import { LoggerModule }   from '../../common/logger/logger.module';
import { LoggerService }  from '../../common/logger/logger.service';
import { DatabaseModule } from '../../common/database/database.module';
import { SecurityModule } from '../../common/security/security.module';

// ─── Audit Module ─────────────────────────────────────────────────────────────
import { AuditModule } from '../audit/audit.module';

/**
 * Insurance Domain Module
 *
 * Manages insurance providers, schemes, patient coverage, and contracts.
 * Insurance providers, schemes, and contracts are global master data records
 * (not workspace-scoped). Patient insurance records are linked to patients
 * which are workspace-scoped.
 *
 * Architecture:
 * - DDD modular monolith with clean architecture separation
 * - Global master data (providers, schemes, contracts) — no workspaceId filtering
 * - Factory pattern for repository registration
 * - Audit logging via AuditLogService (workspaceId: 'system' for global entities)
 *
 * Cross-Domain Notes:
 * - InsuranceClaim and InsuranceClaimItem entities are defined here but their
 *   business logic is owned by the BillingModule (InsuranceClaimService).
 * - All 6 insurance entities are also registered in BillingModule for direct
 *   repository access by billing services.
 *
 * Routes (all prefixed /api/v1):
 *   /insurance/providers  — CRUD + status management for insurance providers
 *   /insurance/schemes    — CRUD for insurance scheme (plan) master records
 *   /insurance/patient    — Patient insurance enrolment and verification
 *   /insurance/contracts  — Facility–insurer contract management
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      InsuranceProvider,
      InsuranceScheme,
      PatientInsurance,
      InsuranceContract,
      InsuranceClaim,
      InsuranceClaimItem,
    ]),
    DatabaseModule,
    LoggerModule,
    SecurityModule,
    AuditModule,
  ],
  controllers: [
    InsuranceProviderController,
    InsuranceSchemeController,
    PatientInsuranceController,
    InsuranceContractController,
  ],
  providers: [
    // ─── Services ──────────────────────────────────────────────────────────
    InsuranceProviderService,
    InsuranceSchemeService,
    PatientInsuranceService,
    InsuranceContractService,

    // ─── Repository Factories ───────────────────────────────────────────────
    // Each insurance repository extends Repository<T> and requires DataSource
    // and LoggerService in its constructor. We use the factory pattern for
    // consistent repository instantiation across the domain.

    {
      provide:    InsuranceProviderRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new InsuranceProviderRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide:    InsuranceSchemeRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new InsuranceSchemeRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide:    PatientInsuranceRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new PatientInsuranceRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
    {
      provide:    InsuranceContractRepository,
      useFactory: (dataSource: DataSource, loggerService: LoggerService) => {
        return new InsuranceContractRepository(dataSource, loggerService);
      },
      inject: [DataSource, LoggerService],
    },
  ],
  exports: [
    // Export services for use by other domains (e.g., BillingModule)
    InsuranceProviderService,
    InsuranceSchemeService,
    PatientInsuranceService,
    InsuranceContractService,

    // Export repositories for direct access from other domains
    InsuranceProviderRepository,
    InsuranceSchemeRepository,
    PatientInsuranceRepository,
    InsuranceContractRepository,

    // Export TypeOrmModule so other modules can use @InjectRepository
    TypeOrmModule,
  ],
})
export class InsuranceModule {}
