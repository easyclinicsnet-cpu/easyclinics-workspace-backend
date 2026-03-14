import { Injectable } from '@nestjs/common';
import { DataSource, Repository, FindOptionsWhere, ILike } from 'typeorm';
import { InsuranceProvider, ProviderStatus } from '../entities/insurance-provider.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { QueryInsuranceProviderDto } from '../dtos';
import { IPaginatedResult } from '../interfaces';

@Injectable()
export class InsuranceProviderRepository extends Repository<InsuranceProvider> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(InsuranceProvider, dataSource.manager);
    this.logger.setContext('InsuranceProviderRepository');
  }

  /** Find a provider by its unique code. */
  async findByCode(code: string): Promise<InsuranceProvider | null> {
    return this.findOne({
      where: { providerCode: code, isDeleted: false } as FindOptionsWhere<InsuranceProvider>,
    });
  }

  /** Paginated, filtered list of providers. */
  async findWithFilters(query: QueryInsuranceProviderDto): Promise<IPaginatedResult<InsuranceProvider>> {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;
    const skip  = (page - 1) * limit;

    const qb = this.createQueryBuilder('provider')
      .where('provider.isDeleted = :isDeleted', { isDeleted: false });

    if (query.status) {
      qb.andWhere('provider.status = :status', { status: query.status });
    }

    if (query.search) {
      qb.andWhere(
        '(provider.name LIKE :search OR provider.shortName LIKE :search OR provider.providerCode LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('provider.name', 'ASC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Return all active providers (no pagination — for dropdown use). */
  async findAllActive(): Promise<InsuranceProvider[]> {
    return this.find({
      where: { status: ProviderStatus.ACTIVE, isDeleted: false } as FindOptionsWhere<InsuranceProvider>,
      order: { name: 'ASC' },
    });
  }
}
