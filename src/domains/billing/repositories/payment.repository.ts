import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { PaymentStatus } from '../../../common/enums';

@Injectable()
export class PaymentRepository extends Repository<Payment> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(Payment, dataSource.manager);
    this.logger.setContext('PaymentRepository');
  }

  async findByReference(paymentReference: string): Promise<Payment | null> {
    return this.findOne({
      where: { paymentReference, isActive: true } as FindOptionsWhere<Payment>,
      relations: ['bill', 'patient', 'paymentMethod'],
    });
  }

  async findByBill(billId: string): Promise<Payment[]> {
    return this.find({
      where: { billId, isActive: true } as FindOptionsWhere<Payment>,
      relations: ['paymentMethod'],
      order: { paymentDate: 'DESC' },
    });
  }

  async findByPatient(
    patientId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Payment[], number]> {
    return this.findAndCount({
      where: { patientId, isActive: true } as FindOptionsWhere<Payment>,
      relations: ['paymentMethod', 'bill'],
      skip: (page - 1) * limit,
      take: limit,
      order: { paymentDate: 'DESC' },
    });
  }

  async findByStatus(
    status: PaymentStatus,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Payment[], number]> {
    return this.findAndCount({
      where: { status, isActive: true } as FindOptionsWhere<Payment>,
      skip: (page - 1) * limit,
      take: limit,
      order: { paymentDate: 'DESC' },
    });
  }

  async calculateTotalPaidForBill(billId: string): Promise<number> {
    const result = await this.createQueryBuilder('payment')
      .select('SUM(payment.amount)', 'total')
      .where('payment.billId = :billId', { billId })
      .andWhere('payment.status = :status', { status: PaymentStatus.COMPLETED })
      .andWhere('payment.isActive = :isActive', { isActive: true })
      .getRawOne();

    return Number(result?.total || 0);
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Payment[], number]> {
    return this.createQueryBuilder('payment')
      .leftJoinAndSelect('payment.paymentMethod', 'paymentMethod')
      .where('payment.paymentDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('payment.isActive = :isActive', { isActive: true })
      .orderBy('payment.paymentDate', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }

  async generatePaymentReference(): Promise<string> {
    const prefix = 'PAY';
    const date = new Date();
    const timestamp = date.getTime().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }
}
