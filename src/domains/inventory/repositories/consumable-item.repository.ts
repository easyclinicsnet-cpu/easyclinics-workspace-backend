import { Repository, DataSource, SelectQueryBuilder } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { ConsumableItem } from '../entities/consumable-item.entity';
import { QueryConsumableItemDto } from '../dtos/consumable-item';
import { IPaginatedResult } from '../interfaces';
import { INVENTORY_CONSTANTS } from '../constants';

export class ConsumableItemRepository extends EncryptedRepository<ConsumableItem> {
  constructor(
    dataSource: DataSource,
    aes256Service: Aes256Service,
    logger: LoggerService,
  ) {
    super(ConsumableItem, dataSource, aes256Service, logger);
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['name', 'code', 'barcode'];
  }

  protected getSearchFilters(): Record<string, any> {
    return { isDeleted: false };
  }

  async findByWorkspace(
    workspaceId: string,
    query: QueryConsumableItemDto,
  ): Promise<IPaginatedResult<ConsumableItem>> {
    const page = query.page || 1;
    const limit = query.limit || INVENTORY_CONSTANTS.DEFAULTS.PAGE_SIZE;
    const skip = (page - 1) * limit;

    const qb = this.buildWorkspaceQuery(workspaceId);

    if (query.search) {
      qb.andWhere(
        '(item.name LIKE :search OR item.code LIKE :search OR item.barcode LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.categoryId) qb.andWhere('item.categoryId = :categoryId', { categoryId: query.categoryId });
    if (query.supplierId) qb.andWhere('item.supplierId = :supplierId', { supplierId: query.supplierId });
    if (query.form) qb.andWhere('item.form = :form', { form: query.form });
    if (query.unitOfMeasure) qb.andWhere('item.unitOfMeasure = :uom', { uom: query.unitOfMeasure });
    if (query.isSterile !== undefined) qb.andWhere('item.isSterile = :sterile', { sterile: query.isSterile });
    if (query.isSingleUse !== undefined) qb.andWhere('item.isSingleUse = :su', { su: query.isSingleUse });
    if (query.isDisposable !== undefined) qb.andWhere('item.isDisposable = :disp', { disp: query.isDisposable });
    if (query.isReusable !== undefined) qb.andWhere('item.isReusable = :reuse', { reuse: query.isReusable });
    if (query.isSplittable !== undefined) qb.andWhere('item.isSplittable = :splittable', { splittable: query.isSplittable });
    if (query.isActive !== undefined) qb.andWhere('item.isActive = :active', { active: query.isActive });

    this.applyStockStatusFilter(qb, query.stockStatus);

    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder || 'ASC';
    qb.orderBy(`item.${sortBy}`, sortOrder);

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findByCode(workspaceId: string, code: string): Promise<ConsumableItem | null> {
    return this.dataSource.getRepository(ConsumableItem).findOne({
      where: { workspaceId, code, isDeleted: false },
      relations: ['category', 'supplier'],
    });
  }

  async findWithBatches(workspaceId: string, id: string): Promise<ConsumableItem | null> {
    return this.dataSource.getRepository(ConsumableItem).findOne({
      where: { id, workspaceId, isDeleted: false },
      relations: ['category', 'supplier', 'batches'],
    });
  }

  async findLowStock(workspaceId: string): Promise<ConsumableItem[]> {
    return this.dataSource.getRepository(ConsumableItem)
      .createQueryBuilder('item')
      .where('item.workspaceId = :workspaceId', { workspaceId })
      .andWhere('item.isDeleted = false')
      .andWhere('item.isActive = true')
      .andWhere('item.availableQuantity <= item.minimumStockLevel')
      .andWhere('item.minimumStockLevel > 0')
      .getMany();
  }

  async findOutOfStock(workspaceId: string): Promise<ConsumableItem[]> {
    return this.dataSource.getRepository(ConsumableItem)
      .createQueryBuilder('item')
      .where('item.workspaceId = :workspaceId', { workspaceId })
      .andWhere('item.isDeleted = false')
      .andWhere('item.isActive = true')
      .andWhere('item.availableQuantity <= 0')
      .getMany();
  }

  private buildWorkspaceQuery(workspaceId: string): SelectQueryBuilder<ConsumableItem> {
    return this.dataSource.getRepository(ConsumableItem)
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('item.supplier', 'supplier')
      .where('item.workspaceId = :workspaceId', { workspaceId })
      .andWhere('item.isDeleted = false');
  }

  private applyStockStatusFilter(qb: SelectQueryBuilder<ConsumableItem>, status?: string): void {
    if (!status) return;
    switch (status) {
      case 'OUT_OF_STOCK':
        qb.andWhere('item.availableQuantity <= 0');
        break;
      case 'LOW_STOCK':
        qb.andWhere('item.availableQuantity > 0')
          .andWhere('item.availableQuantity <= item.minimumStockLevel * 0.2');
        break;
      case 'CRITICAL_STOCK':
        qb.andWhere('item.availableQuantity > 0')
          .andWhere('item.availableQuantity <= item.minimumStockLevel * 0.1');
        break;
      case 'IN_STOCK':
        qb.andWhere('item.availableQuantity > item.minimumStockLevel * 0.2');
        break;
    }
  }
}
