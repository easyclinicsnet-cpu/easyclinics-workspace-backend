import { Injectable } from '@nestjs/common';
import { DataSource, Repository, FindOptionsWhere, Between } from 'typeorm';
import { NoteAuditLog } from '../entities/note-audit-log.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { NoteAuditActionType } from '../../../common/enums';

/**
 * Repository for NoteAuditLog entity
 * Provides methods for tracking clinical note modifications and AI interactions
 */
@Injectable()
export class NoteAuditLogRepository extends Repository<NoteAuditLog> {
  constructor(
    private dataSource: DataSource,
    private logger: LoggerService,
  ) {
    super(NoteAuditLog, dataSource.createEntityManager());
    this.logger.setContext('NoteAuditLogRepository');
  }

  /**
   * Find note audit logs by note ID with pagination
   * @param noteId Note ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number (default: 1)
   * @param limit Items per page (default: 20)
   * @returns Paginated note audit logs with metadata
   */
  async findByNote(
    noteId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: NoteAuditLog[]; meta: any }> {
    try {
      this.logger.log(`Finding note audit logs for note: ${noteId}`);

      const skip = (page - 1) * limit;

      const [data, total] = await this.findAndCount({
        where: {
          workspaceId,
          noteId,
        },
        order: {
          createdAt: 'DESC',
        },
        skip,
        take: limit,
      });

      const meta = {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };

      this.logger.log(`Found ${total} note audit logs for note: ${noteId}`);

      return { data, meta };
    } catch (error) {
      this.logger.error(`Error finding note audit logs by note: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find note audit logs by user with optional date range
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param startDate Optional start date
   * @param endDate Optional end date
   * @returns Array of note audit logs for the user
   */
  async findByUser(
    userId: string,
    workspaceId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<NoteAuditLog[]> {
    try {
      this.logger.log(`Finding note audit logs for user: ${userId}`);

      const where: FindOptionsWhere<NoteAuditLog> = {
        workspaceId,
        userId,
      };

      if (startDate || endDate) {
        const start = startDate || new Date(0);
        const end = endDate || new Date();
        where.createdAt = Between(start, end) as any;
      }

      const logs = await this.find({
        where,
        order: {
          createdAt: 'DESC',
        },
      });

      this.logger.log(`Found ${logs.length} note audit logs for user: ${userId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding note audit logs by user: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find note audit logs by action type
   * @param actionType Action type
   * @param workspaceId Workspace ID for multi-tenancy
   * @param limit Optional limit (default: 100)
   * @returns Array of note audit logs with the given action type
   */
  async findByActionType(
    actionType: NoteAuditActionType,
    workspaceId: string,
    limit: number = 100,
  ): Promise<NoteAuditLog[]> {
    try {
      this.logger.log(`Finding note audit logs with action type: ${actionType}`);

      const logs = await this.find({
        where: {
          workspaceId,
          actionType,
        },
        order: {
          createdAt: 'DESC',
        },
        take: limit,
      });

      this.logger.log(`Found ${logs.length} note audit logs with action type: ${actionType}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding note audit logs by action type: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find note audit logs by patient
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of note audit logs for the patient
   */
  async findByPatient(patientId: string, workspaceId: string): Promise<NoteAuditLog[]> {
    try {
      this.logger.log(`Finding note audit logs for patient: ${patientId}`);

      const logs = await this.find({
        where: {
          workspaceId,
          patientId,
        },
        order: {
          createdAt: 'DESC',
        },
      });

      this.logger.log(`Found ${logs.length} note audit logs for patient: ${patientId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding note audit logs by patient: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Retrieve the hash of the most recent audit log entry for a given note.
   * Returns 'GENESIS' when no prior log exists (first entry in the chain).
   *
   * @param noteId      Note ID
   * @param workspaceId Workspace ID for tenant isolation
   * @returns Hash string of the previous record, or 'GENESIS'
   */
  async getLatestHashForNote(noteId: string, workspaceId: string): Promise<string> {
    try {
      const latest = await this.findOne({
        where: { noteId, workspaceId },
        order: { createdAt: 'DESC' },
        select: ['hash'],
      });

      return latest?.hash ?? 'GENESIS';
    } catch (error) {
      this.logger.error(
        `Error retrieving latest hash for note ${noteId}: ${error.message}`,
        error.stack,
      );
      return 'GENESIS';
    }
  }

  /**
   * Find AI-related note audit logs
   * @param workspaceId Workspace ID for multi-tenancy
   * @param startDate Optional start date
   * @param endDate Optional end date
   * @returns Array of AI-related note audit logs
   */
  async findAIRelatedLogs(
    workspaceId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<NoteAuditLog[]> {
    try {
      this.logger.log(`Finding AI-related note audit logs for workspace: ${workspaceId}`);

      const queryBuilder = this.createQueryBuilder('note_audit_log')
        .where('note_audit_log.workspaceId = :workspaceId', { workspaceId })
        .andWhere('note_audit_log.actionType IN (:...actionTypes)', {
          actionTypes: [
            NoteAuditActionType.AI_GENERATE,
            NoteAuditActionType.AI_APPROVE,
            NoteAuditActionType.AI_REJECT,
          ],
        })
        .orderBy('note_audit_log.createdAt', 'DESC');

      if (startDate || endDate) {
        const start = startDate || new Date(0);
        const end = endDate || new Date();
        queryBuilder.andWhere('note_audit_log.createdAt BETWEEN :start AND :end', {
          start,
          end,
        });
      }

      const logs = await queryBuilder.getMany();

      this.logger.log(`Found ${logs.length} AI-related note audit logs for workspace: ${workspaceId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error finding AI-related note audit logs: ${error.message}`, error.stack);
      throw error;
    }
  }
}
