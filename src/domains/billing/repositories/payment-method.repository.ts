import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { PaymentMethod } from '../entities/payment-method.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { PaymentMethodType } from '../../../common/enums';

@Injectable()
export class PaymentMethodRepository extends Repository<PaymentMethod> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(PaymentMethod, dataSource.manager);
    this.logger.setContext('PaymentMethodRepository');
  }

  async findActiveByType(type: PaymentMethodType): Promise<PaymentMethod | null> {
    return this.findOne({
      where: { type, isActive: true } as FindOptionsWhere<PaymentMethod>,
    });
  }

  async findAllActive(): Promise<PaymentMethod[]> {
    return this.find({
      where: { isActive: true } as FindOptionsWhere<PaymentMethod>,
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async findByName(name: string): Promise<PaymentMethod | null> {
    return this.findOne({
      where: { name, isActive: true } as FindOptionsWhere<PaymentMethod>,
    });
  }
}
