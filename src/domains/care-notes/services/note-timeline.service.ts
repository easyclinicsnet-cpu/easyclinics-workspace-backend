import { Injectable, ForbiddenException } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome } from '../../../common/enums';
import { NoteTimelineRepository } from '../repositories/note-timeline.repository';
import { NotePermissionRepository } from '../repositories/note-permission.repository';
import { NoteTimelineResponseDto } from '../dto';
import { PermissionLevel } from '../../../common/enums';

@Injectable()
export class NoteTimelineService {
  constructor(
    private readonly timelineRepository: NoteTimelineRepository,
    private readonly permissionRepository: NotePermissionRepository,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('NoteTimelineService');
  }

  async findByConsultation(
    consultationId: string,
    userId: string,
    workspaceId: string,
  ): Promise<NoteTimelineResponseDto[]> {
    this.logger.debug(`Finding timeline for consultation: ${consultationId}`);

    const timeline = await this.timelineRepository.findByConsultation(
      consultationId,
      workspaceId,
    );

    // Filter by permissions
    const accessible: any[] = [];
    for (const item of timeline) {
      const hasAccess = await this.permissionRepository.hasPermission(
        item.noteId,
        userId,
        PermissionLevel.READ,
        workspaceId,
      );

      if (hasAccess) {
        accessible.push(item);
      }
    }

    return accessible as any[];
  }

  async reorder(
    consultationId: string,
    noteId: string,
    newSequence: number,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.info(
      `Reordering timeline: consultation=${consultationId}, note=${noteId}, sequence=${newSequence}`,
    );

    // Check permission - need WRITE access
    const hasPermission = await this.permissionRepository.hasPermission(
      noteId,
      userId,
      PermissionLevel.WRITE,
      workspaceId,
    );

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    await this.timelineRepository.reorderTimeline(
      consultationId,
      noteId,
      newSequence,
      workspaceId,
    );

    this.logger.info('Timeline reordered successfully');

    try {
      await this.auditLogService.log({
        userId,
        action: 'REORDER_NOTE_TIMELINE',
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'CareNote',
        resourceId: noteId,
        justification: 'Consultation note timeline reordering',
        metadata: { consultationId, newSequence },
      }, workspaceId);
    } catch (auditError) {
      this.logger.error('Failed to create audit log for reorder', (auditError as Error).stack);
    }
  }
}
