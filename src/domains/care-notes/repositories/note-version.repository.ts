import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { NoteVersion } from '../entities/note-version.entity';

@Injectable()
export class NoteVersionRepository extends Repository<NoteVersion> {
  constructor(
    private dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(NoteVersion, dataSource.createEntityManager());
    this.logger.setContext('NoteVersionRepository');
  }

  async findByNote(
    noteId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[NoteVersion[], number]> {
    this.logger.debug(`Finding versions by note: ${noteId}, page: ${page}`);

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { noteId, workspaceId },
      relations: ['changedBy'],
      order: { versionNumber: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findByVersionNumber(
    noteId: string,
    versionNumber: number,
    workspaceId: string,
  ): Promise<NoteVersion | null> {
    this.logger.debug(
      `Finding version by number: note=${noteId}, version=${versionNumber}`,
    );

    return this.findOne({
      where: { noteId, versionNumber, workspaceId },
      relations: ['changedBy', 'note'],
    });
  }

  async getLatestVersion(
    noteId: string,
    workspaceId: string,
  ): Promise<NoteVersion | null> {
    this.logger.debug(`Getting latest version for note: ${noteId}`);

    return this.findOne({
      where: { noteId, workspaceId },
      relations: ['changedBy'],
      order: { versionNumber: 'DESC' },
    });
  }
}
