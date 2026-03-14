import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, MoreThanOrEqual, LessThanOrEqual, Between , IsNull } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { SickNote } from '../entities/sick-note.entity';
import { SickNoteQueryDto } from '../dto';
import { SickNoteStatus } from '../../../common/enums';

@Injectable()
export class SickNoteRepository extends EncryptedRepository<SickNote> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(SickNote, dataSource, aesService, logger);
    this.logger.setContext('SickNoteRepository');
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['diagnosis', 'clinicalSummary'];
  }

  protected getSearchFilters(): Partial<FindOptionsWhere<SickNote>> {
    return { deletedAt: IsNull() };
  }

  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[SickNote[], number]> {
    this.logger.debug(
      `Finding sick notes by patient: ${patientId}, page: ${page}`,
    );

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { patientId, workspaceId, deletedAt: IsNull() },
      relations: ['doctor', 'consultation', 'originalNote', 'extensions'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findByDoctor(
    doctorId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[SickNote[], number]> {
    this.logger.debug(
      `Finding sick notes by doctor: ${doctorId}, page: ${page}`,
    );

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { doctorId, workspaceId, deletedAt: IsNull() },
      relations: ['patient', 'consultation'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findActive(
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[SickNote[], number]> {
    this.logger.debug(`Finding active sick notes, page: ${page}`);

    const skip = (page - 1) * limit;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.findAndCount({
      where: {
        status: SickNoteStatus.ISSUED,
        endDate: MoreThanOrEqual(today),
        workspaceId,
        deletedAt: IsNull(),
      },
      relations: ['patient', 'doctor'],
      order: { endDate: 'ASC' },
      skip,
      take: limit,
    });
  }

  async findExpiring(
    days: number,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[SickNote[], number]> {
    this.logger.debug(
      `Finding sick notes expiring in ${days} days, page: ${page}`,
    );

    const skip = (page - 1) * limit;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + days);

    return this.findAndCount({
      where: {
        status: SickNoteStatus.ISSUED,
        endDate: Between(today, endDate),
        workspaceId,
        deletedAt: IsNull(),
      },
      relations: ['patient', 'doctor'],
      order: { endDate: 'ASC' },
      skip,
      take: limit,
    });
  }

  async findWithFilters(
    query: SickNoteQueryDto,
    workspaceId: string,
  ): Promise<[SickNote[], number]> {
    this.logger.debug('Finding sick notes with filters');

    const queryBuilder = this.createQueryBuilder('sickNote')
      .leftJoinAndSelect('sickNote.patient', 'patient')
      .leftJoinAndSelect('sickNote.doctor', 'doctor')
      .leftJoinAndSelect('sickNote.consultation', 'consultation')
      .leftJoinAndSelect('sickNote.originalNote', 'originalNote')
      .where('sickNote.workspaceId = :workspaceId', { workspaceId })
      .andWhere('sickNote.deletedAt IS NULL');

    if (query.patientId) {
      queryBuilder.andWhere('sickNote.patientId = :patientId', {
        patientId: query.patientId,
      });
    }

    if (query.doctorId) {
      queryBuilder.andWhere('sickNote.doctorId = :doctorId', {
        doctorId: query.doctorId,
      });
    }

    if (query.status) {
      queryBuilder.andWhere('sickNote.status = :status', {
        status: query.status,
      });
    }

    if (query.isActive !== undefined && query.isActive) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      queryBuilder
        .andWhere('sickNote.status = :issuedStatus', {
          issuedStatus: SickNoteStatus.ISSUED,
        })
        .andWhere('sickNote.endDate >= :today', { today });
    }

    if (query.startDate) {
      queryBuilder.andWhere('sickNote.startDate >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }

    if (query.endDate) {
      queryBuilder.andWhere('sickNote.endDate <= :endDate', {
        endDate: new Date(query.endDate),
      });
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    queryBuilder
      .orderBy('sickNote.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    return queryBuilder.getManyAndCount();
  }
}
