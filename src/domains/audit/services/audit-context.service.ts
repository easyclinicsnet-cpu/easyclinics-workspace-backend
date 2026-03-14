import { Injectable } from '@nestjs/common';
import { AuditContextRepository } from '../repositories/audit-context.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { CreateAuditContextDto } from '../dto';
import { AuditContext } from '../entities/audit-context.entity';
import { AuditContextStatus } from '../../../common/enums';

/**
 * Service for managing audit contexts
 * Provides transaction tracking and complex operation auditing
 */
@Injectable()
export class AuditContextService {
  constructor(
    private readonly auditContextRepository: AuditContextRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('AuditContextService');
    this.logger.log('AuditContextService initialized');
  }

  /**
   * Create an audit context for tracking complex operations
   * @param dto Audit context data
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created audit context
   */
  async createContext(dto: CreateAuditContextDto, workspaceId: string): Promise<AuditContext> {
    try {
      this.logger.log(`Creating audit context for action: ${dto.actionType}`);

      // Create audit context entity
      const context = this.auditContextRepository.create({
        ...dto,
        workspaceId,
        status: AuditContextStatus.PENDING,
      });

      // Save to database
      const savedContext = await this.auditContextRepository.save(context);

      this.logger.log(`Audit context created with ID: ${savedContext.id}, contextId: ${savedContext.contextId}`);

      return savedContext;
    } catch (error) {
      this.logger.error(`Error creating audit context: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Capture entity state in the audit context
   * @param contextId Context ID (UUID)
   * @param state Entity state to capture
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated audit context
   */
  async captureState(
    contextId: string,
    state: Record<string, any>,
    workspaceId: string,
  ): Promise<AuditContext> {
    try {
      this.logger.log(`Capturing state for context: ${contextId}`);

      // Find the context
      const context = await this.auditContextRepository.findByContextId(contextId, workspaceId);

      if (!context) {
        const error = `Audit context not found: ${contextId}`;
        this.logger.error(error);
        throw new Error(error);
      }

      // Capture the state
      context.captureState(state);

      // Save the updated context
      const updatedContext = await this.auditContextRepository.save(context);

      this.logger.log(`State captured for context: ${contextId}`);

      return updatedContext;
    } catch (error) {
      this.logger.error(`Error capturing state: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Mark an audit context as completed
   * @param contextId Context ID (UUID)
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated audit context
   */
  async markCompleted(contextId: string, workspaceId: string): Promise<AuditContext> {
    try {
      this.logger.log(`Marking context as completed: ${contextId}`);

      // Find the context
      const context = await this.auditContextRepository.findByContextId(contextId, workspaceId);

      if (!context) {
        const error = `Audit context not found: ${contextId}`;
        this.logger.error(error);
        throw new Error(error);
      }

      // Mark as completed
      context.markCompleted();

      // Save the updated context
      const updatedContext = await this.auditContextRepository.save(context);

      this.logger.log(`Context marked as completed: ${contextId}`);

      return updatedContext;
    } catch (error) {
      this.logger.error(`Error marking context as completed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Mark an audit context as failed
   * @param contextId Context ID (UUID)
   * @param reason Failure reason
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated audit context
   */
  async markFailed(contextId: string, reason: string, workspaceId: string): Promise<AuditContext> {
    try {
      this.logger.log(`Marking context as failed: ${contextId}`);

      // Find the context
      const context = await this.auditContextRepository.findByContextId(contextId, workspaceId);

      if (!context) {
        const error = `Audit context not found: ${contextId}`;
        this.logger.error(error);
        throw new Error(error);
      }

      // Mark as failed
      context.markFailed(reason);

      // Save the updated context
      const updatedContext = await this.auditContextRepository.save(context);

      this.logger.error(`Context marked as failed: ${contextId}, reason: ${reason}`);

      return updatedContext;
    } catch (error) {
      this.logger.error(`Error marking context as failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find audit contexts by entity
   * @param entityType Type of entity
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

      const contexts = await this.auditContextRepository.findByEntity(entityType, entityId, workspaceId);

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

      const contexts = await this.auditContextRepository.findByStatus(status, workspaceId);

      this.logger.log(`Found ${contexts.length} audit contexts with status: ${status}`);

      return contexts;
    } catch (error) {
      this.logger.error(`Error finding audit contexts by status: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find pending audit contexts (for monitoring)
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of pending audit contexts
   */
  async findPendingContexts(workspaceId: string): Promise<AuditContext[]> {
    try {
      this.logger.log(`Finding pending audit contexts for workspace: ${workspaceId}`);

      const contexts = await this.auditContextRepository.findPendingContexts(workspaceId);

      if (contexts.length > 0) {
        this.logger.warn(`Found ${contexts.length} pending audit contexts for workspace: ${workspaceId}`);
      } else {
        this.logger.log(`No pending audit contexts for workspace: ${workspaceId}`);
      }

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

      const contexts = await this.auditContextRepository.findByUser(userId, workspaceId);

      this.logger.log(`Found ${contexts.length} audit contexts for user: ${userId}`);

      return contexts;
    } catch (error) {
      this.logger.error(`Error finding audit contexts by user: ${error.message}`, error.stack);
      throw error;
    }
  }
}
