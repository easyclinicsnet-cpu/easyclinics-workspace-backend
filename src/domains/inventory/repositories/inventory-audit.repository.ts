import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { InventoryAudit } from '../entities/inventory-audit.entity';
import { QueryInventoryAuditDto } from '../dtos/audit';
import { IPaginatedResult } from '../interfaces';
import { INVENTORY_CONSTANTS } from '../constants';

export class InventoryAuditRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {}

  async findByWorkspace(
    workspaceId: string,
    query: QueryInventoryAuditDto,
  ): Promise<IPaginatedResult<InventoryAudit>> {
    const page = query.page || 1;
    const limit = query.limit || INVENTORY_CONSTANTS.DEFAULTS.PAGE_SIZE;
    const skip = (page - 1) * limit;

    const qb = this.dataSource.getRepository(InventoryAudit)
      .createQueryBuilder('audit')
      .where('audit.workspaceId = :workspaceId', { workspaceId })
      .andWhere('audit.isDeleted = false');

    if (query.itemId) qb.andWhere('audit.itemId = :itemId', { itemId: query.itemId });
    if (query.itemType) qb.andWhere('audit.itemType = :itemType', { itemType: query.itemType });
    if (query.dateFrom) qb.andWhere('audit.auditDate >= :dateFrom', { dateFrom: query.dateFrom });
    if (query.dateTo) qb.andWhere('audit.auditDate <= :dateTo', { dateTo: query.dateTo });

    const sortBy = query.sortBy || 'auditDate';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(`audit.${sortBy}`, sortOrder);

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async save(entity: Partial<InventoryAudit>): Promise<InventoryAudit> {
    const audit = this.dataSource.getRepository(InventoryAudit).create(entity);
    return this.dataSource.getRepository(InventoryAudit).save(audit);
  }
}
