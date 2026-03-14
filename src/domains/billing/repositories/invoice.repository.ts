import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { BillStatus } from '../../../common/enums';

@Injectable()
export class InvoiceRepository extends Repository<Invoice> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(Invoice, dataSource.manager);
    this.logger.setContext('InvoiceRepository');
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<Invoice | null> {
    return this.findOne({
      where: { invoiceNumber, isActive: true } as FindOptionsWhere<Invoice>,
      relations: ['bill', 'patient'],
    });
  }

  async findByBill(billId: string): Promise<Invoice | null> {
    return this.findOne({
      where: { billId, isActive: true } as FindOptionsWhere<Invoice>,
      relations: ['bill', 'patient'],
    });
  }

  async findByPatient(
    patientId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Invoice[], number]> {
    return this.findAndCount({
      where: { patientId, isActive: true } as FindOptionsWhere<Invoice>,
      relations: ['bill'],
      skip: (page - 1) * limit,
      take: limit,
      order: { issuedAt: 'DESC' },
    });
  }

  async findByStatus(
    status: BillStatus,
    page: number = 1,
    limit: number = 10,
  ): Promise<[Invoice[], number]> {
    return this.findAndCount({
      where: { status, isActive: true } as FindOptionsWhere<Invoice>,
      skip: (page - 1) * limit,
      take: limit,
      order: { issuedAt: 'DESC' },
    });
  }

  async findOverdueInvoices(): Promise<Invoice[]> {
    return this.createQueryBuilder('invoice')
      .where('invoice.status IN (:...statuses)', {
        statuses: [BillStatus.PENDING, BillStatus.PARTIALLY_PAID],
      })
      .andWhere('invoice.dueDate < :now', { now: new Date() })
      .andWhere('invoice.isActive = :isActive', { isActive: true })
      .orderBy('invoice.dueDate', 'ASC')
      .getMany();
  }

  async generateInvoiceNumber(): Promise<string> {
    const prefix = 'INV';
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const count = await this.count();
    const sequence = String(count + 1).padStart(5, '0');
    return `${prefix}-${year}${month}-${sequence}`;
  }
}
