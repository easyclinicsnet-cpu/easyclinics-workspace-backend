import { IsNull } from 'typeorm';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { CareNoteRepository } from '../repositories/care-note.repository';
import { NotePermissionRepository } from '../repositories/note-permission.repository';
import {
  NoteAuditLogQueryDto,
  NoteAuditLogResponseDto,
  PaginatedResponseDto,
} from '../dto';
import { PermissionLevel, NoteAuditActionType } from '../../../common/enums';
import { NoteAuditService as AuditDomainNoteAuditService } from '../../audit/services/note-audit.service';
import { NoteAuditLog } from '../../audit/entities/note-audit-log.entity';

/**
 * Care-Notes NoteAuditService (Facade)
 *
 * DDD Boundary: This service lives in the care-notes bounded context and acts
 * as a thin facade over the audit domain's NoteAuditService. It adds:
 *   - Care-note permission checks (author / ADMIN) for reads
 *   - Mapping from audit domain entities to care-notes DTOs
 *
 * All write operations are delegated directly to the audit domain service
 * which owns the NoteAuditLog entity and table.
 */
@Injectable()
export class NoteAuditService {
  constructor(
    private readonly auditDomainService: AuditDomainNoteAuditService,
    private readonly careNoteRepository: CareNoteRepository,
    private readonly permissionRepository: NotePermissionRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('CareNotes:NoteAuditService');
  }

  // ─── READ OPERATIONS (with care-notes permission checks) ───────────

  /**
   * Find audit logs for a specific note.
   * Only the note author or users with ADMIN permission can view audit logs.
   *
   * @param noteId - Care note ID
   * @param userId - Authenticated user requesting access
   * @param workspaceId - Tenant workspace ID
   * @param page - Page number (1-based)
   * @param limit - Items per page
   * @returns Paginated audit log response DTOs
   */
  async findByNote(
    noteId: string,
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedResponseDto<NoteAuditLogResponseDto>> {
    this.logger.debug(`Finding audit logs for note: ${noteId}`);

    // Permission check — only author or ADMIN
    await this.checkAuditAccess(noteId, userId, workspaceId);

    // Delegate to audit domain
    const result = await this.auditDomainService.getNoteAuditTrail(
      noteId,
      workspaceId,
      page,
      limit,
    );

    const data = result.data.map((log) => this.mapToResponse(log));
    const total = result.meta?.total ?? data.length;

    return new PaginatedResponseDto(data, total, page, limit);
  }

  /**
   * Find audit logs for a specific user.
   * No extra permission gate — consumers are expected to pass the authenticated
   * user's own ID (enforced at the controller layer).
   *
   * @param userId - User whose activity to retrieve
   * @param workspaceId - Tenant workspace ID
   * @param page - Page number (1-based)
   * @param limit - Items per page
   * @returns Paginated audit log response DTOs
   */
  async findByUser(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedResponseDto<NoteAuditLogResponseDto>> {
    this.logger.debug(`Finding audit logs for user: ${userId}`);

    const logs = await this.auditDomainService.getUserNoteActivity(
      userId,
      workspaceId,
    );

    // Manual pagination over the full list (audit domain returns all)
    const total = logs.length;
    const start = (page - 1) * limit;
    const paged = logs.slice(start, start + limit);
    const data = paged.map((log) => this.mapToResponse(log));

    return new PaginatedResponseDto(data, total, page, limit);
  }

  /**
   * Find audit logs with flexible filters.
   * Delegates to the appropriate audit domain method based on the query.
   *
   * @param query - Filter DTO (noteId, userId, action, dateFrom, dateTo, page, limit)
   * @param workspaceId - Tenant workspace ID
   * @returns Paginated audit log response DTOs
   */
  async findWithFilters(
    query: NoteAuditLogQueryDto,
    workspaceId: string,
  ): Promise<PaginatedResponseDto<NoteAuditLogResponseDto>> {
    this.logger.debug('Finding audit logs with filters');

    const page = query.page || 1;
    const limit = query.limit || 50;

    let logs: NoteAuditLog[] = [];
    let total = 0;

    // Route to the most specific audit-domain method
    if (query.noteId) {
      const result = await this.auditDomainService.getNoteAuditTrail(
        query.noteId,
        workspaceId,
        page,
        limit,
      );
      logs = result.data;
      total = result.meta?.total ?? logs.length;
    } else if (query.userId) {
      const dateRange = this.buildDateRange(query.dateFrom, query.dateTo);
      const all = await this.auditDomainService.getUserNoteActivity(
        query.userId,
        workspaceId,
        dateRange,
      );
      total = all.length;
      const start = (page - 1) * limit;
      logs = all.slice(start, start + limit);
    } else if (query.action) {
      const all = await this.auditDomainService.getByActionType(
        query.action,
        workspaceId,
      );
      total = all.length;
      const start = (page - 1) * limit;
      logs = all.slice(start, start + limit);
    } else {
      // Broad query — use getNoteAuditTrail without noteId filter
      // Fall back to getUserNoteActivity with empty date range
      const dateRange = this.buildDateRange(query.dateFrom, query.dateTo);
      const all = await this.auditDomainService.getAIRelatedLogs(
        workspaceId,
        dateRange,
      );
      total = all.length;
      const start = (page - 1) * limit;
      logs = all.slice(start, start + limit);
    }

    // Apply client-side action filter if noteId was the primary route
    if (query.noteId && query.action) {
      logs = logs.filter((l) => l.actionType === query.action);
      total = logs.length;
    }

    const data = logs.map((log) => this.mapToResponse(log));

    return new PaginatedResponseDto(data, total, page, limit);
  }

  // ─── WRITE OPERATIONS (delegate directly to audit domain) ──────────

  /**
   * Log a note action via the audit domain.
   *
   * @param noteId - Care note ID
   * @param userId - User performing the action
   * @param actionType - Type of action
   * @param changedFields - Optional array of field names that changed
   * @param metadata - Additional metadata (ipAddress, userAgent, patientId, etc.)
   * @param workspaceId - Tenant workspace ID
   * @returns Created NoteAuditLog entity
   */
  async logNoteAction(
    noteId: string,
    userId: string,
    actionType: NoteAuditActionType,
    changedFields: string[] | undefined,
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.auditDomainService.logNoteAction(
      noteId,
      userId,
      actionType,
      changedFields,
      metadata,
      workspaceId,
    );
  }

  /**
   * Log note creation via the audit domain.
   */
  async logNoteCreation(
    noteId: string,
    userId: string,
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.auditDomainService.logNoteCreation(
      noteId,
      userId,
      metadata,
      workspaceId,
    );
  }

  /**
   * Log note update via the audit domain.
   */
  async logNoteUpdate(
    noteId: string,
    userId: string,
    changedFields: string[],
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.auditDomainService.logNoteUpdate(
      noteId,
      userId,
      changedFields,
      metadata,
      workspaceId,
    );
  }

  /**
   * Log note sharing via the audit domain.
   */
  async logNoteSharing(
    noteId: string,
    userId: string,
    sharedWith: string,
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.auditDomainService.logNoteSharing(
      noteId,
      userId,
      sharedWith,
      metadata,
      workspaceId,
    );
  }

  /**
   * Log AI generation via the audit domain.
   */
  async logAIGeneration(
    noteId: string,
    userId: string,
    aiProvider: string,
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.auditDomainService.logAIGeneration(
      noteId,
      userId,
      aiProvider,
      metadata,
      workspaceId,
    );
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────────

  /**
   * Check that the requesting user has audit access for a note.
   * Only the note author or users with ADMIN permission may view audit logs.
   *
   * @throws ForbiddenException if the user lacks access
   */
  private async checkAuditAccess(
    noteId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    // Check if user is author
    const note = await this.careNoteRepository.findOne({
      where: { id: noteId, workspaceId, deletedAt: IsNull() },
    });

    if (note && note.authorId === userId) {
      return; // Author always has audit access
    }

    // Check ADMIN permission
    const hasPermission = await this.permissionRepository.hasPermission(
      noteId,
      userId,
      PermissionLevel.ADMIN,
      workspaceId,
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        'Only note author or admins can view audit logs',
      );
    }
  }

  /**
   * Map an audit domain NoteAuditLog entity to a care-notes NoteAuditLogResponseDto.
   */
  private mapToResponse(log: NoteAuditLog): NoteAuditLogResponseDto {
    const dto = new NoteAuditLogResponseDto();
    dto.id = log.id;
    dto.workspaceId = log.workspaceId;
    dto.noteId = log.noteId;
    dto.userId = log.userId;
    dto.action = log.actionType;
    dto.details = {
      changedFields: log.changedFields,
      previousValues: log.previousValues,
      newValues: log.newValues,
      metadata: log.metadata,
      aiProvider: log.aiProvider,
      sharedWith: log.sharedWith,
      oldPermission: log.oldPermission,
      newPermission: log.newPermission,
      comment: log.comment,
      patientId: log.patientId,
    };
    dto.ipAddress = log.ipAddress;
    dto.userAgent = log.userAgent;
    dto.createdAt = log.createdAt;
    return dto;
  }

  /**
   * Build a date range object from optional string dates.
   */
  private buildDateRange(
    dateFrom?: string,
    dateTo?: string,
  ): { startDate?: Date; endDate?: Date } | undefined {
    if (!dateFrom && !dateTo) {
      return undefined;
    }
    return {
      startDate: dateFrom ? new Date(dateFrom) : undefined,
      endDate: dateTo ? new Date(dateTo) : undefined,
    };
  }
}
