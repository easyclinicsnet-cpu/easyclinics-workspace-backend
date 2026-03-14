import { DataSource, SelectQueryBuilder } from 'typeorm';
import { EncryptedRepository } from '../../../common/database/repositories/encrypted-repository.base';
import { Aes256Service } from '../../../common/security/encryption/aes-256.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { Batch } from '../entities/batch.entity';
import { QueryBatchDto } from '../dtos/batch';
import { IPaginatedResult } from '../interfaces';
import { INVENTORY_CONSTANTS } from '../constants';
import { ItemType } from '../../../common/enums';

export class BatchRepository extends EncryptedRepository<Batch> {
  constructor(
    dataSource: DataSource,
    aes256Service: Aes256Service,
    logger: LoggerService,
  ) {
    super(Batch, dataSource, aes256Service, logger);
  }

  protected getSearchableEncryptedFields(): string[] {
    return ['batchNumber'];
  }

  protected getSearchFilters(): Record<string, any> {
    return { isDeleted: false };
  }

  async findByWorkspace(
    workspaceId: string,
    query: QueryBatchDto,
  ): Promise<IPaginatedResult<Batch>> {
    const page = query.page || 1;
    const limit = query.limit || INVENTORY_CONSTANTS.DEFAULTS.PAGE_SIZE;
    const skip = (page - 1) * limit;

    const qb = this.buildWorkspaceQuery(workspaceId);

    if (query.search) {
      qb.andWhere('batch.batchNumber LIKE :search', { search: `%${query.search}%` });
    }
    if (query.batchNumber) qb.andWhere('batch.batchNumber = :bn', { bn: query.batchNumber });
    if (query.itemType) qb.andWhere('batch.itemType = :it', { it: query.itemType });
    if (query.medicationItemId) qb.andWhere('batch.medicationItemId = :mid', { mid: query.medicationItemId });
    if (query.consumableItemId) qb.andWhere('batch.consumableItemId = :cid', { cid: query.consumableItemId });
    if (query.supplierId) qb.andWhere('batch.supplierId = :sid', { sid: query.supplierId });
    if (query.isSterile !== undefined) qb.andWhere('batch.isSterile = :sterile', { sterile: query.isSterile });
    if (query.isQuarantined !== undefined) qb.andWhere('batch.isQuarantined = :quarantined', { quarantined: query.isQuarantined });
    if (query.isActive !== undefined) qb.andWhere('batch.isActive = :active', { active: query.isActive });
    if (query.hasStock) qb.andWhere('batch.availableQuantity > 0');
    if (query.isExpired) qb.andWhere('batch.expiryDate < CURRENT_DATE()');
    if (query.isExpiringSoon) {
      qb.andWhere('batch.expiryDate >= CURRENT_DATE()')
        .andWhere(`batch.expiryDate <= DATE_ADD(CURRENT_DATE(), INTERVAL ${INVENTORY_CONSTANTS.EXPIRY.WARNING_DAYS} DAY)`);
    }
    if (query.expiryDateFrom) qb.andWhere('batch.expiryDate >= :edf', { edf: query.expiryDateFrom });
    if (query.expiryDateTo) qb.andWhere('batch.expiryDate <= :edt', { edt: query.expiryDateTo });

    const sortBy = query.sortBy || 'expiryDate';
    const sortOrder = query.sortOrder || 'ASC';
    qb.orderBy(`batch.${sortBy}`, sortOrder);

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findByBatchNumber(workspaceId: string, batchNumber: string): Promise<Batch | null> {
    return this.dataSource.getRepository(Batch).findOne({
      where: { workspaceId, batchNumber, isDeleted: false },
      relations: ['medicationItem', 'consumableItem', 'supplier'],
    });
  }

  async findAvailableForItem(
    workspaceId: string,
    itemId: string,
    itemType: ItemType,
  ): Promise<Batch[]> {
    const field = itemType === ItemType.MEDICATION ? 'medicationItemId' : 'consumableItemId';
    return this.dataSource.getRepository(Batch)
      .createQueryBuilder('batch')
      .where('batch.workspaceId = :workspaceId', { workspaceId })
      .andWhere(`batch.${field} = :itemId`, { itemId })
      .andWhere('batch.isDeleted = false')
      .andWhere('batch.isActive = true')
      .andWhere('batch.availableQuantity > 0')
      .andWhere('batch.isQuarantined = false')
      .andWhere('batch.expiryDate > CURRENT_DATE()')
      .orderBy('batch.expiryDate', 'ASC')
      .getMany();
  }

  async findExpiringSoon(workspaceId: string, days?: number): Promise<Batch[]> {
    const warningDays = days || INVENTORY_CONSTANTS.EXPIRY.WARNING_DAYS;
    return this.dataSource.getRepository(Batch)
      .createQueryBuilder('batch')
      .leftJoinAndSelect('batch.medicationItem', 'med')
      .leftJoinAndSelect('batch.consumableItem', 'con')
      .where('batch.workspaceId = :workspaceId', { workspaceId })
      .andWhere('batch.isDeleted = false')
      .andWhere('batch.isActive = true')
      .andWhere('batch.availableQuantity > 0')
      .andWhere('batch.expiryDate >= CURRENT_DATE()')
      .andWhere(`batch.expiryDate <= DATE_ADD(CURRENT_DATE(), INTERVAL ${warningDays} DAY)`)
      .orderBy('batch.expiryDate', 'ASC')
      .getMany();
  }

  async findExpired(workspaceId: string): Promise<Batch[]> {
    return this.dataSource.getRepository(Batch)
      .createQueryBuilder('batch')
      .leftJoinAndSelect('batch.medicationItem', 'med')
      .leftJoinAndSelect('batch.consumableItem', 'con')
      .where('batch.workspaceId = :workspaceId', { workspaceId })
      .andWhere('batch.isDeleted = false')
      .andWhere('batch.isActive = true')
      .andWhere('batch.availableQuantity > 0')
      .andWhere('batch.expiryDate < CURRENT_DATE()')
      .orderBy('batch.expiryDate', 'ASC')
      .getMany();
  }

  private buildWorkspaceQuery(workspaceId: string): SelectQueryBuilder<Batch> {
    return this.dataSource.getRepository(Batch)
      .createQueryBuilder('batch')
      .leftJoinAndSelect('batch.medicationItem', 'med')
      .leftJoinAndSelect('batch.consumableItem', 'con')
      .leftJoinAndSelect('batch.supplier', 'supplier')
      .where('batch.workspaceId = :workspaceId', { workspaceId })
      .andWhere('batch.isDeleted = false');
  }
}
