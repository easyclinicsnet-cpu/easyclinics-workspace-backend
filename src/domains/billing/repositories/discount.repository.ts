import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Discount } from '../entities/discount.entity';
import { LoggerService } from '../../../common/logger/logger.service';

@Injectable()
export class DiscountRepository extends Repository<Discount> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(Discount, dataSource.manager);
    this.logger.setContext('DiscountRepository');
  }

  async findAllActive(): Promise<Discount[]> {
    return this.find({
      where: { isActive: true } as FindOptionsWhere<Discount>,
      order: { name: 'ASC' },
    });
  }

  async findValidDiscounts(): Promise<Discount[]> {
    const now = new Date();
    return this.createQueryBuilder('discount')
      .where('discount.isActive = :isActive', { isActive: true })
      .andWhere('(discount.validFrom IS NULL OR discount.validFrom <= :now)', { now })
      .andWhere('(discount.validUntil IS NULL OR discount.validUntil >= :now)', { now })
      .andWhere('(discount.usageLimit = 0 OR discount.usageCount < discount.usageLimit)')
      .orderBy('discount.name', 'ASC')
      .getMany();
  }

  async findByName(name: string): Promise<Discount | null> {
    return this.findOne({
      where: { name, isActive: true } as FindOptionsWhere<Discount>,
    });
  }

  async incrementUsage(discountId: string): Promise<void> {
    await this.createQueryBuilder()
      .update(Discount)
      .set({ usageCount: () => 'usageCount + 1' })
      .where('id = :id', { id: discountId })
      .execute();
  }
}
