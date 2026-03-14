import { Injectable } from '@nestjs/common';
import { DataSource, Repository, FindOptionsWhere } from 'typeorm';
import { PatientInsurance } from '../entities/patient-insurance.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { QueryPatientInsuranceDto } from '../dtos';
import { IPaginatedResult } from '../interfaces';

@Injectable()
export class PatientInsuranceRepository extends Repository<PatientInsurance> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(PatientInsurance, dataSource.manager);
    this.logger.setContext('PatientInsuranceRepository');
  }

  /**
   * Find a patient's active insurance record within a workspace.
   * Uses the composite unique index (workspaceId, patientId).
   */
  async findByPatientId(patientId: string, workspaceId: string): Promise<PatientInsurance | null> {
    return this.findOne({
      where: { patientId, workspaceId, isDeleted: false } as FindOptionsWhere<PatientInsurance>,
      relations: ['insuranceProvider', 'scheme'],
    });
  }

  /** Find by UUID with all relations loaded. */
  async findByIdWithRelations(id: string): Promise<PatientInsurance | null> {
    return this.createQueryBuilder('pi')
      .leftJoinAndSelect('pi.insuranceProvider', 'provider')
      .leftJoinAndSelect('pi.scheme', 'scheme')
      .where('pi.id = :id', { id })
      .andWhere('pi.isDeleted = :isDeleted', { isDeleted: false })
      .getOne();
  }

  /** Paginated, filtered list scoped to a workspace. */
  async findWithFilters(
    query: QueryPatientInsuranceDto,
    workspaceId: string,
  ): Promise<IPaginatedResult<PatientInsurance>> {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;
    const skip  = (page - 1) * limit;

    const qb = this.createQueryBuilder('pi')
      .leftJoinAndSelect('pi.insuranceProvider', 'provider')
      .leftJoinAndSelect('pi.scheme', 'scheme')
      .where('pi.isDeleted = :isDeleted',     { isDeleted: false })
      .andWhere('pi.workspaceId = :workspaceId', { workspaceId });

    if (query.patientId) {
      qb.andWhere('pi.patientId = :patientId', { patientId: query.patientId });
    }

    if (query.insuranceProviderId) {
      qb.andWhere('pi.insuranceProviderId = :insuranceProviderId', {
        insuranceProviderId: query.insuranceProviderId,
      });
    }

    if (query.schemeId) {
      qb.andWhere('pi.schemeId = :schemeId', { schemeId: query.schemeId });
    }

    if (query.memberType) {
      qb.andWhere('pi.memberType = :memberType', { memberType: query.memberType });
    }

    if (query.status) {
      qb.andWhere('pi.status = :status', { status: query.status });
    }

    if (query.search) {
      qb.andWhere(
        '(pi.membershipNumber LIKE :search OR pi.policyNumber LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('pi.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
