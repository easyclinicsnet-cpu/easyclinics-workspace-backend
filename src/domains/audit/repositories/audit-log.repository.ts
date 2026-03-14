import { Injectable } from '@nestjs/common';
import { DataSource, Repository, FindOptionsWhere, Between, Like, In } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { QueryAuditLogsDto } from '../dto';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

/**
 * Repository for AuditLog entity
 * Provides complex filtering, querying, and statistics for audit logs
 * Note: Does NOT extend EncryptedRepository as audit logs use PHI redaction instead
 */
@Injectable()
export class AuditLogRepository extends Repository<AuditLog> {
  constructor(
    private dataSource: DataSource,
    private logger: LoggerService,
  ) {
    super(AuditLog, dataSource.createEntityManager());
    this.logger.setContext('AuditLogRepository');
  }

  /**
   * Find audit logs with complex filtering
   * @param query Query parameters with pagination and filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated audit logs with metadata
   */
  async findWithFilters(
    query: QueryAuditLogsDto,
    workspaceId: string,
  ): Promise<{ data: AuditLog[]; meta: any }> {
    try {
      this.logger.log(`Finding audit logs with filters for workspace: ${workspaceId}`);

      const {
        page = 1,
        limit = 20,
        userId,
        eventType,
        outcome,
        resourceType,
        resourceId,
        patientId,
        startDate,
        endDate,
        search,
        sortBy = 'timestamp',
        sortOrder: sortDirection = 'DESC',
      } = query;

      const skip = (page - 1) * limit;

      // Build where clause
      const where: FindOptionsWhere<AuditLog> = {
        workspaceId,
      };

      if (userId) where.userId = userId;
      if (eventType) where.eventType = eventType;
      if (outcome) where.outcome = outcome;
      if (resourceType) where.resourceType = resourceType;
      if (resourceId) where.resourceId = resourceId;
      if (patientId) where.patientId = patientId;

      // Date range filtering
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : new Date(0);
        const end = endDate ? new Date(endDate) : new Date();
        where.timestamp = Between(start, end) as any;
      }

      // Build query
      const queryBuilder = this.createQueryBuilder('audit_log')
        .where(where)
        .skip(skip)
        .take(limit)
        .orderBy(`audit_log.${sortBy}`, sortDirection);

      // Add search if provided
      if (search) {
        queryBuilder.andWhere(
          '(audit_log.action LIKE :search OR audit_log.resourceType LIKE :search)',
          { search: `%${search}%` },
        );
      }

      const [data, total] = await queryBuilder.getManyAndCount();

      const meta = {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };

      this.logger.log(`Found ${total} audit logs for workspace: ${workspaceId}`);

      return { data, meta };
    } catch (error) {
      this.logger.error(`Error finding audit logs with filters: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find audit logs by resource
   * @param resourceType Type of resource (e.g., "Patient", "Appointment")
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

      const logs = await this.find({
        where: {
          workspaceId,
          resourceType,
          resourceId,
        },
        order: {
          timestamp: 'DESC',
        },
      });

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

      const logs = await this.find({
        where: {
          workspaceId,
          patientId,
        },
        order: {
          timestamp: 'DESC',
        },
      });

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
   * @param startDate Optional start date
   * @param endDate Optional end date
   * @returns Array of audit logs for the user
   */
  async findByUser(
    userId: string,
    workspaceId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<AuditLog[]> {
    try {
      this.logger.log(`Finding audit logs for user: ${userId}`);

      const where: FindOptionsWhere<AuditLog> = {
        workspaceId,
        userId,
      };

      if (startDate || endDate) {
        const start = startDate || new Date(0);
        const end = endDate || new Date();
        where.timestamp = Between(start, end) as any;
      }

      const logs = await this.find({
        where,
        order: {
          timestamp: 'DESC',
        },
      });

      this.logger.log(`Found ${logs.length} audit logs for user: ${userId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding audit logs by user: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Count audit logs by event type (for statistics)
   * @param workspaceId Workspace ID for multi-tenancy
   * @param startDate Start date for the count
   * @param endDate End date for the count
   * @returns Object with event type counts
   */
  async countByEventType(
    workspaceId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Record<string, number>> {
    try {
      this.logger.log(`Counting audit logs by event type for workspace: ${workspaceId}`);

      const results = await this.createQueryBuilder('audit_log')
        .select('audit_log.eventType', 'eventType')
        .addSelect('COUNT(*)', 'count')
        .where({
          workspaceId,
          timestamp: Between(startDate, endDate) as any,
        })
        .groupBy('audit_log.eventType')
        .getRawMany();

      const counts: Record<string, number> = {};
      results.forEach((result) => {
        counts[result.eventType] = parseInt(result.count, 10);
      });

      this.logger.log(`Counted ${results.length} event types for workspace: ${workspaceId}`);

      return counts;
    } catch (error) {
      this.logger.error(`Error counting audit logs by event type: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find suspicious activity (multiple failures, unusual patterns)
   * Helper method for anomaly detection
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of audit logs with suspicious patterns
   */
  async findSuspiciousActivity(workspaceId: string): Promise<AuditLog[]> {
    try {
      this.logger.log(`Finding suspicious activity for workspace: ${workspaceId}`);

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Find users with multiple failures in the last hour
      const logs = await this.find({
        where: {
          workspaceId,
          outcome: AuditOutcome.FAILURE,
          timestamp: Between(oneHourAgo, new Date()) as any,
        },
        order: {
          timestamp: 'DESC',
        },
      });

      this.logger.log(`Found ${logs.length} suspicious audit logs for workspace: ${workspaceId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding suspicious activity: ${error.message}`, error.stack);
      throw error;
    }
  }
}
