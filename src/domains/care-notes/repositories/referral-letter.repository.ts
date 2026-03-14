import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere , IsNull } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { ReferralLetter } from '../entities/referral-letter.entity';
import { ReferralLetterQueryDto } from '../dto';
import { ReferralStatus } from '../../../common/enums';

@Injectable()
export class ReferralLetterRepository extends EncryptedRepository<ReferralLetter> {
  constructor(
    dataSource: DataSource,
    aesService: Aes256Service,
    logger: LoggerService,
  ) {
    super(ReferralLetter, dataSource, aesService, logger);
    this.logger.setContext('ReferralLetterRepository');
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['clinicalSummary', 'reasonForReferral'];
  }

  protected getSearchFilters(): Partial<FindOptionsWhere<ReferralLetter>> {
    return { deletedAt: IsNull() };
  }

  async findByPatient(
    patientId: string,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[ReferralLetter[], number]> {
    this.logger.debug(
      `Finding referral letters by patient: ${patientId}, page: ${page}`,
    );

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { patientId, workspaceId, deletedAt: IsNull() },
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
  ): Promise<[ReferralLetter[], number]> {
    this.logger.debug(
      `Finding referral letters by doctor: ${doctorId}, page: ${page}`,
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

  async findByStatus(
    status: ReferralStatus,
    workspaceId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<[ReferralLetter[], number]> {
    this.logger.debug(
      `Finding referral letters by status: ${status}, page: ${page}`,
    );

    const skip = (page - 1) * limit;

    return this.findAndCount({
      where: { status, workspaceId, deletedAt: IsNull() },
      relations: ['patient', 'doctor'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
  }

  async findWithFilters(
    query: ReferralLetterQueryDto,
    workspaceId: string,
  ): Promise<[ReferralLetter[], number]> {
    this.logger.debug('Finding referral letters with filters');

    const queryBuilder = this.createQueryBuilder('referral')
      .leftJoinAndSelect('referral.patient', 'patient')
      .leftJoinAndSelect('referral.doctor', 'doctor')
      .leftJoinAndSelect('referral.consultation', 'consultation')
      .where('referral.workspaceId = :workspaceId', { workspaceId })
      .andWhere('referral.deletedAt IS NULL');

    if (query.patientId) {
      queryBuilder.andWhere('referral.patientId = :patientId', {
        patientId: query.patientId,
      });
    }

    if (query.doctorId) {
      queryBuilder.andWhere('referral.doctorId = :doctorId', {
        doctorId: query.doctorId,
      });
    }

    if (query.status) {
      queryBuilder.andWhere('referral.status = :status', {
        status: query.status,
      });
    }

    if (query.urgency) {
      queryBuilder.andWhere('referral.urgency = :urgency', {
        urgency: query.urgency,
      });
    }

    if (query.dateFrom) {
      queryBuilder.andWhere('referral.createdAt >= :dateFrom', {
        dateFrom: new Date(query.dateFrom),
      });
    }

    if (query.dateTo) {
      queryBuilder.andWhere('referral.createdAt <= :dateTo', {
        dateTo: new Date(query.dateTo),
      });
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    queryBuilder
      .orderBy('referral.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    return queryBuilder.getManyAndCount();
  }
}
