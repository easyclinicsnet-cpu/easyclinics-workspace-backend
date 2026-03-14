import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import { NoteVersionRepository } from '../repositories/note-version.repository';
import { NotePermissionRepository } from '../repositories/note-permission.repository';
import { CareNotesService } from './care-notes.service';
import {
  NoteVersionResponseDto,
  CareNoteResponseDto,
  PaginatedResponseDto,
} from '../dto';
import { PermissionLevel, UserRole } from '../../../common/enums';

@Injectable()
export class NoteVersionService {
  constructor(
    private readonly versionRepository: NoteVersionRepository,
    private readonly permissionRepository: NotePermissionRepository,
    private readonly careNotesService: CareNotesService,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('NoteVersionService');
  }

  async findByNote(
    noteId: string,
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
    userRole?: string,
  ): Promise<PaginatedResponseDto<NoteVersionResponseDto>> {
    this.logger.debug(`Finding versions for note: ${noteId}`);

    const isElevated = userRole === UserRole.WORKSPACE_OWNER || userRole === UserRole.ADMIN;

    // Check permission (elevated roles bypass note-level checks)
    if (!isElevated) {
      const hasPermission = await this.permissionRepository.hasPermission(
        noteId,
        userId,
        PermissionLevel.READ,
        workspaceId,
      );

      if (!hasPermission) {
        throw new NotFoundException('Care note not found or access denied');
      }
    }

    const [versions, total] = await this.versionRepository.findByNote(
      noteId,
      workspaceId,
      page,
      limit,
    );

    try {
      await this.auditLogService.log({
        userId,
        action: 'READ_NOTE_VERSIONS',
        eventType: AuditEventType.READ,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'CareNote',
        resourceId: noteId,
        justification: 'Clinical note version history access',
        metadata: { page, limit, total },
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log for findByNote', (auditError as Error).stack);
    }

    const data = versions as any[];
    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findOne(
    noteId: string,
    versionNumber: number,
    userId: string,
    workspaceId: string,
  ): Promise<NoteVersionResponseDto> {
    this.logger.debug(`Finding version: note=${noteId}, version=${versionNumber}`);

    // Check permission
    const hasPermission = await this.permissionRepository.hasPermission(
      noteId,
      userId,
      PermissionLevel.READ,
      workspaceId,
    );

    if (!hasPermission) {
      throw new NotFoundException('Access denied');
    }

    const version = await this.versionRepository.findByVersionNumber(
      noteId,
      versionNumber,
      workspaceId,
    );

    if (!version) {
      throw new NotFoundException('Version not found');
    }

    try {
      await this.auditLogService.log({
        userId,
        action: 'READ_NOTE_VERSION',
        eventType: AuditEventType.READ,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'CareNote',
        resourceId: noteId,
        justification: 'Clinical note specific version access',
        metadata: { versionNumber },
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log for findOne version', (auditError as Error).stack);
    }

    return version as any;
  }

  async restore(
    noteId: string,
    versionNumber: number,
    userId: string,
    workspaceId: string,
  ): Promise<CareNoteResponseDto> {
    this.logger.info(`Restoring version: note=${noteId}, version=${versionNumber}`);

    try {
      const result = await this.careNotesService.restoreVersion(
        noteId,
        versionNumber,
        userId,
        workspaceId,
      );

      try {
        await this.auditLogService.log({
          userId,
          action: 'RESTORE_NOTE_VERSION',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'CareNote',
          resourceId: noteId,
          justification: 'Clinical note restored to previous version',
          metadata: { versionNumber },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for restore', (auditError as Error).stack);
      }

      return result;
    } catch (error) {
      try {
        await this.auditLogService.log({
          userId,
          action: 'RESTORE_NOTE_VERSION',
          eventType: AuditEventType.UPDATE,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'CareNote',
          resourceId: noteId,
          justification: 'Clinical note version restore failed',
          metadata: { versionNumber, error: (error as Error).message },
        }, workspaceId);
      } catch (auditError) {
        this.logger.error('Failed to create audit log for restore failure', (auditError as Error).stack);
      }
      throw error;
    }
  }
}
