import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogRepository } from '../repositories/audit-log.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { CreateAuditLogDto, QueryAuditLogsDto } from '../dto';
import { AuditLog } from '../entities/audit-log.entity';

/**
 * Service for managing audit logs
 * Provides HIPAA-compliant audit logging with PHI redaction
 */
@Injectable()
export class AuditLogService {
  private readonly phiPatterns: RegExp[];
  private readonly retentionDays: number;
  private readonly hipaaMode: boolean;

  constructor(
    private readonly auditLogRepository: AuditLogRepository,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext('AuditLogService');

    // Load configuration
    this.phiPatterns = this.configService.get<RegExp[]>('audit.phiPatterns', [
      /ssn/i,
      /health/i,
      /medical/i,
      /diagnosis/i,
      /prescription/i,
      /password/i,
      /token/i,
    ]);
    this.retentionDays = this.configService.get<number>('audit.retentionDays', 730);
    this.hipaaMode = this.configService.get<boolean>('audit.hipaaMode', true);

    this.logger.log('AuditLogService initialized');
    this.logger.log(`HIPAA Mode: ${this.hipaaMode}`);
    this.logger.log(`Retention Days: ${this.retentionDays}`);
  }

  /**
   * Create an audit log entry with PHI redaction
   * @param dto Audit log data
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created audit log
   */
  async log(dto: CreateAuditLogDto, workspaceId?: string): Promise<AuditLog> {
    try {
      this.logger.log(`Creating audit log for action: ${dto.action || dto.eventType}`);

      // Redact PHI from states
      const previousState = dto.previousState ? this.redactPHI(dto.previousState) : undefined;
      const newState = dto.newState ? this.redactPHI(dto.newState) : undefined;
      const metadata = dto.metadata ? this.redactPHI(dto.metadata) : undefined;

      // Resolve workspace and resource fields (support inline or param)
      const resolvedWorkspaceId = workspaceId || dto.workspaceId || '';
      const resolvedResourceType = dto.resourceType || dto.entityType;
      const resolvedResourceId = dto.resourceId || dto.entityId;

      // Create audit log entity
      const auditLog = this.auditLogRepository.create({
        ...dto,
        workspaceId: resolvedWorkspaceId,
        resourceType: resolvedResourceType,
        resourceId: resolvedResourceId,
        previousState,
        newState,
        metadata,
        timestamp: new Date(),
      });

      // Save to database
      const savedLog = await this.auditLogRepository.save(auditLog);

      this.logger.log(`Audit log created with ID: ${savedLog.id}`);

      return savedLog;
    } catch (error) {
      this.logger.error(`Error creating audit log: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find all audit logs with filtering and pagination
   * @param query Query parameters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated audit logs
   */
  async findAll(query: QueryAuditLogsDto, workspaceId: string): Promise<{ data: AuditLog[]; meta: any }> {
    try {
      this.logger.log(`Finding audit logs for workspace: ${workspaceId}`);

      const result = await this.auditLogRepository.findWithFilters(query, workspaceId);

      this.logger.log(`Found ${result.meta.total} audit logs for workspace: ${workspaceId}`);

      return result;
    } catch (error) {
      this.logger.error(`Error finding audit logs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find audit logs by resource
   * @param resourceType Type of resource
   * @param resourceId ID of the resource
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of audit logs for the resource
   */
  async findByResource(
    resourceType: string,
    resourceId: string,
    workspaceId: string,
  ): Promise<AuditLog[]> {
    try {
      this.logger.log(`Finding audit logs for resource: ${resourceType}/${resourceId}`);

      const logs = await this.auditLogRepository.findByResource(resourceType, resourceId, workspaceId);

      this.logger.log(`Found ${logs.length} audit logs for resource: ${resourceType}/${resourceId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding audit logs by resource: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find audit logs by patient (HIPAA compliance)
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of audit logs for patient access
   */
  async findByPatient(patientId: string, workspaceId: string): Promise<AuditLog[]> {
    try {
      this.logger.log(`Finding audit logs for patient: ${patientId}`);

      const logs = await this.auditLogRepository.findByPatient(patientId, workspaceId);

      this.logger.log(`Found ${logs.length} audit logs for patient: ${patientId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding audit logs by patient: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find audit logs by user with optional date range
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param dateRange Optional date range { startDate, endDate }
   * @returns Array of audit logs for the user
   */
  async findByUser(
    userId: string,
    workspaceId: string,
    dateRange?: { startDate?: Date; endDate?: Date },
  ): Promise<AuditLog[]> {
    try {
      this.logger.log(`Finding audit logs for user: ${userId}`);

      const logs = await this.auditLogRepository.findByUser(
        userId,
        workspaceId,
        dateRange?.startDate,
        dateRange?.endDate,
      );

      this.logger.log(`Found ${logs.length} audit logs for user: ${userId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding audit logs by user: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get audit statistics by event type
   * @param workspaceId Workspace ID for multi-tenancy
   * @param startDate Start date for statistics
   * @param endDate End date for statistics
   * @returns Object with event type counts
   */
  async getStatistics(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Record<string, number>> {
    try {
      this.logger.log(`Getting audit statistics for workspace: ${workspaceId}`);

      const stats = await this.auditLogRepository.countByEventType(workspaceId, startDate, endDate);

      this.logger.log(`Retrieved audit statistics for workspace: ${workspaceId}`);

      return stats;
    } catch (error) {
      this.logger.error(`Error getting audit statistics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find suspicious activity (anomaly detection)
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of suspicious audit logs
   */
  async findSuspiciousActivity(workspaceId: string): Promise<AuditLog[]> {
    try {
      this.logger.log(`Finding suspicious activity for workspace: ${workspaceId}`);

      const logs = await this.auditLogRepository.findSuspiciousActivity(workspaceId);

      if (logs.length > 0) {
        this.logger.warn(`Found ${logs.length} suspicious audit logs for workspace: ${workspaceId}`);
      } else {
        this.logger.log(`No suspicious activity found for workspace: ${workspaceId}`);
      }

      return logs;
    } catch (error) {
      this.logger.error(`Error finding suspicious activity: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Redact PHI from data objects (private method)
   * Recursively traverses objects and redacts fields matching PHI patterns
   * @param data Data to redact
   * @returns Redacted data
   */
  private redactPHI(data: any): any {
    if (!this.hipaaMode) {
      return data;
    }

    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redactPHI(item));
    }

    if (typeof data === 'object') {
      const redacted: any = {};

      for (const [key, value] of Object.entries(data)) {
        // Check if key matches PHI patterns
        const isPHI = this.phiPatterns.some((pattern) => pattern.test(key));

        if (isPHI) {
          redacted[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          redacted[key] = this.redactPHI(value);
        } else {
          redacted[key] = value;
        }
      }

      return redacted;
    }

    return data;
  }

  /**
   * Check retention policy and cleanup old logs (private method)
   * This method should be called periodically by a cron job
   * @param workspaceId Workspace ID for multi-tenancy
   */
  private async checkRetention(workspaceId: string): Promise<void> {
    try {
      this.logger.log(`Checking retention policy for workspace: ${workspaceId}`);

      const retentionDate = new Date();
      retentionDate.setDate(retentionDate.getDate() - this.retentionDays);

      // Note: Actual deletion should be handled by a separate cron job
      // This is just a placeholder for the retention policy check

      this.logger.log(`Retention check completed for workspace: ${workspaceId}`);
    } catch (error) {
      this.logger.error(`Error checking retention policy: ${error.message}`, error.stack);
      throw error;
    }
  }
}
