import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { PatientBill } from '../entities/patient-bill.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { BillStatus } from '../../../common/enums';

@Injectable()
export class PatientBillRepository extends Repository<PatientBill> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(PatientBill, dataSource.manager);
    this.logger.setContext('PatientBillRepository');
  }

  async findByIdWithRelations(id: string): Promise<PatientBill | null> {
    this.logger.log(`Finding bill by ID with relations: ${id}`);
    return this.createQueryBuilder('bill')
      .leftJoinAndSelect('bill.patient', 'patient')
      .leftJoinAndSelect('bill.appointment', 'appointment')
      .where('bill.id = :id', { id })
      .andWhere('bill.isActive = :isActive', { isActive: true })
      .getOne();
  }

  async findByBillNumber(billNumber: string): Promise<PatientBill | null> {
    return this.findOne({
      where: { billNumber, isActive: true } as FindOptionsWhere<PatientBill>,
    });
  }

  async findByPatient(
    patientId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PatientBill[], number]> {
    return this.findAndCount({
      where: { patientId, isActive: true } as FindOptionsWhere<PatientBill>,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }

  async findByStatus(
    status: BillStatus,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PatientBill[], number]> {
    return this.findAndCount({
      where: { status, isActive: true } as FindOptionsWhere<PatientBill>,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }

  async findByAppointment(appointmentId: string): Promise<PatientBill | null> {
    return this.findOne({
      where: { appointmentId, isActive: true } as FindOptionsWhere<PatientBill>,
    });
  }

  async findOverdueBills(workspaceId?: string): Promise<PatientBill[]> {
    const qb = this.createQueryBuilder('bill')
      .where('bill.status IN (:...statuses)', {
        statuses: [BillStatus.PENDING, BillStatus.PARTIALLY_PAID],
      })
      .andWhere('bill.dueDate < :now', { now: new Date() })
      .andWhere('bill.isActive = :isActive', { isActive: true })
      .orderBy('bill.dueDate', 'ASC');

    return qb.getMany();
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    page: number = 1,
    limit: number = 10,
  ): Promise<[PatientBill[], number]> {
    return this.createQueryBuilder('bill')
      .where('bill.issuedAt BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('bill.isActive = :isActive', { isActive: true })
      .orderBy('bill.issuedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }

  async generateBillNumber(): Promise<string> {
    const prefix = 'BILL';
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const count = await this.count();
    const sequence = String(count + 1).padStart(5, '0');
    return `${prefix}-${year}${month}-${sequence}`;
  }
}
