import { Repository, DataSource, SelectQueryBuilder } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { MedicationItem } from '../entities/medication-item.entity';
import { QueryMedicationItemDto } from '../dtos/medication-item';
import { IPaginatedResult } from '../interfaces';
import { INVENTORY_CONSTANTS } from '../constants';

export class MedicationItemRepository extends EncryptedRepository<MedicationItem> {
  constructor(
    dataSource: DataSource,
    aes256Service: Aes256Service,
    logger: LoggerService,
  ) {
    super(MedicationItem, dataSource, aes256Service, logger);
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['name', 'code', 'barcode'];
  }

  protected getSearchFilters(): Record<string, any> {
    return { isDeleted: false };
  }

  async findByWorkspace(
    workspaceId: string,
    query: QueryMedicationItemDto,
  ): Promise<IPaginatedResult<MedicationItem>> {
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
    if (query.requiresPrescription !== undefined) qb.andWhere('item.requiresPrescription = :rp', { rp: query.requiresPrescription });
    if (query.isControlledSubstance !== undefined) qb.andWhere('item.isControlledSubstance = :cs', { cs: query.isControlledSubstance });
    if (query.isHighRisk !== undefined) qb.andWhere('item.isHighRisk = :hr', { hr: query.isHighRisk });
    if (query.isSterile !== undefined) qb.andWhere('item.isSterile = :sterile', { sterile: query.isSterile });
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

  async findByCode(workspaceId: string, code: string): Promise<MedicationItem | null> {
    return this.dataSource.getRepository(MedicationItem).findOne({
      where: { workspaceId, code, isDeleted: false },
      relations: ['category', 'supplier'],
    });
  }

  async findWithBatches(workspaceId: string, id: string): Promise<MedicationItem | null> {
    return this.dataSource.getRepository(MedicationItem).findOne({
      where: { id, workspaceId, isDeleted: false },
      relations: ['category', 'supplier', 'batches'],
    });
  }

  async findLowStock(workspaceId: string): Promise<MedicationItem[]> {
    return this.dataSource.getRepository(MedicationItem)
      .createQueryBuilder('item')
      .where('item.workspaceId = :workspaceId', { workspaceId })
      .andWhere('item.isDeleted = false')
      .andWhere('item.isActive = true')
      .andWhere('item.availableQuantity <= item.minimumStockLevel')
      .andWhere('item.minimumStockLevel > 0')
      .getMany();
  }

  async findOutOfStock(workspaceId: string): Promise<MedicationItem[]> {
    return this.dataSource.getRepository(MedicationItem)
      .createQueryBuilder('item')
      .where('item.workspaceId = :workspaceId', { workspaceId })
      .andWhere('item.isDeleted = false')
      .andWhere('item.isActive = true')
      .andWhere('item.availableQuantity <= 0')
      .getMany();
  }

  async findPrescriptionItems(workspaceId: string): Promise<MedicationItem[]> {
    return this.dataSource.getRepository(MedicationItem).find({
      where: { workspaceId, requiresPrescription: true, isActive: true, isDeleted: false },
    });
  }

  async findControlledSubstances(workspaceId: string): Promise<MedicationItem[]> {
    return this.dataSource.getRepository(MedicationItem).find({
      where: { workspaceId, isControlledSubstance: true, isActive: true, isDeleted: false },
    });
  }

  private buildWorkspaceQuery(workspaceId: string): SelectQueryBuilder<MedicationItem> {
    return this.dataSource.getRepository(MedicationItem)
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('item.supplier', 'supplier')
      .where('item.workspaceId = :workspaceId', { workspaceId })
      .andWhere('item.isDeleted = false');
  }

  private applyStockStatusFilter(qb: SelectQueryBuilder<MedicationItem>, status?: string): void {
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
