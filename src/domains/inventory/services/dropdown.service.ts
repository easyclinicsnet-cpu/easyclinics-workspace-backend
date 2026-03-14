import { Injectable } from '@nestjs/common';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { ItemType } from '../../../common/enums';
import { MedicationItem } from '../entities/medication-item.entity';
import { ConsumableItem } from '../entities/consumable-item.entity';
import { Batch } from '../entities/batch.entity';
import { InventoryCategory } from '../entities/inventory-category.entity';
import {
  DropdownFilterDto,
  DispenseFilterDto,
  SearchInventoryDto,
} from '../dtos/dropdown/dropdown-filter.dto';
import {
  DropdownItemDto,
  DropdownDispenseItemDto,
  InventoryDropdownResponseDto,
  LowStockResponseDto,
  CategoryDropdownDto,
  InventorySummaryDto,
} from '../dtos/dropdown/dropdown-response.dto';

@Injectable()
export class InventoryDropdownService {
  private readonly context = InventoryDropdownService.name;

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {}

  // ─── Medication dropdowns ────────────────────────────────────────────────────

  async getMedicationsForDropdown(
    dto: DropdownFilterDto,
    workspaceId: string,
  ): Promise<DropdownItemDto[]> {
    const items = await this.buildMedicationQuery(workspaceId, dto).getMany();
    return items.map(DropdownItemDto.fromMedicationItem);
  }

  async getMedicationsForDispense(
    dto: DispenseFilterDto,
    workspaceId: string,
  ): Promise<DropdownDispenseItemDto[]> {
    const qb = this.buildMedicationQuery(workspaceId, dto)
      .leftJoinAndSelect('item.batches', 'batch');

    if (dto.excludeExpiredBatches) {
      qb.andWhere(
        '(batch.id IS NULL OR batch.expiryDate > :now)',
        { now: new Date() },
      );
    }

    const items = await qb.getMany();

    let results = items.map(item =>
      DropdownDispenseItemDto.fromMedicationItemWithBatches(item, dto.excludeExpiredBatches ?? true),
    );

    if (dto.onlyValidBatches) {
      results = results.filter(r => r.hasValidBatches);
    }

    return results;
  }

  async getPrescriptionMedications(
    dto: DropdownFilterDto,
    workspaceId: string,
  ): Promise<DropdownItemDto[]> {
    const items = await this.buildMedicationQuery(workspaceId, dto)
      .andWhere('item.requiresPrescription = true')
      .getMany();
    return items.map(DropdownItemDto.fromMedicationItem);
  }

  async getControlledSubstances(
    dto: DropdownFilterDto,
    workspaceId: string,
  ): Promise<DropdownItemDto[]> {
    const items = await this.buildMedicationQuery(workspaceId, dto)
      .andWhere('item.isControlledSubstance = true')
      .getMany();
    return items.map(DropdownItemDto.fromMedicationItem);
  }

  // ─── Consumable dropdowns ────────────────────────────────────────────────────

  async getConsumablesForDropdown(
    dto: DropdownFilterDto,
    workspaceId: string,
  ): Promise<DropdownItemDto[]> {
    const items = await this.buildConsumableQuery(workspaceId, dto).getMany();
    return items.map(DropdownItemDto.fromConsumableItem);
  }

  async getConsumablesForDispense(
    dto: DispenseFilterDto,
    workspaceId: string,
  ): Promise<DropdownDispenseItemDto[]> {
    const qb = this.buildConsumableQuery(workspaceId, dto)
      .leftJoinAndSelect('item.batches', 'batch');

    if (dto.excludeExpiredBatches) {
      qb.andWhere(
        '(batch.id IS NULL OR batch.expiryDate > :now)',
        { now: new Date() },
      );
    }

    const items = await qb.getMany();

    let results = items.map(item =>
      DropdownDispenseItemDto.fromConsumableItemWithBatches(item, dto.excludeExpiredBatches ?? true),
    );

    if (dto.onlyValidBatches) {
      results = results.filter(r => r.hasValidBatches);
    }

    return results;
  }

  async getSterileConsumables(
    dto: DropdownFilterDto,
    workspaceId: string,
  ): Promise<DropdownItemDto[]> {
    const items = await this.buildConsumableQuery(workspaceId, dto)
      .andWhere('item.isSterile = true')
      .getMany();
    return items.map(DropdownItemDto.fromConsumableItem);
  }

  // ─── Combined ────────────────────────────────────────────────────────────────

  async getCombinedInventory(
    dto: DropdownFilterDto,
    workspaceId: string,
  ): Promise<InventoryDropdownResponseDto> {
    const [medications, consumables] = await Promise.all([
      this.getMedicationsForDropdown(dto, workspaceId),
      this.getConsumablesForDropdown(dto, workspaceId),
    ]);

    const res                 = new InventoryDropdownResponseDto();
    res.medications           = medications;
    res.consumables           = consumables;
    res.medicationCount       = medications.length;
    res.consumableCount       = consumables.length;
    res.totalCount            = medications.length + consumables.length;
    res.splittableItemsCount  = [...medications, ...consumables].filter(i => i.isSplittable).length;
    res.itemsWithOpenedPacks  = [...medications, ...consumables].filter(
      i => (i.batchesWithOpenedPacks ?? 0) > 0,
    ).length;

    return res;
  }

  async searchInventory(
    dto: SearchInventoryDto,
    workspaceId: string,
  ): Promise<InventoryDropdownResponseDto> {
    return this.getCombinedInventory(dto, workspaceId);
  }

  // ─── Stock alerts ────────────────────────────────────────────────────────────

  async getLowStockItems(workspaceId: string): Promise<LowStockResponseDto> {
    const [medications, consumables] = await Promise.all([
      this.dataSource.getRepository(MedicationItem)
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.category', 'category')
        .where('item.workspaceId = :workspaceId', { workspaceId })
        .andWhere('item.isDeleted = false')
        .andWhere('item.isActive = true')
        .andWhere('item.minimumStockLevel > 0')
        .andWhere('item.availableQuantity <= item.minimumStockLevel')
        .andWhere('item.availableQuantity > 0')
        .orderBy('item.name', 'ASC')
        .getMany(),

      this.dataSource.getRepository(ConsumableItem)
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.category', 'category')
        .where('item.workspaceId = :workspaceId', { workspaceId })
        .andWhere('item.isDeleted = false')
        .andWhere('item.isActive = true')
        .andWhere('item.minimumStockLevel > 0')
        .andWhere('item.availableQuantity <= item.minimumStockLevel')
        .andWhere('item.availableQuantity > 0')
        .orderBy('item.name', 'ASC')
        .getMany(),
    ]);

    const res              = new LowStockResponseDto();
    res.medications        = medications.map(DropdownItemDto.fromMedicationItem);
    res.consumables        = consumables.map(DropdownItemDto.fromConsumableItem);
    res.medicationCount    = res.medications.length;
    res.consumableCount    = res.consumables.length;
    res.totalCount         = res.medications.length + res.consumables.length;
    return res;
  }

  async getOutOfStockItems(workspaceId: string): Promise<LowStockResponseDto> {
    const [medications, consumables] = await Promise.all([
      this.dataSource.getRepository(MedicationItem)
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.category', 'category')
        .where('item.workspaceId = :workspaceId', { workspaceId })
        .andWhere('item.isDeleted = false')
        .andWhere('item.isActive = true')
        .andWhere('item.availableQuantity <= 0')
        .orderBy('item.name', 'ASC')
        .getMany(),

      this.dataSource.getRepository(ConsumableItem)
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.category', 'category')
        .where('item.workspaceId = :workspaceId', { workspaceId })
        .andWhere('item.isDeleted = false')
        .andWhere('item.isActive = true')
        .andWhere('item.availableQuantity <= 0')
        .orderBy('item.name', 'ASC')
        .getMany(),
    ]);

    const res              = new LowStockResponseDto();
    res.medications        = medications.map(DropdownItemDto.fromMedicationItem);
    res.consumables        = consumables.map(DropdownItemDto.fromConsumableItem);
    res.medicationCount    = res.medications.length;
    res.consumableCount    = res.consumables.length;
    res.totalCount         = res.medications.length + res.consumables.length;
    return res;
  }

  // ─── Categories ──────────────────────────────────────────────────────────────

  async getCategories(
    workspaceId: string,
    type?: ItemType,
  ): Promise<CategoryDropdownDto[]> {
    const qb = this.dataSource.getRepository(InventoryCategory)
      .createQueryBuilder('cat')
      .where('cat.workspaceId = :workspaceId', { workspaceId });

    if (type) qb.andWhere('cat.type = :type', { type });

    const categories = await qb.orderBy('cat.name', 'ASC').getMany();

    // Count items per category in two parallel queries
    const catIds = categories.map(c => c.id);
    if (catIds.length === 0) return [];

    const [medCounts, conCounts] = await Promise.all([
      this.dataSource.getRepository(MedicationItem)
        .createQueryBuilder('item')
        .select('item.categoryId', 'catId')
        .addSelect('COUNT(item.id)', 'total')
        .addSelect(
          `SUM(CASE WHEN item.isSplittable = true THEN 1 ELSE 0 END)`,
          'splittable',
        )
        .where('item.workspaceId = :workspaceId', { workspaceId })
        .andWhere('item.isDeleted = false')
        .andWhere('item.categoryId IN (:...catIds)', { catIds })
        .groupBy('item.categoryId')
        .getRawMany<{ catId: string; total: string; splittable: string }>(),

      this.dataSource.getRepository(ConsumableItem)
        .createQueryBuilder('item')
        .select('item.categoryId', 'catId')
        .addSelect('COUNT(item.id)', 'total')
        .addSelect(
          `SUM(CASE WHEN item.isSplittable = true THEN 1 ELSE 0 END)`,
          'splittable',
        )
        .where('item.workspaceId = :workspaceId', { workspaceId })
        .andWhere('item.isDeleted = false')
        .andWhere('item.categoryId IN (:...catIds)', { catIds })
        .groupBy('item.categoryId')
        .getRawMany<{ catId: string; total: string; splittable: string }>(),
    ]);

    const countMap = new Map<string, { items: number; splittable: number }>();
    for (const row of [...medCounts, ...conCounts]) {
      const prev      = countMap.get(row.catId) ?? { items: 0, splittable: 0 };
      countMap.set(row.catId, {
        items:      prev.items      + Number(row.total),
        splittable: prev.splittable + Number(row.splittable),
      });
    }

    return categories.map(cat => {
      const counts = countMap.get(cat.id) ?? { items: 0, splittable: 0 };
      return CategoryDropdownDto.fromEntity(cat, counts.items, counts.splittable);
    });
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────

  async getInventorySummary(workspaceId: string): Promise<InventorySummaryDto> {
    const medRepo = this.dataSource.getRepository(MedicationItem);
    const conRepo = this.dataSource.getRepository(ConsumableItem);
    const batchRepo = this.dataSource.getRepository(Batch);

    const base = { workspaceId, isDeleted: false, isActive: true };

    const [
      totalMedications,
      totalConsumables,
      lowStockMeds,
      lowStockCons,
      outOfStockMeds,
      outOfStockCons,
      prescriptionMeds,
      controlledMeds,
      splittableMeds,
      splittableCons,
      openedPackBatches,
    ] = await Promise.all([
      medRepo.count({ where: base }),
      conRepo.count({ where: base }),

      medRepo.createQueryBuilder('item')
        .where('item.workspaceId = :w AND item.isDeleted = false AND item.isActive = true', { w: workspaceId })
        .andWhere('item.minimumStockLevel > 0')
        .andWhere('item.availableQuantity > 0')
        .andWhere('item.availableQuantity <= item.minimumStockLevel')
        .getCount(),

      conRepo.createQueryBuilder('item')
        .where('item.workspaceId = :w AND item.isDeleted = false AND item.isActive = true', { w: workspaceId })
        .andWhere('item.minimumStockLevel > 0')
        .andWhere('item.availableQuantity > 0')
        .andWhere('item.availableQuantity <= item.minimumStockLevel')
        .getCount(),

      medRepo.createQueryBuilder('item')
        .where('item.workspaceId = :w AND item.isDeleted = false AND item.isActive = true', { w: workspaceId })
        .andWhere('item.availableQuantity <= 0')
        .getCount(),

      conRepo.createQueryBuilder('item')
        .where('item.workspaceId = :w AND item.isDeleted = false AND item.isActive = true', { w: workspaceId })
        .andWhere('item.availableQuantity <= 0')
        .getCount(),

      medRepo.count({ where: { ...base, requiresPrescription: true } }),
      medRepo.count({ where: { ...base, isControlledSubstance: true } }),
      medRepo.count({ where: { ...base, isSplittable: true } }),
      conRepo.count({ where: { ...base, isSplittable: true } }),

      batchRepo.createQueryBuilder('batch')
        .where('batch.workspaceId = :w', { w: workspaceId })
        .andWhere('batch.openedPacks > 0')
        .andWhere('batch.availableQuantity > 0')
        .getCount(),
    ]);

    // Total stock value (sum of availableQuantity * unitCost)
    const [medValue, conValue] = await Promise.all([
      medRepo.createQueryBuilder('item')
        .select('SUM(item.availableQuantity * item.unitCost)', 'val')
        .where('item.workspaceId = :w AND item.isDeleted = false AND item.isActive = true', { w: workspaceId })
        .getRawOne<{ val: string }>(),
      conRepo.createQueryBuilder('item')
        .select('SUM(item.availableQuantity * item.unitCost)', 'val')
        .where('item.workspaceId = :w AND item.isDeleted = false AND item.isActive = true', { w: workspaceId })
        .getRawOne<{ val: string }>(),
    ]);

    const dto                       = new InventorySummaryDto();
    dto.totalMedications            = totalMedications;
    dto.totalConsumables            = totalConsumables;
    dto.lowStockCount               = lowStockMeds + lowStockCons;
    dto.outOfStockCount             = outOfStockMeds + outOfStockCons;
    dto.totalStockValue             = parseFloat(
      ((Number(medValue?.val) || 0) + (Number(conValue?.val) || 0)).toFixed(2),
    );
    dto.prescriptionMedicationCount = prescriptionMeds;
    dto.controlledSubstanceCount    = controlledMeds;
    dto.splittableItemsCount        = splittableMeds + splittableCons;
    dto.openedPacksCount            = openedPackBatches;

    return dto;
  }

  // ─── Category items ───────────────────────────────────────────────────────────

  async getItemsByCategory(
    categoryId: string,
    dto: DropdownFilterDto,
    workspaceId: string,
  ): Promise<InventoryDropdownResponseDto> {
    const filter = { ...dto, categoryIds: [categoryId] };
    return this.getCombinedInventory(filter, workspaceId);
  }

  // ─── Expiring items ───────────────────────────────────────────────────────────

  async getExpiringItems(
    days: number,
    workspaceId: string,
  ): Promise<InventoryDropdownResponseDto> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + days);
    const now = new Date();

    // Find item IDs that have batches expiring within threshold
    const [medBatches, conBatches] = await Promise.all([
      this.dataSource.getRepository(Batch)
        .createQueryBuilder('batch')
        .select('DISTINCT batch.medicationItemId', 'itemId')
        .where('batch.workspaceId = :w', { w: workspaceId })
        .andWhere('batch.expiryDate BETWEEN :now AND :threshold', { now, threshold })
        .andWhere('batch.availableQuantity > 0')
        .andWhere('batch.medicationItemId IS NOT NULL')
        .getRawMany<{ itemId: string }>(),

      this.dataSource.getRepository(Batch)
        .createQueryBuilder('batch')
        .select('DISTINCT batch.consumableItemId', 'itemId')
        .where('batch.workspaceId = :w', { w: workspaceId })
        .andWhere('batch.expiryDate BETWEEN :now AND :threshold', { now, threshold })
        .andWhere('batch.availableQuantity > 0')
        .andWhere('batch.consumableItemId IS NOT NULL')
        .getRawMany<{ itemId: string }>(),
    ]);

    const medIds = medBatches.map(r => r.itemId).filter(Boolean);
    const conIds = conBatches.map(r => r.itemId).filter(Boolean);

    const [medications, consumables] = await Promise.all([
      medIds.length > 0
        ? this.dataSource.getRepository(MedicationItem)
            .createQueryBuilder('item')
            .leftJoinAndSelect('item.category', 'category')
            .where('item.id IN (:...ids)', { ids: medIds })
            .andWhere('item.isDeleted = false')
            .orderBy('item.name', 'ASC')
            .getMany()
        : Promise.resolve([] as MedicationItem[]),

      conIds.length > 0
        ? this.dataSource.getRepository(ConsumableItem)
            .createQueryBuilder('item')
            .leftJoinAndSelect('item.category', 'category')
            .where('item.id IN (:...ids)', { ids: conIds })
            .andWhere('item.isDeleted = false')
            .orderBy('item.name', 'ASC')
            .getMany()
        : Promise.resolve([] as ConsumableItem[]),
    ]);

    const res             = new InventoryDropdownResponseDto();
    res.medications       = medications.map(DropdownItemDto.fromMedicationItem);
    res.consumables       = consumables.map(DropdownItemDto.fromConsumableItem);
    res.medicationCount   = res.medications.length;
    res.consumableCount   = res.consumables.length;
    res.totalCount        = res.medications.length + res.consumables.length;
    return res;
  }

  // ─── Reorder ─────────────────────────────────────────────────────────────────

  async getItemsNeedingReorder(
    workspaceId: string,
  ): Promise<{ lowStock: LowStockResponseDto; outOfStock: LowStockResponseDto }> {
    const [lowStock, outOfStock] = await Promise.all([
      this.getLowStockItems(workspaceId),
      this.getOutOfStockItems(workspaceId),
    ]);
    return { lowStock, outOfStock };
  }

  // ─── Query builders ───────────────────────────────────────────────────────────

  private buildMedicationQuery(
    workspaceId: string,
    filter: DropdownFilterDto,
  ): SelectQueryBuilder<MedicationItem> {
    const qb = this.dataSource.getRepository(MedicationItem)
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('item.supplier', 'supplier')
      .where('item.workspaceId = :workspaceId', { workspaceId })
      .andWhere('item.isDeleted = false');

    this.applyCommonFilters(qb, filter);
    this.applyMedicationFilters(qb, filter);

    return qb.orderBy('item.name', 'ASC')
      .take(filter.limit ?? 100)
      .skip(filter.offset ?? 0);
  }

  private buildConsumableQuery(
    workspaceId: string,
    filter: DropdownFilterDto,
  ): SelectQueryBuilder<ConsumableItem> {
    const qb = this.dataSource.getRepository(ConsumableItem)
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('item.supplier', 'supplier')
      .where('item.workspaceId = :workspaceId', { workspaceId })
      .andWhere('item.isDeleted = false');

    this.applyCommonFilters(qb, filter);
    if (filter.requireSterile !== undefined) {
      qb.andWhere('item.isSterile = :sterile', { sterile: filter.requireSterile });
    }

    return qb.orderBy('item.name', 'ASC')
      .take(filter.limit ?? 100)
      .skip(filter.offset ?? 0);
  }

  private applyCommonFilters(
    qb: SelectQueryBuilder<any>,
    filter: DropdownFilterDto,
  ): void {
    if (filter.isActive !== undefined) {
      qb.andWhere('item.isActive = :isActive', { isActive: filter.isActive });
    }
    if (filter.hasStock) {
      qb.andWhere('item.availableQuantity > 0');
    }
    if (filter.categoryIds?.length) {
      qb.andWhere('item.categoryId IN (:...catIds)', { catIds: filter.categoryIds });
    }
    if (filter.searchTerm) {
      qb.andWhere(
        '(item.name LIKE :search OR item.code LIKE :search OR item.description LIKE :search)',
        { search: `%${filter.searchTerm}%` },
      );
    }
    if (filter.lowStockOnly) {
      qb.andWhere('item.minimumStockLevel > 0')
        .andWhere('item.availableQuantity <= item.minimumStockLevel');
    }
    if (filter.outOfStockOnly) {
      qb.andWhere('item.availableQuantity <= 0');
    }
  }

  private applyMedicationFilters(
    qb: SelectQueryBuilder<MedicationItem>,
    filter: DropdownFilterDto,
  ): void {
    if (filter.requireSterile !== undefined) {
      qb.andWhere('item.isSterile = :sterile', { sterile: filter.requireSterile });
    }
    if (filter.requiresPrescription !== undefined) {
      qb.andWhere('item.requiresPrescription = :rp', { rp: filter.requiresPrescription });
    }
    if (filter.isControlledSubstance !== undefined) {
      qb.andWhere('item.isControlledSubstance = :cs', { cs: filter.isControlledSubstance });
    }
    if (filter.excludeControlledSubstances) {
      qb.andWhere('item.isControlledSubstance = false');
    }
  }
}
