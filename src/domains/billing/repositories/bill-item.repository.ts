import { Injectable } from '@nestjs/common';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { BillItem } from '../entities/bill-item.entity';
import { LoggerService } from '../../../common/logger/logger.service';
import { InsuranceClaimStatus } from '../../../common/enums';

@Injectable()
export class BillItemRepository extends Repository<BillItem> {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    super(BillItem, dataSource.manager);
    this.logger.setContext('BillItemRepository');
  }

  async findByBill(billId: string): Promise<BillItem[]> {
    return this.find({
      where: { billId, isActive: true } as FindOptionsWhere<BillItem>,
      order: { createdAt: 'ASC' },
    });
  }

  async findByBillWithRelations(billId: string): Promise<BillItem[]> {
    return this.createQueryBuilder('item')
      .leftJoinAndSelect('item.bill', 'bill')
      .where('item.billId = :billId', { billId })
      .andWhere('item.isActive = :isActive', { isActive: true })
      .orderBy('item.createdAt', 'ASC')
      .getMany();
  }

  async findUnclaimedByBill(billId: string): Promise<BillItem[]> {
    return this.find({
      where: {
        billId,
        insuranceClaimStatus: InsuranceClaimStatus.NOT_CLAIMED,
        isActive: true,
      } as FindOptionsWhere<BillItem>,
    });
  }

  async findByDepartment(
    department: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<[BillItem[], number]> {
    return this.findAndCount({
      where: { department, isActive: true } as FindOptionsWhere<BillItem>,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }

  async calculateBillTotal(billId: string): Promise<number> {
    const result = await this.createQueryBuilder('item')
      .select('SUM(item.totalPrice)', 'total')
      .where('item.billId = :billId', { billId })
      .andWhere('item.isActive = :isActive', { isActive: true })
      .getRawOne();

    return Number(result?.total || 0);
  }
}
