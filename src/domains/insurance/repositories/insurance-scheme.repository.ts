import { Injectable } from '@nestjs/common';
import { DataSource, Repository, FindOptionsWhere } from 'typeorm';
import { InsuranceScheme } from '../entities/insurance-scheme.entity';
import { ProviderStatus } from '../entities/insurance-provider.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { QueryInsuranceSchemeDto } from '../dtos';
import { IPaginatedResult } from '../interfaces';

@Injectable()
export class InsuranceSchemeRepository extends Repository<InsuranceScheme> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(InsuranceScheme, dataSource.manager);
    this.logger.setContext('InsuranceSchemeRepository');
  }

  /** Find a scheme by its unique code. */
  async findByCode(code: string): Promise<InsuranceScheme | null> {
    return this.findOne({
      where: { schemeCode: code, isDeleted: false } as FindOptionsWhere<InsuranceScheme>,
    });
  }

  /** Paginated, filtered list of schemes. */
  async findWithFilters(query: QueryInsuranceSchemeDto): Promise<IPaginatedResult<InsuranceScheme>> {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;
    const skip  = (page - 1) * limit;

    const qb = this.createQueryBuilder('scheme')
      .leftJoinAndSelect('scheme.provider', 'provider')
      .where('scheme.isDeleted = :isDeleted', { isDeleted: false });

    if (query.providerId) {
      qb.andWhere('scheme.providerId = :providerId', { providerId: query.providerId });
    }

    if (query.schemeType) {
      qb.andWhere('scheme.schemeType = :schemeType', { schemeType: query.schemeType });
    }

    if (query.status) {
      qb.andWhere('scheme.status = :status', { status: query.status });
    }

    if (query.search) {
      qb.andWhere(
        '(scheme.schemeName LIKE :search OR scheme.schemeCode LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('provider.name', 'ASC').addOrderBy('scheme.schemeName', 'ASC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** All active schemes for a given provider. */
  async findByProvider(providerId: string): Promise<InsuranceScheme[]> {
    return this.find({
      where: {
        providerId,
        status: ProviderStatus.ACTIVE,
        isDeleted: false,
      } as FindOptionsWhere<InsuranceScheme>,
      order: { schemeName: 'ASC' },
    });
  }
}
