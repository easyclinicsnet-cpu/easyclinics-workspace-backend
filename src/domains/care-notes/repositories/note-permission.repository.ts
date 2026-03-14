import { Injectable } from '@nestjs/common';
import { DataSource, Repository , IsNull } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { CareNotePermission } from '../entities/care-note-permission.entity';
import { PermissionLevel } from '../../../common/enums';

@Injectable()
export class NotePermissionRepository extends Repository<CareNotePermission> {
  constructor(
    private dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(CareNotePermission, dataSource.createEntityManager());
    this.logger.setContext('NotePermissionRepository');
  }

  async findByNote(
    noteId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNotePermission[], number]> {
    this.logger.debug(`Finding permissions by note: ${noteId}, page: ${page}`);

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { noteId, workspaceId, deletedAt: IsNull() },
      relations: ['user', 'grantedBy'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findByUser(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNotePermission[], number]> {
    this.logger.debug(`Finding permissions by user: ${userId}, page: ${page}`);

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { userId, workspaceId, deletedAt: IsNull() },
      relations: ['note', 'note.consultation', 'grantedBy'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findByNoteAndUser(
    noteId: string,
    userId: string,
    workspaceId: string,
  ): Promise<CareNotePermission | null> {
    this.logger.debug(
      `Finding permission by note and user: ${noteId}, ${userId}`,
    );

    return this.findOne({
      where: { noteId, userId, workspaceId, deletedAt: IsNull() },
      relations: ['user', 'grantedBy'],
    });
  }

  async hasPermission(
    noteId: string,
    userId: string,
    level: PermissionLevel,
    workspaceId: string,
  ): Promise<boolean> {
    this.logger.debug(
      `Checking permission: note=${noteId}, user=${userId}, level=${level}`,
    );

    const permission = await this.findOne({
      where: { noteId, userId, workspaceId, deletedAt: IsNull() },
    });

    if (!permission) {
      return false;
    }

    // Check if permission is expired
    if (permission.expiresAt && permission.expiresAt < new Date()) {
      this.logger.debug('Permission has expired');
      return false;
    }

    // Permission hierarchy: READ < WRITE < ADMIN < OWNER
    const levels = [
      PermissionLevel.READ,
      PermissionLevel.WRITE,
      PermissionLevel.ADMIN,
      PermissionLevel.OWNER,
    ];
    const userLevelIndex = levels.indexOf(permission.permissionLevel);
    const requiredLevelIndex = levels.indexOf(level);

    return userLevelIndex >= requiredLevelIndex;
  }

  async getUserPermissionLevel(
    noteId: string,
    userId: string,
    workspaceId: string,
  ): Promise<PermissionLevel | null> {
    this.logger.debug(
      `Getting user permission level: note=${noteId}, user=${userId}`,
    );

    const permission = await this.findOne({
      where: { noteId, userId, workspaceId, deletedAt: IsNull() },
    });

    if (!permission) {
      return null;
    }

    // Check if permission is expired
    if (permission.expiresAt && permission.expiresAt < new Date()) {
      this.logger.debug('Permission has expired');
      return null;
    }

    return permission.permissionLevel;
  }
}
