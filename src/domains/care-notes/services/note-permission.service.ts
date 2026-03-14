import { IsNull } from 'typeorm';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { NotePermissionRepository } from '../repositories/note-permission.repository';
import { CareNoteRepository } from '../repositories/care-note.repository';
import { CareNotePermission } from '../entities/care-note-permission.entity';
import {
  CreateNotePermissionDto,
  UpdateNotePermissionDto,
  NotePermissionQueryDto,
  NotePermissionResponseDto,
  PaginatedResponseDto,
} from '../dto';
import {
  PermissionLevel,
  AuditEventType,
  AuditOutcome,
  NoteAuditActionType,
  UserRole,
} from '../../../common/enums';

@Injectable()
export class NotePermissionService {
  constructor(
    private readonly permissionRepository: NotePermissionRepository,
    private readonly careNoteRepository: CareNoteRepository,
    private readonly auditLogService: AuditLogService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('NotePermissionService');
  }

  private isElevatedRole(role?: string): boolean {
    return role === UserRole.WORKSPACE_OWNER || role === UserRole.ADMIN;
  }

  async create(
    dto: CreateNotePermissionDto,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<NotePermissionResponseDto> {
    this.logger.info(
      `Creating note permission: note=${dto.noteId}, user=${dto.userId}`,
    );

    // Check note exists
    const note = await this.careNoteRepository.findOne({
      where: { id: dto.noteId, workspaceId, deletedAt: IsNull() },
    });

    if (!note) {
      throw new NotFoundException('Care note not found');
    }

    // Check if granting user has ADMIN permission
    await this.checkAdminPermission(dto.noteId, userId, workspaceId, userRole);

    // Check if permission already exists
    const existing = await this.permissionRepository.findByNoteAndUser(
      dto.noteId,
      dto.userId,
      workspaceId,
    );

    if (existing) {
      throw new ConflictException('Permission already exists');
    }

    try {
      const permission = this.permissionRepository.create({
        ...dto,
        workspaceId,
        grantedBy: userId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      } as any);

      const saved = (await this.permissionRepository.save(permission) as unknown) as CareNotePermission;

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.CREATE,
          entityType: 'NotePermission',
          entityId: saved.id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.PERMISSION_CHANGE,
            noteId: dto.noteId,
            targetUserId: dto.userId,
            permissionLevel: dto.permissionLevel,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Note permission created successfully: ${saved.id}`);
      return saved as any;
    } catch (error) {
      this.logger.error('Failed to create note permission', error);
      throw error;
    }
  }

  async findByNote(
    noteId: string,
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
    userRole?: string,
  ): Promise<PaginatedResponseDto<NotePermissionResponseDto>> {
    this.logger.debug(`Finding permissions by note: ${noteId}`);

    // Check if user is author or has ADMIN permission
    await this.checkAdminPermission(noteId, userId, workspaceId, userRole);

    try {
      const [permissions, total] =
        await this.permissionRepository.findByNote(
          noteId,
          workspaceId,
          page,
          limit,
        );

      const data = permissions as any[];

      return new PaginatedResponseDto(data, total, page, limit);
    } catch (error) {
      this.logger.error('Failed to find permissions by note', error);
      throw error;
    }
  }

  async findByUser(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponseDto<NotePermissionResponseDto>> {
    this.logger.debug(`Finding permissions by user: ${userId}`);

    try {
      const [permissions, total] =
        await this.permissionRepository.findByUser(
          userId,
          workspaceId,
          page,
          limit,
        );

      const data = permissions as any[];

      return new PaginatedResponseDto(data, total, page, limit);
    } catch (error) {
      this.logger.error('Failed to find permissions by user', error);
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateNotePermissionDto,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<NotePermissionResponseDto> {
    this.logger.info(`Updating note permission: ${id}`);

    const permission = await this.permissionRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    // Check if permission is for the author (cannot modify author permissions)
    const note = await this.careNoteRepository.findOne({
      where: { id: permission.noteId, workspaceId, deletedAt: IsNull() },
    });

    if (note && note.authorId === permission.userId) {
      throw new ForbiddenException('Cannot modify author permissions');
    }

    // Check if updating user has ADMIN permission
    await this.checkAdminPermission(permission.noteId, userId, workspaceId, userRole);

    try {
      Object.assign(permission, dto);
      if (dto.expiresAt) {
        permission.expiresAt = new Date(dto.expiresAt);
      }

      const updated = await this.permissionRepository.save(permission);

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.UPDATE,
          entityType: 'NotePermission',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.PERMISSION_CHANGE,
            noteId: permission.noteId,
            targetUserId: permission.userId,
            changes: dto,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Note permission updated successfully: ${id}`);
      return updated as any;
    } catch (error) {
      this.logger.error('Failed to update note permission', error);
      throw error;
    }
  }

  async remove(
    id: string,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<void> {
    this.logger.info(`Revoking note permission: ${id}`);

    const permission = await this.permissionRepository.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
    });

    if (!permission) {
      throw new NotFoundException('Permission not found');
    }

    // Check if permission is for the author (cannot revoke author permissions)
    const note = await this.careNoteRepository.findOne({
      where: { id: permission.noteId, workspaceId, deletedAt: IsNull() },
    });

    if (note && note.authorId === permission.userId) {
      throw new ForbiddenException('Cannot revoke author permissions');
    }

    // Check if revoking user has ADMIN permission
    await this.checkAdminPermission(permission.noteId, userId, workspaceId, userRole);

    try {
      await this.permissionRepository.softDelete({ id, workspaceId });

      // Audit log
      try {
        await this.auditLogService.log({
          eventType: AuditEventType.DELETE,
          entityType: 'NotePermission',
          entityId: id,
          userId,
          workspaceId,
          outcome: AuditOutcome.SUCCESS,
          metadata: {
            action: NoteAuditActionType.PERMISSION_CHANGE,
            noteId: permission.noteId,
            targetUserId: permission.userId,
            permissionLevel: permission.permissionLevel,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create audit log', error);
      }

      this.logger.info(`Note permission revoked successfully: ${id}`);
    } catch (error) {
      this.logger.error('Failed to revoke note permission', error);
      throw error;
    }
  }

  async hasPermission(
    noteId: string,
    userId: string,
    level: PermissionLevel,
    workspaceId: string,
    userRole?: string,
  ): Promise<boolean> {
    this.logger.debug(
      `Checking permission: note=${noteId}, user=${userId}, level=${level}`,
    );

    // Workspace owners and system admins have full access to all notes
    if (this.isElevatedRole(userRole)) {
      return true;
    }

    // Check if user is author
    const note = await this.careNoteRepository.findOne({
      where: { id: noteId, workspaceId, deletedAt: IsNull() },
    });

    if (note && note.authorId === userId) {
      return true; // Author has full access
    }

    return this.permissionRepository.hasPermission(
      noteId,
      userId,
      level,
      workspaceId,
    );
  }

  async getUserPermissionLevel(
    noteId: string,
    userId: string,
    workspaceId: string,
    userRole?: string,
  ): Promise<PermissionLevel | null> {
    this.logger.debug(
      `Getting user permission level: note=${noteId}, user=${userId}`,
    );

    // Workspace owners and system admins always have OWNER-level access
    if (this.isElevatedRole(userRole)) {
      return PermissionLevel.OWNER;
    }

    // Check if user is author
    const note = await this.careNoteRepository.findOne({
      where: { id: noteId, workspaceId, deletedAt: IsNull() },
    });

    if (note && note.authorId === userId) {
      return PermissionLevel.OWNER; // Author has OWNER level
    }

    return this.permissionRepository.getUserPermissionLevel(
      noteId,
      userId,
      workspaceId,
    );
  }

  // Helper methods

  private async checkAdminPermission(
    noteId: string,
    userId: string,
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

    // Check ADMIN permission
    const hasPermission = await this.permissionRepository.hasPermission(
      noteId,
      userId,
      PermissionLevel.ADMIN,
      workspaceId,
    );

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
