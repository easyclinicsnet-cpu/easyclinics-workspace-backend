import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EncryptionInterceptor } from './interceptors';
import { TenantSchemaGuard } from './guards';
import { SecurityModule } from '../security/security.module';
import { LoggerModule } from '../logger/logger.module';

/**
 * Global Database Module
 *
 * Provides enterprise-grade database utilities:
 * - EncryptedRepository: Base repository with automatic encryption/decryption
 * - EncryptionInterceptor: HTTP-level encryption (placeholder for future implementation)
 * - TenantSchemaGuard: Multi-tenancy workspace isolation
 *
 * This module is marked as @Global, making its exports available
 * throughout the application without explicit imports.
 *
 * Dependencies:
 * - SecurityModule: Provides AES-256 encryption service
 * - LoggerModule: Provides Winston logging service
 * - ConfigModule: Provides configuration service
 *
 * @example
 * ```typescript
 * // No need to import DatabaseModule in feature modules
 * // Just extend EncryptedRepository in your repository
 *
 * @Injectable()
 * export class PatientRepository extends EncryptedRepository<Patient> {
 *   constructor(
 *     dataSource: DataSource,
 *     aesService: Aes256Service,
 *     logger: LoggerService,
 *   ) {
 *     super(Patient, dataSource, aesService, logger);
 *     this.logger.setContext('PatientRepository');
 *   }
 *
 *   protected getSearchableEncryptedFields(): string[] {
 *     return ['firstName', 'lastName', 'email', 'phone'];
 *   }
 *
 *   protected getSearchFilters(): Partial<FindOptionsWhere<Patient>> {
 *     return { isDeleted: false };
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Use TenantSchemaGuard in controllers
 * @UseGuards(TenantSchemaGuard)
 * @Controller('patients')
 * export class PatientsController {
 *   // All routes automatically validated for workspace context
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Use EncryptionInterceptor in controllers (future)
 * @UseInterceptors(EncryptionInterceptor)
 * @Post('sensitive-data')
 * async handleSensitive(@Body() data: SensitiveDto) {
 *   // Request/response will be encrypted
 * }
 * ```
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    SecurityModule,
    LoggerModule,
  ],
  providers: [
    EncryptionInterceptor,
    TenantSchemaGuard,
  ],
  exports: [
    EncryptionInterceptor,
    TenantSchemaGuard,
  ],
})
export class DatabaseModule {}
