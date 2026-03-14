import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { RecordingsTranscript } from '../entities/recordings-transcript.entity';

@Injectable()
export class RecordingsTranscriptRepository extends EncryptedRepository<RecordingsTranscript> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(RecordingsTranscript, dataSource, aesService, logger);
    this.logger.setContext('RecordingsTranscriptRepository');
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['transcribedText'];
  }

  protected getSearchFilters(): Partial<
    FindOptionsWhere<RecordingsTranscript>
  > {
    return {};
  }

  async findByConsultation(
    consultationId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[RecordingsTranscript[], number]> {
    this.logger.debug(
      `Finding transcripts by consultation: ${consultationId}, page: ${page}`,
    );

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { consultationId, workspaceId },
      relations: ['doctor', 'consultation'],
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
  ): Promise<[RecordingsTranscript[], number]> {
    this.logger.debug(
      `Finding transcripts by doctor: ${doctorId}, page: ${page}`,
    );

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { doctorId, workspaceId },
      relations: ['consultation', 'consultation.patient'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findWithFilters(
    query: any,
    workspaceId: string,
  ): Promise<[RecordingsTranscript[], number]> {
    this.logger.debug('Finding transcripts with filters');

    const queryBuilder = this.createQueryBuilder('transcript')
      .leftJoinAndSelect('transcript.doctor', 'doctor')
      .leftJoinAndSelect('transcript.consultation', 'consultation')
      .where('transcript.workspaceId = :workspaceId', { workspaceId });

    if (query.consultationId) {
      queryBuilder.andWhere('transcript.consultationId = :consultationId', {
        consultationId: query.consultationId,
      });
    }

    if (query.doctorId) {
      queryBuilder.andWhere('transcript.doctorId = :doctorId', {
        doctorId: query.doctorId,
      });
    }

    if (query.provider) {
      queryBuilder.andWhere('transcript.provider = :provider', {
        provider: query.provider,
      });
    }

    if (query.dateFrom) {
      queryBuilder.andWhere('transcript.createdAt >= :dateFrom', {
        dateFrom: new Date(query.dateFrom),
      });
    }

    if (query.dateTo) {
      queryBuilder.andWhere('transcript.createdAt <= :dateTo', {
        dateTo: new Date(query.dateTo),
      });
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    queryBuilder
      .orderBy('transcript.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    return queryBuilder.getManyAndCount();
  }
}
