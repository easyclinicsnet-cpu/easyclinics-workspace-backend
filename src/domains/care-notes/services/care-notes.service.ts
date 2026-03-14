import { IsNull, In } from 'typeorm';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { CareNoteRepository } from '../repositories/care-note.repository';
import { NotePermissionRepository } from '../repositories/note-permission.repository';
import { NoteTimelineRepository } from '../repositories/note-timeline.repository';
import {
  CreateCareNoteDto,
  UpdateCareNoteDto,
  CareNoteQueryDto,
  ShareCareNoteDto,
  CareNoteResponseDto,
  NotePermissionResponseDto,
  PaginatedResponseDto,
} from '../dto';
import {
  CareNoteStatus,
  PermissionLevel,
  AuditEventType,
  AuditOutcome,
  NoteAuditActionType,
  UserRole,
} from '../../../common/enums';
import { NoteAuditService } from './note-audit.service';
import { CareNote } from '../entities/care-note.entity';
import { CareAiNoteSource } from '../entities/care-ai-note-source.entity';

@Injectable()
export class CareNotesService {
  constructor(
    private readonly careNoteRepository: CareNoteRepository,
    private readonly permissionRepository: NotePermissionRepository,
    private readonly timelineRepository: NoteTimelineRepository,
    private readonly auditLogService: AuditLogService,
    private readonly noteAuditService: NoteAuditService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('CareNotesService');
  }

  async create(
    dto: CreateCareNoteDto,
    userId: string,
    workspaceId: string,
  ): Promise<CareNoteResponseDto> {
    this.logger.info(
      `Creating care note: consultation=${dto.consultationId}, type=${dto.type}`,
    );

    try {
      // Create care note
      const careNote = this.careNoteRepository.create({
        ...dto,
        content: dto.content ? JSON.stringify(dto.content) : undefined,
        workspaceId,
        authorId: userId,
        versionNumber: 1,
        status: dto.status || CareNoteStatus.DRAFT,
      } as any) as unknown as CareNote;

      const savedNote = await this.careNoteRepository.save(careNote);

      // Create author permission (OWNER level)
      const permission = this.permissionRepository.create({
        noteId: savedNote.id,
        userId: userId,
        workspaceId,
        permissionLevel: PermissionLevel.OWNER,
        grantedBy: userId,
      } as any);
      await this.permissionRepository.save(permission);

      // Add to consultation timeline
      const sequence = await this.timelineRepository.getNextSequence(
        dto.consultationId,
        workspaceId,
      );

      const timeline = this.timelineRepository.create({
        consultationId: dto.consultationId,
        noteId: savedNote.id,
        workspaceId,
        eventType: `note_created_${dto.type}`,
        sequenceNumber: sequence,
      });
      await this.timelineRepository.save(timeline);

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.CREATE,
          entityType: 'CareNote',
          entityId: savedNote.id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.CREATE,
            noteType: dto.type,
            consultationId: dto.consultationId,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Care note created successfully: ${savedNote.id}`);
      return this.mapToResponse(savedNote, userId);
    } catch (error) {
      this.logger.error('Failed to create care note', error);
      throw error;
    }
  }

  async findAll(
    query: CareNoteQueryDto,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<PaginatedResponseDto<CareNoteResponseDto>> {
    this.logger.debug('Finding all care notes with filters');

    try {
      const [notes, total] = await this.careNoteRepository.findWithFilters(
        query,
        workspaceId,
      );

      // Filter by user permissions
      const accessibleNotes = await this.filterByPermissions(notes, userId, userRole);

      // Enrich AI notes that have no transcript FK with the consultation transcript
      await this.enrichWithSourceContent(accessibleNotes);

      const data = await Promise.all(
        accessibleNotes.map((note) => this.mapToResponse(note, userId)),
      );

      return new PaginatedResponseDto(
        data,
        accessibleNotes.length,
        query.page || 1,
        query.limit || 20,
      );
    } catch (error) {
      this.logger.error('Failed to find care notes', error);
      throw error;
    }
  }

  async findOne(
    id: string,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<CareNoteResponseDto> {
    this.logger.debug(`Finding care note: ${id}`);

    const note = await this.careNoteRepository.findByIdWithRelations(
      id,
      workspaceId,
    );

    if (!note) {
      throw new NotFoundException('Care note not found');
    }

    // Check permission
    await this.checkPermission(note.id, userId, PermissionLevel.READ, workspaceId, userRole);

    // Audit log
    try {
      await this.auditLogService.log({
        eventType: AuditEventType.READ,
        entityType: 'CareNote',
        entityId: id,
        userId,
        workspaceId,
        outcome: AuditOutcome.SUCCESS,
        metadata: {
          action: NoteAuditActionType.CREATE,
        },
      });
    } catch (error) {
      this.logger.warn('Failed to create audit log', error);
    }

    // Enrich single AI note if transcript FK is missing
    await this.enrichWithSourceContent([note]);

    return this.mapToResponse(note, userId);
  }

  async findByConsultation(
    consultationId: string,
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
    userRole?: string,
  ): Promise<PaginatedResponseDto<CareNoteResponseDto>> {
    this.logger.debug(`Finding care notes by consultation: ${consultationId}`);

    try {
      const [notes, total] = await this.careNoteRepository.findByConsultation(
        consultationId,
        workspaceId,
        page,
        limit,
      );

      const accessibleNotes = await this.filterByPermissions(notes, userId, userRole);

      // Enrich AI notes that have no transcript FK with the consultation transcript
      await this.enrichWithSourceContent(accessibleNotes);

      const data = await Promise.all(
        accessibleNotes.map((note) => this.mapToResponse(note, userId)),
      );

      return new PaginatedResponseDto(data, accessibleNotes.length, page, limit);
    } catch (error) {
      this.logger.error('Failed to find care notes by consultation', error);
      throw error;
    }
  }

  async findByPatient(
    patientId: string,
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
    userRole?: string,
  ): Promise<PaginatedResponseDto<CareNoteResponseDto>> {
    this.logger.debug(`Finding care notes by patient: ${patientId}`);

    try {
      const [notes, total] = await this.careNoteRepository.findByPatient(
        patientId,
        workspaceId,
        page,
        limit,
      );

      const accessibleNotes = await this.filterByPermissions(notes, userId, userRole);

      await this.enrichWithSourceContent(accessibleNotes);

      const data = await Promise.all(
        accessibleNotes.map((note) => this.mapToResponse(note, userId)),
      );

      return new PaginatedResponseDto(data, total, page, limit);
    } catch (error) {
      this.logger.error('Failed to find care notes by patient', error);
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateCareNoteDto,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<CareNoteResponseDto> {
    this.logger.info(`Updating care note: ${id}`);

    const note = await this.careNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException('Care note not found');
    }

    // Check write permission
    await this.checkPermission(note.id, userId, PermissionLevel.WRITE, workspaceId, userRole);

    // Published notes are immutable for regular clinical staff.
    // The original author and elevated roles (workspace owner / system admin)
    // may still patch a published note (e.g. to correct a factual error after sign-off).
    const isAuthor = note.authorId === userId;
    if (note.status === CareNoteStatus.PUBLISHED && !isAuthor && !this.isElevatedRole(userRole)) {
      throw new ForbiddenException(
        'Published notes can only be edited by the note author, workspace owners, or system administrators',
      );
    }

    try {
      // Create version before update
      await this.careNoteRepository.createVersion(note);

      // Update note — serialize content to string before saving (mirrors legacy)
      const updatePayload = {
        ...dto,
        ...(dto.content !== undefined && {
          content: JSON.stringify(dto.content),
        }),
      };
      Object.assign(note, updatePayload);
      await this.careNoteRepository.incrementVersion(id, workspaceId);

      const updatedNote = await this.careNoteRepository.save(note);

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.UPDATE,
          entityType: 'CareNote',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.UPDATE,
            changes: dto,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Care note updated successfully: ${id}`);
      return this.mapToResponse(updatedNote, userId);
    } catch (error) {
      this.logger.error('Failed to update care note', error);
      throw error;
    }
  }

  async publish(
    id: string,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<CareNoteResponseDto> {
    this.logger.info(`Publishing care note: ${id}`);

    const note = await this.careNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException('Care note not found');
    }

    // Check permission
    await this.checkPermission(note.id, userId, PermissionLevel.WRITE, workspaceId, userRole);

    if (note.status !== CareNoteStatus.DRAFT) {
      throw new ConflictException(
        'Only draft notes can be published',
      );
    }

    // Validate AI-generated notes
    if (note.isAiGenerated && !note.aiMetadata) {
      throw new BadRequestException(
        'AI-generated notes must have metadata before publishing',
      );
    }

    try {
      // Create version before status change
      await this.careNoteRepository.createVersion(note);

      note.status = CareNoteStatus.PUBLISHED;
      await this.careNoteRepository.incrementVersion(id, workspaceId);

      const publishedNote = await this.careNoteRepository.save(note);

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.UPDATE,
          entityType: 'CareNote',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.PUBLISH,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Care note published successfully: ${id}`);
      return this.mapToResponse(publishedNote, userId);
    } catch (error) {
      this.logger.error('Failed to publish care note', error);
      throw error;
    }
  }

  async archive(
    id: string,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<CareNoteResponseDto> {
    this.logger.info(`Archiving care note: ${id}`);

    const note = await this.careNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException('Care note not found');
    }

    // Check permission
    await this.checkPermission(note.id, userId, PermissionLevel.ADMIN, workspaceId, userRole);

    if (note.status !== CareNoteStatus.PUBLISHED) {
      throw new ConflictException(
        'Only published notes can be archived',
      );
    }

    try {
      // Create version before status change
      await this.careNoteRepository.createVersion(note);

      note.status = CareNoteStatus.ARCHIVED;
      await this.careNoteRepository.incrementVersion(id, workspaceId);

      const archivedNote = await this.careNoteRepository.save(note);

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.UPDATE,
          entityType: 'CareNote',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.MODIFY,
            statusChange: 'ARCHIVED',
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Care note archived successfully: ${id}`);
      return this.mapToResponse(archivedNote, userId);
    } catch (error) {
      this.logger.error('Failed to archive care note', error);
      throw error;
    }
  }

  async remove(
    id: string,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<void> {
    this.logger.info(`Soft deleting care note: ${id}`);

    const note = await this.careNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException('Care note not found');
    }

    // Check permission - only OWNER can delete
    await this.checkPermission(note.id, userId, PermissionLevel.OWNER, workspaceId, userRole);

    try {
      await this.careNoteRepository.softDelete({ id, workspaceId });

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.DELETE,
          entityType: 'CareNote',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.DELETE,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Care note deleted successfully: ${id}`);
    } catch (error) {
      this.logger.error('Failed to delete care note', error);
      throw error;
    }
  }

  async shareNote(
    id: string,
    dto: ShareCareNoteDto,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<NotePermissionResponseDto[]> {
    this.logger.info(`Sharing care note: ${id}`);

    const note = await this.careNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException('Care note not found');
    }

    // Check permission - need ADMIN to share
    await this.checkPermission(note.id, userId, PermissionLevel.ADMIN, workspaceId, userRole);

    try {
      const permissions: NotePermissionResponseDto[] = [];

      for (const share of dto.sharedWith) {
        const permission = this.permissionRepository.create({
          noteId: id,
          userId: share.userId,
          workspaceId,
          permissionLevel: share.permissionLevel,
          expiresAt: share.expiresAt ? new Date(share.expiresAt) : undefined,
          reason: share.reason,
          grantedBy: userId,
        } as any);

        const saved = await this.permissionRepository.save(permission);
        permissions.push(saved as any);
      }

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.UPDATE,
          entityType: 'CareNote',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.SHARE,
            sharedWith: dto.sharedWith.map((s) => s.userId),
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Care note shared successfully: ${id}`);
      return permissions;
    } catch (error) {
      this.logger.error('Failed to share care note', error);
      throw error;
    }
  }

  async restoreVersion(
    id: string,
    versionNumber: number,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<CareNoteResponseDto> {
    this.logger.info(`Restoring care note version: ${id}, version=${versionNumber}`);

    const note = await this.careNoteRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException('Care note not found');
    }

    // Check permission
    await this.checkPermission(note.id, userId, PermissionLevel.WRITE, workspaceId, userRole);

    try {
      // Get version to restore
      const versionRepository = this.careNoteRepository.manager.getRepository(
        'NoteVersion',
      );
      const version: any = await versionRepository.findOne({
        where: { noteId: id, versionNumber, workspaceId },
      });

      if (!version) {
        throw new NotFoundException('Version not found');
      }

      // Create version of current state first
      await this.careNoteRepository.createVersion(note);

      // Restore content from version
      note.content = version.content;
      await this.careNoteRepository.incrementVersion(id, workspaceId);

      const restoredNote = await this.careNoteRepository.save(note);

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.UPDATE,
          entityType: 'CareNote',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.VERSION_RESTORE,
            versionNumber,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Care note version restored successfully: ${id}`);
      return this.mapToResponse(restoredNote, userId);
    } catch (error) {
      this.logger.error('Failed to restore care note version', error);
      throw error;
    }
  }

  /**
   * Get audit logs for a specific note.
   *
   * Delegates to the care-notes NoteAuditService facade, which in turn
   * delegates to the audit domain's NoteAuditService for the actual query.
   * The facade handles permission checks (author / ADMIN).
   *
   * @param noteId - Care note ID
   * @param userId - Authenticated user ID
   * @param workspaceId - Tenant workspace ID
   * @param page - Page number (1-based)
   * @param limit - Items per page
   * @returns Paginated audit log entries
   */
  async getNoteAuditLogs(
    noteId: string,
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<any> {
    this.logger.debug(`Getting audit logs for note: ${noteId}`);

    // Delegate to NoteAuditService facade (handles permission checks + audit domain delegation)
    return this.noteAuditService.findByNote(noteId, userId, workspaceId, page, limit);
  }

  /**
   * Verify that a user has access to a note.
   *
   * Public method for cross-service access verification.
   * Returns the note if the user has at least READ access.
   *
   * @param noteId - Care note ID
   * @param userId - User to check access for
   * @param workspaceId - Tenant workspace ID
   * @returns CareNote entity if access is granted
   * @throws ForbiddenException if user does not have access
   */
  async verifyNoteAccess(
    noteId: string,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<any> {
    this.logger.debug(`Verifying note access: note=${noteId}, user=${userId}`);

    const note = await this.careNoteRepository.findOne({
      where: { id: noteId, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException(`Care note not found: ${noteId}`);
    }

    // Workspace owner and system admin have full access to all notes
    if (this.isElevatedRole(userRole)) {
      return note;
    }

    // Author always has access
    if (note.authorId === userId) {
      return note;
    }

    // Check permission
    const hasAccess = await this.permissionRepository.hasPermission(
      noteId,
      userId,
      PermissionLevel.READ,
      workspaceId,
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        'You do not have permission to access this note',
      );
    }

    return note;
  }

  // Helper methods

  private async checkPermission(
    noteId: string,
    userId: string,
    level: PermissionLevel,
    workspaceId: string,
    userRole?: string,
  ): Promise<void> {
    // Workspace owners and system admins bypass note-level permission checks
    if (this.isElevatedRole(userRole)) {
      return;
    }

    // Check if user is author
    const note = await this.careNoteRepository.findOne({
      where: { id: noteId, workspaceId, deletedAt: IsNull() },
    });

    if (note && note.authorId === userId) {
      return; // Author has full access
    }

    // Check permission level
    const hasPermission = await this.permissionRepository.hasPermission(
      noteId,
      userId,
      level,
      workspaceId,
    );

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  /**
   * Enriches AI-generated notes with the sourceContent from CareAiNoteSource.
   *
   * CareAiNoteSource.sourceContent is the edited structuredTranscript (or
   * manual content) that was actually sent to the AI for note generation.
   * This is the single source of truth for "what did the AI see?".
   *
   * Single batch query → O(1) round-trips regardless of list size.
   */
  private async enrichWithSourceContent(notes: any[]): Promise<void> {
    const aiNotes = notes.filter(
      (n) => n.isAiGenerated && !n.aiMetadata?.sourceTranscript,
    );
    if (!aiNotes.length) return;

    const noteIds = aiNotes.map((n) => n.id as string);

    const aiSources = await this.careNoteRepository.manager.find(
      CareAiNoteSource,
      { where: { noteId: In(noteIds) } },
    );

    const noteToSourceContent = new Map<string, string>();
    for (const src of aiSources) {
      if (src.sourceContent) {
        noteToSourceContent.set(src.noteId, src.sourceContent);
      }
    }

    for (const note of aiNotes) {
      const sourceContent = noteToSourceContent.get(note.id);
      if (sourceContent) {
        note._aiSourceContent = sourceContent;
      }
    }
  }

  private isElevatedRole(role?: string): boolean {
    return role === UserRole.WORKSPACE_OWNER || role === UserRole.ADMIN;
  }

  private async filterByPermissions(
    notes: any[],
    userId: string,
    userRole?: string,
  ): Promise<any[]> {
    // Any authenticated workspace member can read all notes.
    // Workspace scoping is already enforced by the JWT workspace token on every
    // query (workspaceId is injected from the verified token, not from the
    // request body), so returning all notes here is safe — no cross-workspace
    // leakage is possible.
    return notes;
  }

  async mapToResponse(
    note: any,
    userId: string,
  ): Promise<CareNoteResponseDto> {
    const isAuthor = note.authorId === userId;
    const permissionLevel = isAuthor
      ? PermissionLevel.OWNER
      : await this.permissionRepository.getUserPermissionLevel(
          note.id,
          userId,
          note.workspaceId,
        );

    // Parse content JSON string → object (mirrors legacy NoteResponseDto.fromEntity)
    let content = note.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        content = { type: note.type, content };
      }
    }
    // Ensure content carries the note type when missing
    if (content && typeof content === 'object' && !content.type && note.type) {
      content.type = note.type;
    }

    // structuredTranscript — the edited content that was actually sent to
    // the AI for note generation (or the raw sourceContent for manual notes).
    //  1. aiMetadata.sourceTranscript — immutable snapshot (new notes)
    //  2. CareAiNoteSource.sourceContent — legacy / manual-content notes
    const structuredTranscript: any =
      note.aiMetadata?.sourceTranscript ??
      note._aiSourceContent ??
      null;

    // Destructure internal-only fields before spreading
    const { _aiSourceContent, recordingsTranscript: _rt, ...noteData } = note;

    return {
      ...noteData,
      content,
      structuredTranscript,
      hasPermission: isAuthor || permissionLevel !== null,
      userPermissionLevel: permissionLevel,
    };
  }
}
