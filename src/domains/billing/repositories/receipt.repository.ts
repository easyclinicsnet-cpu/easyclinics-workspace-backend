import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Receipt } from '../entities/receipt.entity';
import { LoggerService } from '../../../common/logger/logger.service';

@Injectable()
export class ReceiptRepository extends Repository<Receipt> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(Receipt, dataSource.manager);
    this.logger.setContext('ReceiptRepository');
  }

  async findByReceiptNumber(receiptNumber: string): Promise<Receipt | null> {
    return this.findOne({
      where: { receiptNumber, isActive: true } as FindOptionsWhere<Receipt>,
      relations: ['payment', 'patient'],
    });
  }

  async findByPayment(paymentId: string): Promise<Receipt | null> {
    return this.findOne({
      where: { paymentId, isActive: true } as FindOptionsWhere<Receipt>,
    });
  }

  async findByPatient(
    patientId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Receipt[], number]> {
    return this.findAndCount({
      where: { patientId, isActive: true } as FindOptionsWhere<Receipt>,
      relations: ['payment'],
      skip: (page - 1) * limit,
      take: limit,
      order: { issuedAt: 'DESC' },
    });
  }

  async generateReceiptNumber(): Promise<string> {
    const prefix = 'RCT';
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const count = await this.count();
    const sequence = String(count + 1).padStart(5, '0');
    return `${prefix}-${year}${month}-${sequence}`;
  }
}
