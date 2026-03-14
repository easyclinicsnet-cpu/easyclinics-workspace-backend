import { Injectable } from '@nestjs/common';
import { DataSource, Repository, FindOptionsWhere } from 'typeorm';
import { InsuranceContract } from '../entities/insurance-contract.entity';
import { ProviderStatus } from '../entities/insurance-provider.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { QueryInsuranceContractDto } from '../dtos';
import { IPaginatedResult } from '../interfaces';

@Injectable()
export class InsuranceContractRepository extends Repository<InsuranceContract> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(InsuranceContract, dataSource.manager);
    this.logger.setContext('InsuranceContractRepository');
  }

  /**
   * Find a contract by workspace + contract number (composite unique key).
   */
  async findByContractNumber(
    contractNumber: string,
    workspaceId: string,
  ): Promise<InsuranceContract | null> {
    return this.findOne({
      where: { contractNumber, workspaceId, isDeleted: false } as FindOptionsWhere<InsuranceContract>,
    });
  }

  /** Paginated, filtered list of contracts scoped to a workspace. */
  async findWithFilters(
    query: QueryInsuranceContractDto,
    workspaceId: string,
  ): Promise<IPaginatedResult<InsuranceContract>> {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;
    const skip  = (page - 1) * limit;

    const qb = this.createQueryBuilder('contract')
      .leftJoinAndSelect('contract.insuranceProvider', 'provider')
      .leftJoinAndSelect('contract.scheme', 'scheme')
      .where('contract.isDeleted = :isDeleted',       { isDeleted: false })
      .andWhere('contract.workspaceId = :workspaceId', { workspaceId });

    if (query.insuranceProviderId) {
      qb.andWhere('contract.insuranceProviderId = :insuranceProviderId', {
        insuranceProviderId: query.insuranceProviderId,
      });
    }

    if (query.schemeId) {
      qb.andWhere('contract.schemeId = :schemeId', { schemeId: query.schemeId });
    }

    if (query.contractType) {
      qb.andWhere('contract.contractType = :contractType', { contractType: query.contractType });
    }

    if (query.status) {
      qb.andWhere('contract.status = :status', { status: query.status });
    }

    if (query.search) {
      qb.andWhere(
        '(contract.contractName LIKE :search OR contract.contractNumber LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('contract.startDate', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** All active contracts for a provider within a workspace. */
  async findByProvider(providerId: string, workspaceId: string): Promise<InsuranceContract[]> {
    return this.find({
      where: {
        insuranceProviderId: providerId,
        workspaceId,
        status:    ProviderStatus.ACTIVE,
        isDeleted: false,
      } as FindOptionsWhere<InsuranceContract>,
      order: { startDate: 'DESC' },
    });
  }

  /** Contracts expiring within the next `days` days for a workspace. */
  async findExpiringSoon(days: number = 30, workspaceId: string): Promise<InsuranceContract[]> {
    const today  = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    return this.createQueryBuilder('contract')
      .where('contract.isDeleted = :isDeleted',       { isDeleted: false })
      .andWhere('contract.workspaceId = :workspaceId', { workspaceId })
      .andWhere('contract.status = :status',           { status: ProviderStatus.ACTIVE })
      .andWhere('contract.endDate >= :today',          { today })
      .andWhere('contract.endDate <= :cutoff',         { cutoff })
      .orderBy('contract.endDate', 'ASC')
      .getMany();
  }
}
