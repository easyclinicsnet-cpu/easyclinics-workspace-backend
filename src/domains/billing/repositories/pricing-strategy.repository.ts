import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { PricingStrategy } from '../entities/pricing-strategy.entity';
import { LoggerService } from '../../../common/logger/logger.service';

@Injectable()
export class PricingStrategyRepository extends Repository<PricingStrategy> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(PricingStrategy, dataSource.manager);
    this.logger.setContext('PricingStrategyRepository');
  }

  async findAllActive(): Promise<PricingStrategy[]> {
    return this.find({
      where: { isActive: true } as FindOptionsWhere<PricingStrategy>,
      order: { priority: 'ASC', name: 'ASC' },
    });
  }

  async findByStrategyType(strategyType: string): Promise<PricingStrategy[]> {
    return this.find({
      where: { strategyType, isActive: true } as FindOptionsWhere<PricingStrategy>,
      order: { priority: 'ASC' },
    });
  }

  async findByDepartment(department: string): Promise<PricingStrategy[]> {
    return this.find({
      where: { department, isActive: true } as FindOptionsWhere<PricingStrategy>,
      order: { priority: 'ASC' },
    });
  }

  async findByServiceType(serviceType: string): Promise<PricingStrategy[]> {
    return this.find({
      where: { serviceType, isActive: true } as FindOptionsWhere<PricingStrategy>,
      order: { priority: 'ASC' },
    });
  }

  async findBestStrategy(
    serviceType: string,
    department: string,
  ): Promise<PricingStrategy | null> {
    const now = new Date();
    return this.createQueryBuilder('strategy')
      .where('strategy.isActive = :isActive', { isActive: true })
      .andWhere('(strategy.serviceType = :serviceType OR strategy.serviceType IS NULL)', { serviceType })
      .andWhere('(strategy.department = :department OR strategy.department IS NULL)', { department })
      .andWhere('(strategy.validFrom IS NULL OR strategy.validFrom <= :now)', { now })
      .andWhere('(strategy.validUntil IS NULL OR strategy.validUntil >= :now)', { now })
      .orderBy('strategy.priority', 'ASC')
      .getOne();
  }
}
