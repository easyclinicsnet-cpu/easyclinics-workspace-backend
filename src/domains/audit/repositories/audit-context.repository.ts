import { Injectable } from '@nestjs/common';
import { DataSource, Repository, FindOptionsWhere } from 'typeorm';
import { AuditContext } from '../entities/audit-context.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditContextStatus } from '../../../common/enums';

/**
 * Repository for AuditContext entity
 * Provides methods for tracking complex operations and transactions
 */
@Injectable()
export class AuditContextRepository extends Repository<AuditContext> {
  constructor(
    private dataSource: DataSource,
    private logger: LoggerService,
  ) {
    super(AuditContext, dataSource.createEntityManager());
    this.logger.setContext('AuditContextRepository');
  }

  /**
   * Find audit context by context ID
   * @param contextId Context ID (UUID)
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Audit context or null
   */
  async findByContextId(contextId: string, workspaceId: string): Promise<AuditContext | null> {
    try {
      this.logger.log(`Finding audit context by contextId: ${contextId}`);

      const context = await this.findOne({
        where: {
          workspaceId,
          contextId,
        },
      });

      if (context) {
        this.logger.log(`Found audit context: ${contextId}`);
      } else {
        this.logger.log(`Audit context not found: ${contextId}`);
      }

      return context;
    } catch (error) {
      this.logger.error(`Error finding audit context by contextId: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find audit contexts by entity
   * @param entityType Type of entity (e.g., "Patient", "Appointment")
   * @param entityId ID of the entity
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of audit contexts for the entity
   */
  async findByEntity(
    entityType: string,
    entityId: string,
    workspaceId: string,
  ): Promise<AuditContext[]> {
    try {
      this.logger.log(`Finding audit contexts for entity: ${entityType}/${entityId}`);

      const contexts = await this.find({
        where: {
          workspaceId,
          entityType,
          entityId,
        },
        order: {
          createdAt: 'DESC',
        },
      });

      this.logger.log(`Found ${contexts.length} audit contexts for entity: ${entityType}/${entityId}`);

      return contexts;
    } catch (error) {
      this.logger.error(`Error finding audit contexts by entity: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find audit contexts by status
   * @param status Context status
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of audit contexts with the given status
   */
  async findByStatus(status: AuditContextStatus, workspaceId: string): Promise<AuditContext[]> {
    try {
      this.logger.log(`Finding audit contexts with status: ${status}`);

      const contexts = await this.find({
        where: {
          workspaceId,
          status,
        },
        order: {
          createdAt: 'DESC',
        },
      });

      this.logger.log(`Found ${contexts.length} audit contexts with status: ${status}`);

      return contexts;
    } catch (error) {
      this.logger.error(`Error finding audit contexts by status: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find pending audit contexts (for cleanup or monitoring)
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of pending audit contexts
   */
  async findPendingContexts(workspaceId: string): Promise<AuditContext[]> {
    try {
      this.logger.log(`Finding pending audit contexts for workspace: ${workspaceId}`);

      const contexts = await this.find({
        where: {
          workspaceId,
          status: AuditContextStatus.PENDING,
        },
        order: {
          createdAt: 'ASC', // Oldest first
        },
      });

      this.logger.log(`Found ${contexts.length} pending audit contexts for workspace: ${workspaceId}`);

      return contexts;
    } catch (error) {
      this.logger.error(`Error finding pending audit contexts: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find audit contexts by user
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of audit contexts for the user
   */
  async findByUser(userId: string, workspaceId: string): Promise<AuditContext[]> {
    try {
      this.logger.log(`Finding audit contexts for user: ${userId}`);

      const contexts = await this.find({
        where: {
          workspaceId,
          userId,
        },
        order: {
          createdAt: 'DESC',
        },
      });

      this.logger.log(`Found ${contexts.length} audit contexts for user: ${userId}`);

      return contexts;
    } catch (error) {
      this.logger.error(`Error finding audit contexts by user: ${error.message}`, error.stack);
      throw error;
    }
  }
}
