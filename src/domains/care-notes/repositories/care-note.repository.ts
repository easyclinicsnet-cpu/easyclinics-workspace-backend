import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere , IsNull } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { CareNote } from '../entities/care-note.entity';
import { NoteVersion } from '../entities/note-version.entity';
import { CareNoteQueryDto } from '../dto';

@Injectable()
export class CareNoteRepository extends EncryptedRepository<CareNote> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(CareNote, dataSource, aesService, logger);
    this.logger.setContext('CareNoteRepository');
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['content'];
  }

  protected getSearchFilters(): Partial<FindOptionsWhere<CareNote>> {
    return { deletedAt: IsNull() };
  }

  async findByIdWithRelations(
    id: string,
    workspaceId: string,
  ): Promise<CareNote | null> {
    this.logger.debug(`Finding care note by ID with relations: ${id}`);

    return this.findOne({
      where: { id, workspaceId, deletedAt: IsNull() },
      relations: [
        'consultation',
        'consultation.patient',
      ],
    });
  }

  async findByConsultation(
    consultationId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNote[], number]> {
    this.logger.debug(
      `Finding care notes by consultation: ${consultationId}, page: ${page}`,
    );

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { consultationId, workspaceId, deletedAt: IsNull() },
      relations: ['consultation'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNote[], number]> {
    this.logger.debug(`Finding care notes by patient: ${patientId}, page: ${page}`);

    const skip = (page - 1) * limit;

    const queryBuilder = this.createQueryBuilder('note')
      .leftJoinAndSelect('note.consultation', 'consultation')
      .where('note.workspaceId = :workspaceId', { workspaceId })
      .andWhere('note.deletedAt IS NULL')
      .andWhere('consultation.patientId = :patientId', { patientId })
      .orderBy('note.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const [notes, total] = await queryBuilder.getManyAndCount();
    await Promise.all(notes.map((note) => this.decryptEntityFields(note)));
    return [notes, total];
  }

  async findByAuthor(
    authorId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNote[], number]> {
    this.logger.debug(`Finding care notes by author: ${authorId}, page: ${page}`);

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { authorId, workspaceId, deletedAt: IsNull() },
      relations: ['consultation', 'consultation.patient'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findWithPermissions(
    userId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[CareNote[], number]> {
    this.logger.debug(
      `Finding care notes with permissions for user: ${userId}, page: ${page}`,
    );

    const skip = (page - 1) * limit;

    const queryBuilder = this.createQueryBuilder('note')
      .leftJoinAndSelect('note.consultation', 'consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .where('note.workspaceId = :workspaceId', { workspaceId })
      .andWhere('note.deletedAt IS NULL')
      .andWhere('note.authorId = :userId', { userId })
      .orderBy('note.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const [notes, total] = await queryBuilder.getManyAndCount();
    await Promise.all(notes.map((note) => this.decryptEntityFields(note)));
    return [notes, total];
  }

  async findWithFilters(
    query: CareNoteQueryDto,
    workspaceId: string,
  ): Promise<[CareNote[], number]> {
    this.logger.debug('Finding care notes with filters');

    const queryBuilder = this.createQueryBuilder('note')
      .leftJoinAndSelect('note.consultation', 'consultation')
      .leftJoinAndSelect('consultation.patient', 'patient')
      .where('note.workspaceId = :workspaceId', { workspaceId })
      .andWhere('note.deletedAt IS NULL');

    if (query.consultationId) {
      queryBuilder.andWhere('note.consultationId = :consultationId', {
        consultationId: query.consultationId,
      });
    }

    if (query.type) {
      queryBuilder.andWhere('note.type = :type', { type: query.type });
    }

    if (query.status) {
      queryBuilder.andWhere('note.status = :status', { status: query.status });
    }

    if (query.authorId) {
      queryBuilder.andWhere('note.authorId = :authorId', {
        authorId: query.authorId,
      });
    }

    if (query.isAiGenerated !== undefined) {
      queryBuilder.andWhere('note.isAiGenerated = :isAiGenerated', {
        isAiGenerated: query.isAiGenerated,
      });
    }

    if (query.dateFrom) {
      queryBuilder.andWhere('note.createdAt >= :dateFrom', {
        dateFrom: new Date(query.dateFrom),
      });
    }

    if (query.dateTo) {
      queryBuilder.andWhere('note.createdAt <= :dateTo', {
        dateTo: new Date(query.dateTo),
      });
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    queryBuilder
      .orderBy(`note.${query.sortBy || 'createdAt'}`, query.sortOrder || 'DESC')
      .skip(skip)
      .take(limit);

    const [notes, total] = await queryBuilder.getManyAndCount();
    await Promise.all(notes.map((note) => this.decryptEntityFields(note)));
    return [notes, total];
  }

  async createVersion(note: CareNote): Promise<NoteVersion> {
    this.logger.debug(`Creating version for note: ${note.id}`);

    const versionRepository = this.manager.getRepository(NoteVersion);
    const version = versionRepository.create({
      noteId: note.id,
      workspaceId: note.workspaceId,
      versionNumber: note.versionNumber,
      content: note.content,
      createdBy: note.authorId,
    });

    return versionRepository.save(version) as Promise<NoteVersion>;
  }

  async incrementVersion(noteId: string, workspaceId: string): Promise<void> {
    this.logger.debug(`Incrementing version for note: ${noteId}`);

    await this.increment(
      { id: noteId, workspaceId, deletedAt: IsNull() },
      'versionNumber',
      1,
    );
  }
}
