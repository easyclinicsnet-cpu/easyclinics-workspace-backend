import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere , IsNull } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { CareNoteTemplate } from '../entities/care-note-template.entity';
import { NoteTemplateQueryDto } from '../dto';
import { CareNoteType, TemplateCategory } from '../../../common/enums';

@Injectable()
export class NoteTemplateRepository extends EncryptedRepository<CareNoteTemplate> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(CareNoteTemplate, dataSource, aesService, logger);
    this.logger.setContext('NoteTemplateRepository');
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['name', 'description'];
  }

  protected getSearchFilters(): Partial<FindOptionsWhere<CareNoteTemplate>> {
    return { deletedAt: IsNull() };
  }

  async findByCategory(
    category: TemplateCategory,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNoteTemplate[], number]> {
    this.logger.debug(`Finding templates by category: ${category}, page: ${page}`);

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { category, workspaceId, deletedAt: IsNull() },
      relations: ['creator'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findByNoteType(
    noteType: CareNoteType,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNoteTemplate[], number]> {
    this.logger.debug(`Finding templates by note type: ${noteType}, page: ${page}`);

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { noteType, workspaceId, deletedAt: IsNull() },
      relations: ['creator'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findPublicTemplates(
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNoteTemplate[], number]> {
    this.logger.debug(`Finding public templates, page: ${page}`);

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { isPublic: true, workspaceId, deletedAt: IsNull() },
      relations: ['creator'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findByCreator(
    createdBy: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNoteTemplate[], number]> {
    this.logger.debug(`Finding templates by creator: ${createdBy}, page: ${page}`);

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { createdBy, workspaceId, deletedAt: IsNull() },
      relations: ['creator'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findWithFilters(
    query: NoteTemplateQueryDto,
    workspaceId: string,
  ): Promise<[CareNoteTemplate[], number]> {
    this.logger.debug('Finding templates with filters');

    const queryBuilder = this.createQueryBuilder('template')
      .leftJoinAndSelect('template.creator', 'creator')
      .where('template.workspaceId = :workspaceId', { workspaceId })
      .andWhere('template.deletedAt IS NULL');

    if (query.category) {
      queryBuilder.andWhere('template.category = :category', {
        category: query.category,
      });
    }

    if (query.noteType) {
      queryBuilder.andWhere('template.noteType = :noteType', {
        noteType: query.noteType,
      });
    }

    if (query.isPublic !== undefined) {
      queryBuilder.andWhere('template.isPublic = :isPublic', {
        isPublic: query.isPublic,
      });
    }

    if (query.isDefault !== undefined) {
      queryBuilder.andWhere('template.isDefault = :isDefault', {
        isDefault: query.isDefault,
      });
    }

    if (query.createdBy) {
      queryBuilder.andWhere('template.createdBy = :createdBy', {
        createdBy: query.createdBy,
      });
    }

    if (query.search) {
      queryBuilder.andWhere(
        '(template.name LIKE :search OR template.description LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    queryBuilder
      .orderBy('template.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    return queryBuilder.getManyAndCount();
  }
}
