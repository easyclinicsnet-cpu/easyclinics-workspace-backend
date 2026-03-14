import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { BillingTransaction } from '../entities/billing-transaction.entity';
import { LoggerService } from '../../../common/logger/logger.service';

@Injectable()
export class BillingTransactionRepository extends Repository<BillingTransaction> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(BillingTransaction, dataSource.manager);
    this.logger.setContext('BillingTransactionRepository');
  }

  async findByReference(transactionReference: string): Promise<BillingTransaction | null> {
    return this.findOne({
      where: { transactionReference, isActive: true } as FindOptionsWhere<BillingTransaction>,
      relations: ['bill', 'payment'],
    });
  }

  async findByBill(billId: string): Promise<BillingTransaction[]> {
    return this.find({
      where: { billId, isActive: true } as FindOptionsWhere<BillingTransaction>,
      order: { transactionDate: 'DESC' },
    });
  }

  async findByPayment(paymentId: string): Promise<BillingTransaction[]> {
    return this.find({
      where: { paymentId, isActive: true } as FindOptionsWhere<BillingTransaction>,
      order: { transactionDate: 'DESC' },
    });
  }

  async findByType(
    transactionType: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[BillingTransaction[], number]> {
    return this.findAndCount({
      where: { transactionType, isActive: true } as FindOptionsWhere<BillingTransaction>,
      skip: (page - 1) * limit,
      take: limit,
      order: { transactionDate: 'DESC' },
    });
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    page: number = 1,
    limit: number = 10,
  ): Promise<[BillingTransaction[], number]> {
    return this.createQueryBuilder('txn')
      .where('txn.transactionDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('txn.isActive = :isActive', { isActive: true })
      .orderBy('txn.transactionDate', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }

  async generateTransactionReference(): Promise<string> {
    const prefix = 'TXN';
    const date = new Date();
    const timestamp = date.getTime().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }
}
