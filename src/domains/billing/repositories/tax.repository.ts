import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Tax } from '../entities/tax.entity';
import { LoggerService } from '../../../common/logger/logger.service';

@Injectable()
export class TaxRepository extends Repository<Tax> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(Tax, dataSource.manager);
    this.logger.setContext('TaxRepository');
  }

  async findAllActive(): Promise<Tax[]> {
    return this.find({
      where: { isActive: true } as FindOptionsWhere<Tax>,
      order: { name: 'ASC' },
    });
  }

  async findValidTaxes(): Promise<Tax[]> {
    const now = new Date();
    return this.createQueryBuilder('tax')
      .where('tax.isActive = :isActive', { isActive: true })
      .andWhere('(tax.effectiveFrom IS NULL OR tax.effectiveFrom <= :now)', { now })
      .andWhere('(tax.effectiveUntil IS NULL OR tax.effectiveUntil >= :now)', { now })
      .orderBy('tax.name', 'ASC')
      .getMany();
  }

  async findByName(name: string): Promise<Tax | null> {
    return this.findOne({
      where: { name, isActive: true } as FindOptionsWhere<Tax>,
    });
  }

  async findByType(taxType: string): Promise<Tax[]> {
    return this.find({
      where: { taxType, isActive: true } as FindOptionsWhere<Tax>,
      order: { name: 'ASC' },
    });
  }
}
