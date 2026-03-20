import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { NoteAuditLogRepository } from '../repositories/note-audit-log.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { NoteAuditLog } from '../entities/note-audit-log.entity';
import { NoteAuditActionType } from '../../../common/enums';
import { RequestContext } from '../../../common/context/request-context';

/**
 * Service for managing note audit logs
 * Provides specialized audit logging for clinical notes and care documentation
 */
@Injectable()
export class NoteAuditService {
  constructor(
    private readonly noteAuditLogRepository: NoteAuditLogRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('NoteAuditService');
    this.logger.log('NoteAuditService initialized');
  }

  /**
   * Log a note action
   * @param noteId Note ID
   * @param userId User ID
   * @param actionType Action type
   * @param changedFields Array of changed field names
   * @param metadata Additional metadata
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created note audit log
   */
  async logNoteAction(
    noteId: string,
    userId: string,
    actionType: NoteAuditActionType,
    changedFields: string[] | undefined,
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    try {
      this.logger.log(`Logging note action: ${actionType} for note: ${noteId}`);

      // ── ipAddress / userAgent ─────────────────────────────────────────────
      // Prefer explicit values passed in metadata (e.g. from direct controller
      // calls where the DTO already carries them). Fall back to the async-local
      // RequestContext which is populated by RequestContextMiddleware for every
      // HTTP request — this covers service-level calls that have no req object.
      const ipAddress: string =
        (metadata?.ipAddress as string | undefined) ||
        RequestContext.getIpAddress() ||
        '';
      const userAgent: string =
        (metadata?.userAgent as string | undefined) ||
        RequestContext.getUserAgent() ||
        '';

      // ── patientId ─────────────────────────────────────────────────────────
      const patientId: string | undefined = metadata?.patientId as string | undefined;

      // ── Hash chain ────────────────────────────────────────────────────────
      // Retrieve the previous record's hash (or 'GENESIS' for the first entry)
      // then compute a SHA-256 over the immutable fields of this record.
      const previousHash = await this.noteAuditLogRepository.getLatestHashForNote(
        noteId,
        workspaceId,
      );
      const now = new Date();
      const hashInput = [
        previousHash,
        noteId,
        userId,
        actionType,
        now.toISOString(),
        JSON.stringify(changedFields ?? []),
        JSON.stringify(metadata ?? {}),
      ].join('|');
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // ── Persist ───────────────────────────────────────────────────────────
      const noteAuditLog = this.noteAuditLogRepository.create({
        workspaceId,
        noteId,
        userId,
        actionType,
        changedFields,
        metadata,
        ipAddress: ipAddress || undefined,
        userAgent: userAgent || undefined,
        comment: metadata?.comment,
        patientId,
        aiProvider: metadata?.aiProvider,
        sharedWith: metadata?.sharedWith,
        oldPermission: metadata?.oldPermission,
        newPermission: metadata?.newPermission,
        previousValues: metadata?.previousValues,
        newValues: metadata?.newValues,
        previousHash,
        hash,
      });

      const savedLog = await this.noteAuditLogRepository.save(noteAuditLog);

      this.logger.log(`Note audit log created with ID: ${savedLog.id}`);

      return savedLog;
    } catch (error) {
      this.logger.error(`Error logging note action: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Verify the hash chain integrity for all audit logs of a given note.
   *
   * Walks logs in chronological order and re-computes each hash to confirm it
   * matches the stored value.  Returns a report with the first broken link if
   * tampering is detected.
   *
   * @param noteId      Note to verify
   * @param workspaceId Tenant scope
   * @returns { valid: boolean; brokenAt?: string; checkedCount: number }
   */
  async verifyHashChain(
    noteId: string,
    workspaceId: string,
  ): Promise<{ valid: boolean; brokenAt?: string; checkedCount: number }> {
    const { data: logs } = await this.noteAuditLogRepository.findByNote(
      noteId,
      workspaceId,
      1,
      1000,
    );

    // Sort oldest-first for chain traversal
    const sorted = [...logs].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    let expectedPreviousHash = 'GENESIS';

    for (const log of sorted) {
      if (!log.hash) {
        // Pre-hash-chain records — skip silently
        expectedPreviousHash = 'GENESIS';
        continue;
      }

      const hashInput = [
        log.previousHash ?? 'GENESIS',
        log.noteId,
        log.userId,
        log.actionType,
        new Date(log.createdAt).toISOString(),
        JSON.stringify(log.changedFields ?? []),
        JSON.stringify(log.metadata ?? {}),
      ].join('|');

      const recomputed = crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex');

      if (recomputed !== log.hash) {
        this.logger.warn(
          `Hash chain broken at audit log ${log.id} for note ${noteId}`,
        );
        return { valid: false, brokenAt: log.id, checkedCount: sorted.length };
      }

      if (log.previousHash !== expectedPreviousHash) {
        this.logger.warn(
          `previousHash mismatch at audit log ${log.id} for note ${noteId}`,
        );
        return { valid: false, brokenAt: log.id, checkedCount: sorted.length };
      }

      expectedPreviousHash = log.hash;
    }

    return { valid: true, checkedCount: sorted.length };
  }

  /**
   * Get audit trail for a note with pagination
   * @param noteId Note ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param page Page number
   * @param limit Items per page
   * @returns Paginated note audit logs
   */
  async getNoteAuditTrail(
    noteId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: NoteAuditLog[]; meta: any }> {
    try {
      this.logger.log(`Getting audit trail for note: ${noteId}`);

      const result = await this.noteAuditLogRepository.findByNote(noteId, workspaceId, page, limit);

      this.logger.log(`Retrieved ${result.meta.total} audit logs for note: ${noteId}`);

      return result;
    } catch (error) {
      this.logger.error(`Error getting note audit trail: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get user's note activity with optional date range
   * @param userId User ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @param dateRange Optional date range { startDate, endDate }
   * @returns Array of note audit logs for the user
   */
  async getUserNoteActivity(
    userId: string,
    workspaceId: string,
    dateRange?: { startDate?: Date; endDate?: Date },
  ): Promise<NoteAuditLog[]> {
    try {
      this.logger.log(`Getting note activity for user: ${userId}`);

      const logs = await this.noteAuditLogRepository.findByUser(
        userId,
        workspaceId,
        dateRange?.startDate,
        dateRange?.endDate,
      );

      this.logger.log(`Found ${logs.length} note audit logs for user: ${userId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error getting user note activity: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get note audit logs by action type
   * @param actionType Action type
   * @param workspaceId Workspace ID for multi-tenancy
   * @param limit Optional limit
   * @returns Array of note audit logs with the given action type
   */
  async getByActionType(
    actionType: NoteAuditActionType,
    workspaceId: string,
    limit?: number,
  ): Promise<NoteAuditLog[]> {
    try {
      this.logger.log(`Getting note audit logs with action type: ${actionType}`);

      const logs = await this.noteAuditLogRepository.findByActionType(actionType, workspaceId, limit);

      this.logger.log(`Found ${logs.length} note audit logs with action type: ${actionType}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error getting note audit logs by action type: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get note audit logs by patient
   * @param patientId Patient ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Array of note audit logs for the patient
   */
  async getByPatient(patientId: string, workspaceId: string): Promise<NoteAuditLog[]> {
    try {
      this.logger.log(`Getting note audit logs for patient: ${patientId}`);

      const logs = await this.noteAuditLogRepository.findByPatient(patientId, workspaceId);

      this.logger.log(`Found ${logs.length} note audit logs for patient: ${patientId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error getting note audit logs by patient: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get AI-related note audit logs
   * @param workspaceId Workspace ID for multi-tenancy
   * @param dateRange Optional date range { startDate, endDate }
   * @returns Array of AI-related note audit logs
   */
  async getAIRelatedLogs(
    workspaceId: string,
    dateRange?: { startDate?: Date; endDate?: Date },
  ): Promise<NoteAuditLog[]> {
    try {
      this.logger.log(`Getting AI-related note audit logs for workspace: ${workspaceId}`);

      const logs = await this.noteAuditLogRepository.findAIRelatedLogs(
        workspaceId,
        dateRange?.startDate,
        dateRange?.endDate,
      );

      this.logger.log(`Found ${logs.length} AI-related note audit logs for workspace: ${workspaceId}`);

      return logs;
    } catch (error) {
      this.logger.error(`Error getting AI-related note audit logs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Log note creation
   * @param noteId Note ID
   * @param userId User ID
   * @param metadata Additional metadata
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created note audit log
   */
  async logNoteCreation(
    noteId: string,
    userId: string,
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.logNoteAction(
      noteId,
      userId,
      NoteAuditActionType.CREATE,
      undefined,
      metadata,
      workspaceId,
    );
  }

  /**
   * Log note update
   * @param noteId Note ID
   * @param userId User ID
   * @param changedFields Array of changed field names
   * @param metadata Additional metadata
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created note audit log
   */
  async logNoteUpdate(
    noteId: string,
    userId: string,
    changedFields: string[],
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.logNoteAction(
      noteId,
      userId,
      NoteAuditActionType.UPDATE,
      changedFields,
      metadata,
      workspaceId,
    );
  }

  /**
   * Log note sharing
   * @param noteId Note ID
   * @param userId User ID
   * @param sharedWith User or role shared with
   * @param metadata Additional metadata
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created note audit log
   */
  async logNoteSharing(
    noteId: string,
    userId: string,
    sharedWith: string,
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.logNoteAction(
      noteId,
      userId,
      NoteAuditActionType.SHARE,
      undefined,
      { ...metadata, sharedWith },
      workspaceId,
    );
  }

  /**
   * Log AI generation
   * @param noteId Note ID
   * @param userId User ID
   * @param aiProvider AI provider used
   * @param metadata Additional metadata
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created note audit log
   */
  async logAIGeneration(
    noteId: string,
    userId: string,
    aiProvider: string,
    metadata: Record<string, any>,
    workspaceId: string,
  ): Promise<NoteAuditLog> {
    return this.logNoteAction(
      noteId,
      userId,
      NoteAuditActionType.AI_GENERATE,
      undefined,
      { ...metadata, aiProvider },
      workspaceId,
    );
  }
}
