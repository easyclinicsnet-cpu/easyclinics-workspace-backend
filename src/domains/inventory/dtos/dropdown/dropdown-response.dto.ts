import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemType } from '../../../../common/enums';
import { SplitUnitDefinition } from '../../types';
import { MedicationItem } from '../../entities/medication-item.entity';
import { ConsumableItem } from '../../entities/consumable-item.entity';
import { Batch } from '../../entities/batch.entity';
import { InventoryCategory } from '../../entities/inventory-category.entity';

// ─── Internal helper ─────────────────────────────────────────────────────────

function fillDropdownItemFields(dto: DropdownItemDto, item: MedicationItem | ConsumableItem): void {
  const now = new Date();
  dto.id           = item.id;
  dto.code         = item.code;
  dto.name         = item.name;
  dto.description  = item.description;
  dto.availableQuantity = Number(item.availableQuantity);
  dto.totalQuantity     = Number(item.totalQuantity);
  dto.reservedQuantity  = Number(item.reservedQuantity);
  dto.unitOfMeasure     = item.unitOfMeasure ?? 'UNIT';
  dto.sellingPrice      = item.sellingPrice != null ? Number(item.sellingPrice) : undefined;
  dto.unitCost          = Number(item.unitCost);
  dto.isActive          = item.isActive;
  dto.category          = item.category ? CategoryDto.fromEntity(item.category) : undefined;
  dto.isSterile         = item.isSterile;
  dto.minimumStockLevel = Number(item.minimumStockLevel);
  dto.reorderQuantity   = Number(item.reorderQuantity);
  dto.needsReorder      = Number(item.availableQuantity) <= Number(item.minimumStockLevel)
                          && Number(item.minimumStockLevel) > 0;
  dto.canDispense       = item.isActive && Number(item.availableQuantity) > 0;
  dto.type              = item.type;
  dto.form              = item.form;
  dto.barcode           = item.barcode;
  dto.isSplittable      = item.isSplittable;
  dto.basePackSize      = item.basePackSize != null ? Number(item.basePackSize) : undefined;
  dto.basePackUnit      = item.basePackUnit;
  dto.minimumDispenseQuantity = item.minimumDispenseQuantity != null
    ? Number(item.minimumDispenseQuantity)
    : undefined;
  dto.splitUnits       = item.splitUnits;
  dto.activeSplitUnits = item.splitUnits; // SplitUnitDefinition has no isActive field
  dto.availableInPacks = item.basePackSize
    ? Math.floor(Number(item.availableQuantity) / Number(item.basePackSize))
    : undefined;
  dto.totalPacks            = Number(item.totalPackCount) || undefined;
  dto.batchesWithOpenedPacks = undefined; // populated from batches when loaded
  dto.totalOpenedPacks       = undefined;

  dto.warnings = [];
  if (!item.isActive)           dto.warnings.push('Item is inactive');
  if (dto.needsReorder)         dto.warnings.push('Low stock — needs reorder');
  if (Number(item.availableQuantity) <= 0) dto.warnings.push('Out of stock');
}

// ─── CategoryDto ─────────────────────────────────────────────────────────────

export class CategoryDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'CAT001' })
  code!: string;

  @ApiProperty({ example: 'Antibiotics' })
  name!: string;

  @ApiPropertyOptional({ example: 'All antibiotic medications' })
  description?: string;

  @ApiProperty({ enum: ItemType, example: ItemType.MEDICATION })
  type!: ItemType;

  @ApiPropertyOptional({ example: 'Medications > Antibiotics' })
  fullPath?: string;

  static fromEntity(entity: InventoryCategory, fullPath?: string): CategoryDto {
    const dto   = new CategoryDto();
    dto.id          = entity.id;
    dto.code        = entity.code;
    dto.name        = entity.name;
    dto.description = entity.description;
    dto.type        = entity.type;
    dto.fullPath    = fullPath;
    return dto;
  }
}

// ─── BatchInfoDto ─────────────────────────────────────────────────────────────

export class BatchInfoDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'BATCH-2024-001' })
  batchNumber!: string;

  @ApiProperty({ description: 'Available quantity in base units', example: 249_900 })
  availableQuantity!: number;

  @ApiPropertyOptional({ example: '2024-12-31' })
  expiryDate?: Date;

  @ApiProperty({ example: false })
  isExpired!: boolean;

  @ApiPropertyOptional({ example: 120 })
  daysUntilExpiry?: number;

  @ApiProperty({ example: '2024-01-15' })
  manufactureDate!: Date;

  @ApiProperty({ description: 'Cost per pack/unit', example: 10.5 })
  unitCost!: number;

  @ApiPropertyOptional({ description: 'Selling price per pack/unit', example: 15.75 })
  sellingPrice?: number;

  @ApiProperty({ example: false })
  isQuarantined!: boolean;

  @ApiProperty({ example: true })
  isQualityTested!: boolean;

  @ApiPropertyOptional({ example: 'PASSED' })
  qualityTestResult?: string;

  @ApiProperty({ example: true })
  isSterile!: boolean;

  @ApiProperty({ example: 'VALID' })
  expiryStatus!: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';

  @ApiProperty({ example: 'IN_STOCK' })
  stockLevel!: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';

  // ── Pack tracking ──────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Fractional quantity tracking enabled', example: true })
  isFractionalTracking?: boolean;

  @ApiPropertyOptional({ description: 'Pack size in base units', example: 500 })
  packSize?: number;

  @ApiPropertyOptional({ description: 'Base unit of measure for tracking', example: 'ML' })
  quantityUnit?: string;

  @ApiPropertyOptional({ description: 'Total packs in batch', example: 500 })
  totalPacks?: number;

  @ApiPropertyOptional({ description: 'Number of partially used packs', example: 1 })
  openedPacks?: number;

  @ApiPropertyOptional({ description: 'Number of sealed (unopened) packs', example: 499 })
  sealedPacks?: number;

  @ApiPropertyOptional({ description: 'Available quantity expressed in complete packs', example: 499 })
  availableInPacks?: number;

  @ApiPropertyOptional({ description: 'Quantity remaining in opened packs', example: 400 })
  availableInOpenedPacks?: number;

  // ── Pricing ────────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Batch carries custom pricing different from item', example: true })
  hasCustomPricing?: boolean;

  @ApiPropertyOptional({ description: 'Batch is discounted', example: true })
  isDiscounted?: boolean;

  @ApiPropertyOptional({ description: 'Discount percentage off item price', example: 40 })
  discountPercentage?: number;

  @ApiPropertyOptional({ description: 'Reason for discount', example: 'Expiring in 15 days' })
  discountReason?: string;

  @ApiPropertyOptional({ description: 'Price per base unit for partial dispense', example: 0.006 })
  pricePerBaseUnit?: number;

  // ── Split units with batch-adjusted pricing ────────────────────────────────

  @ApiPropertyOptional({
    type: [Object],
    description: 'Split units with batch-adjusted pricing',
  })
  splitUnits?: Array<{
    unitSize: number;
    unitName: string;
    sellingPrice: number;
    itemPrice?: number;
    discountAmount?: number;
    discountPercentage?: number;
    barcode?: string;
  }>;

  @ApiPropertyOptional({
    type: [Object],
    description: 'All pricing options available for this batch',
  })
  pricingOptions?: Array<{
    type: 'FULL_PACK' | 'SPLIT_UNIT' | 'BASE_UNIT';
    unitSize: number;
    unitName: string;
    pricePerUnit: number;
    isDiscounted?: boolean;
    discountPercentage?: number;
  }>;

  // ── Partial dispense info ──────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Currently open pack information' })
  currentOpenPack?: {
    packIdentifier: string;
    remainingQuantity: number;
    originalPackSize: number;
    openedAt: string;
    openedBy?: string;
    dispenseCount: number;
  };

  @ApiPropertyOptional({ description: 'Total dispensed as partial from this batch', example: 100 })
  totalPartialDispensed?: number;

  static fromBatch(batch: Batch): BatchInfoDto {
    const dto   = new BatchInfoDto();
    const now   = new Date();
    const isExp = batch.expiryDate ? new Date(batch.expiryDate) < now : false;

    dto.id                = batch.id;
    dto.batchNumber       = batch.batchNumber;
    dto.availableQuantity = Number(batch.availableQuantity);
    dto.expiryDate        = batch.expiryDate;
    dto.isExpired         = isExp;
    dto.daysUntilExpiry   = batch.expiryDate
      ? Math.ceil((new Date(batch.expiryDate).getTime() - now.getTime()) / 86_400_000)
      : undefined;
    dto.manufactureDate   = batch.manufactureDate;
    dto.unitCost          = Number(batch.unitCost);
    dto.sellingPrice      = batch.sellingPrice != null ? Number(batch.sellingPrice) : undefined;
    dto.isQuarantined     = batch.isQuarantined;
    dto.isQualityTested   = batch.isQualityTested;
    dto.qualityTestResult = batch.qualityTestResult;
    dto.isSterile         = batch.isSterile;

    dto.expiryStatus = isExp
      ? 'EXPIRED'
      : (dto.daysUntilExpiry != null && dto.daysUntilExpiry <= 30 ? 'EXPIRING_SOON' : 'VALID');

    dto.stockLevel = Number(batch.availableQuantity) <= 0 ? 'OUT_OF_STOCK' : 'IN_STOCK';

    dto.isFractionalTracking = batch.isFractionalTracking;
    dto.packSize             = batch.packSize != null ? Number(batch.packSize) : undefined;
    dto.quantityUnit         = batch.quantityUnit;
    dto.totalPacks           = Number(batch.totalPacks) || undefined;
    dto.openedPacks          = Number(batch.openedPacks) || undefined;

    const sealed             = Math.max(0, Number(batch.totalPacks) - Number(batch.openedPacks));
    dto.sealedPacks          = sealed || undefined;
    dto.availableInPacks     = batch.packSize && Number(batch.packSize) > 0
      ? Math.floor(Number(batch.availableQuantity) / Number(batch.packSize))
      : undefined;

    dto.hasCustomPricing     = batch.sellingPrice != null;
    dto.pricePerBaseUnit     = batch.sellingPrice != null && batch.packSize && Number(batch.packSize) > 0
      ? Number(batch.sellingPrice) / Number(batch.packSize)
      : undefined;

    return dto;
  }
}

// ─── DropdownItemDto ──────────────────────────────────────────────────────────

export class DropdownItemDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'MED001' })
  code!: string;

  @ApiProperty({ example: 'Amoxicillin 500mg' })
  name!: string;

  @ApiPropertyOptional({ example: 'Broad spectrum antibiotic' })
  description?: string;

  @ApiProperty({ description: 'Available quantity in base units', example: 150 })
  availableQuantity!: number;

  @ApiProperty({ description: 'Total quantity in base units', example: 500 })
  totalQuantity!: number;

  @ApiProperty({ description: 'Reserved quantity', example: 50 })
  reservedQuantity!: number;

  @ApiProperty({ description: 'Base unit of measure', example: 'TABLET' })
  unitOfMeasure!: string;

  @ApiPropertyOptional({ description: 'Selling price per unit/pack', example: 15.75 })
  sellingPrice?: number;

  @ApiProperty({ description: 'Unit cost', example: 10.5 })
  unitCost!: number;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ type: CategoryDto })
  category?: CategoryDto;

  @ApiPropertyOptional({ example: true })
  requiresPrescription?: boolean;

  @ApiPropertyOptional({ example: false })
  isControlledSubstance?: boolean;

  @ApiProperty({ example: false })
  isSterile!: boolean;

  @ApiProperty({ example: 25 })
  minimumStockLevel!: number;

  @ApiProperty({ example: 100 })
  reorderQuantity!: number;

  @ApiProperty({ example: false })
  needsReorder!: boolean;

  @ApiProperty({ example: true })
  canDispense!: boolean;

  @ApiProperty({ type: [String], example: [] })
  warnings!: string[];

  @ApiPropertyOptional({ enum: ItemType, example: ItemType.MEDICATION })
  type?: ItemType;

  @ApiPropertyOptional({ example: 'SOLID' })
  form?: string;

  @ApiPropertyOptional({ example: '1234567890123' })
  barcode?: string;

  // ── Splitting configuration ────────────────────────────────────────────────

  @ApiProperty({ description: 'Supports partial/split dispensing', example: false })
  isSplittable!: boolean;

  @ApiPropertyOptional({ description: 'Base pack size', example: 10 })
  basePackSize?: number;

  @ApiPropertyOptional({ description: 'Base pack unit', example: 'BOX' })
  basePackUnit?: string;

  @ApiPropertyOptional({ description: 'Minimum dispense quantity', example: 5 })
  minimumDispenseQuantity?: number;

  // ── Split units ────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ type: [Object], description: 'All configured split units' })
  splitUnits?: SplitUnitDefinition[];

  @ApiPropertyOptional({ type: [Object], description: 'Active split units' })
  activeSplitUnits?: SplitUnitDefinition[];

  // ── Stock pack info ────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Available quantity in complete packs', example: 15 })
  availableInPacks?: number;

  @ApiPropertyOptional({ description: 'Total packs across all batches', example: 50 })
  totalPacks?: number;

  @ApiPropertyOptional({ description: 'Batches with opened packs count', example: 2 })
  batchesWithOpenedPacks?: number;

  @ApiPropertyOptional({ description: 'Total opened packs across all batches', example: 3 })
  totalOpenedPacks?: number;

  // ── Static factories ───────────────────────────────────────────────────────

  static fromMedicationItem(item: MedicationItem): DropdownItemDto {
    const dto = new DropdownItemDto();
    fillDropdownItemFields(dto, item);
    dto.requiresPrescription  = item.requiresPrescription;
    dto.isControlledSubstance = item.isControlledSubstance;
    return dto;
  }

  static fromConsumableItem(item: ConsumableItem): DropdownItemDto {
    const dto = new DropdownItemDto();
    fillDropdownItemFields(dto, item);
    return dto;
  }
}

// ─── DropdownDispenseItemDto ──────────────────────────────────────────────────────────

export class DropdownDispenseItemDto extends DropdownItemDto {
  @ApiProperty({ type: [BatchInfoDto], description: 'Available batches with pack tracking' })
  batches!: BatchInfoDto[];

  @ApiPropertyOptional({ example: 'Antibiotics' })
  categoryName?: string;

  @ApiProperty({ description: 'Has at least one valid (non-expired) batch', example: true })
  hasValidBatches!: boolean;

  @ApiProperty({ description: 'Count of valid batches', example: 3 })
  validBatchCount!: number;

  @ApiPropertyOptional({ description: 'Earliest expiry among valid batches', example: '2024-10-31' })
  earliestExpiryDate?: Date;

  // ── Dispense-specific pack info ────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Recommended batch ID (FEFO strategy)', example: '...' })
  recommendedBatchId?: string;

  @ApiPropertyOptional({ description: 'Opened packs available for partial dispense', example: true })
  hasOpenedPacksAvailable?: boolean;

  @ApiPropertyOptional({ description: 'Total quantity in opened packs', example: 1250 })
  totalInOpenedPacks?: number;

  @ApiPropertyOptional({ type: [String], description: 'Batch IDs sorted by preference (opened first, then FEFO)' })
  preferredBatchOrder?: string[];

  // ── Pricing summary ────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Any batch carries a discount', example: true })
  hasDiscountedBatches?: boolean;

  @ApiPropertyOptional({ description: 'Best available price per base unit', example: 0.006 })
  bestPricePerBaseUnit?: number;

  @ApiPropertyOptional({ description: 'Batch ID with best price', example: '...' })
  bestPriceBatchId?: string;

  // ── Static factories ───────────────────────────────────────────────────────

  static fromMedicationItemWithBatches(
    item: MedicationItem,
    excludeExpired = true,
  ): DropdownDispenseItemDto {
    const dto = new DropdownDispenseItemDto();
    fillDropdownItemFields(dto, item);
    dto.requiresPrescription  = item.requiresPrescription;
    dto.isControlledSubstance = item.isControlledSubstance;
    DropdownDispenseItemDto._fillBatchFields(dto, item.batches ?? [], excludeExpired);
    return dto;
  }

  static fromConsumableItemWithBatches(
    item: ConsumableItem,
    excludeExpired = true,
  ): DropdownDispenseItemDto {
    const dto = new DropdownDispenseItemDto();
    fillDropdownItemFields(dto, item);
    DropdownDispenseItemDto._fillBatchFields(dto, item.batches ?? [], excludeExpired);
    return dto;
  }

  private static _fillBatchFields(
    dto: DropdownDispenseItemDto,
    rawBatches: Batch[],
    excludeExpired: boolean,
  ): void {
    const now = new Date();

    let batches = rawBatches.map(BatchInfoDto.fromBatch);

    if (excludeExpired) {
      batches = batches.filter(b => !b.isExpired && !b.isQuarantined);
    }

    const validBatches = batches.filter(b => b.availableQuantity > 0);

    dto.batches         = batches;
    dto.hasValidBatches = validBatches.length > 0;
    dto.validBatchCount = validBatches.length;
    dto.categoryName    = dto.category?.name;

    // Earliest expiry (FEFO)
    const withExpiry    = validBatches.filter(b => b.expiryDate != null);
    if (withExpiry.length > 0) {
      withExpiry.sort((a, b) =>
        new Date(a.expiryDate!).getTime() - new Date(b.expiryDate!).getTime(),
      );
      dto.earliestExpiryDate   = withExpiry[0].expiryDate;
      dto.recommendedBatchId   = withExpiry[0].id;
    }

    // Opened packs
    const openedBatches            = validBatches.filter(b => (b.openedPacks ?? 0) > 0);
    dto.hasOpenedPacksAvailable    = openedBatches.length > 0;
    dto.totalInOpenedPacks         = openedBatches.reduce(
      (sum, b) => sum + (b.availableInOpenedPacks ?? 0), 0,
    );
    dto.batchesWithOpenedPacks     = openedBatches.length;
    dto.totalOpenedPacks           = openedBatches.reduce(
      (sum, b) => sum + (b.openedPacks ?? 0), 0,
    );

    // Preferred batch order: opened first, then FEFO
    const sorted = [...validBatches].sort((a, b) => {
      const aOpened = (a.openedPacks ?? 0) > 0 ? -1 : 1;
      const bOpened = (b.openedPacks ?? 0) > 0 ? -1 : 1;
      if (aOpened !== bOpened) return aOpened - bOpened;
      return (new Date(a.expiryDate ?? 0).getTime()) - (new Date(b.expiryDate ?? 0).getTime());
    });
    dto.preferredBatchOrder = sorted.map(b => b.id);

    // Pricing
    const discountedBatches = validBatches.filter(b => b.isDiscounted);
    dto.hasDiscountedBatches = discountedBatches.length > 0;

    const withBasePrice = validBatches.filter(b => b.pricePerBaseUnit != null);
    if (withBasePrice.length > 0) {
      const best = withBasePrice.reduce((min, b) =>
        (b.pricePerBaseUnit! < min.pricePerBaseUnit! ? b : min),
      );
      dto.bestPricePerBaseUnit = best.pricePerBaseUnit;
      dto.bestPriceBatchId     = best.id;
    }
  }
}

// ─── Container response DTOs ──────────────────────────────────────────────────

export class InventoryDropdownResponseDto {
  @ApiProperty({ type: [DropdownItemDto] })
  medications!: DropdownItemDto[];

  @ApiProperty({ type: [DropdownItemDto] })
  consumables!: DropdownItemDto[];

  @ApiProperty({ example: 45 })
  totalCount!: number;

  @ApiProperty({ example: 25 })
  medicationCount!: number;

  @ApiProperty({ example: 20 })
  consumableCount!: number;

  @ApiPropertyOptional({ description: 'Items that support partial dispensing', example: 12 })
  splittableItemsCount?: number;

  @ApiPropertyOptional({ description: 'Items with opened packs', example: 5 })
  itemsWithOpenedPacks?: number;
}

export class LowStockResponseDto {
  @ApiProperty({ type: [DropdownItemDto] })
  medications!: DropdownItemDto[];

  @ApiProperty({ type: [DropdownItemDto] })
  consumables!: DropdownItemDto[];

  @ApiProperty({ example: 8 })
  totalCount!: number;

  @ApiProperty({ example: 5 })
  medicationCount!: number;

  @ApiProperty({ example: 3 })
  consumableCount!: number;
}

export class CategoryDropdownDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'CAT001' })
  code!: string;

  @ApiProperty({ example: 'Antibiotics' })
  name!: string;

  @ApiPropertyOptional({ enum: ItemType, example: ItemType.MEDICATION })
  type?: ItemType;

  @ApiProperty({ example: 'Medications > Antibiotics' })
  fullPath!: string;

  @ApiPropertyOptional({ type: () => [CategoryDropdownDto] })
  children?: CategoryDropdownDto[];

  @ApiProperty({ example: 15 })
  itemCount!: number;

  @ApiPropertyOptional({ description: 'Splittable items in this category', example: 8 })
  splittableItemCount?: number;

  static fromEntity(
    entity: InventoryCategory,
    itemCount = 0,
    splittableItemCount = 0,
  ): CategoryDropdownDto {
    const dto               = new CategoryDropdownDto();
    dto.id                  = entity.id;
    dto.code                = entity.code;
    dto.name                = entity.name;
    dto.type                = entity.type;
    dto.fullPath            = entity.name; // enriched by service when parent path is known
    dto.itemCount           = itemCount;
    dto.splittableItemCount = splittableItemCount;
    return dto;
  }
}

export class InventorySummaryDto {
  @ApiProperty({ example: 150 })
  totalMedications!: number;

  @ApiProperty({ example: 200 })
  totalConsumables!: number;

  @ApiProperty({ example: 12 })
  lowStockCount!: number;

  @ApiProperty({ example: 5 })
  outOfStockCount!: number;

  @ApiProperty({ example: 343 })
  totalStockValue!: number;

  @ApiProperty({ example: 25 })
  prescriptionMedicationCount!: number;

  @ApiProperty({ example: 8 })
  controlledSubstanceCount!: number;

  @ApiPropertyOptional({ description: 'Items that support partial dispensing', example: 45 })
  splittableItemsCount?: number;

  @ApiPropertyOptional({ description: 'Batches with opened packs', example: 15 })
  openedPacksCount?: number;

  @ApiPropertyOptional({ description: 'Total quantity in opened packs', example: 5250 })
  totalInOpenedPacks?: number;
}

// ─── Dispense selection DTOs ──────────────────────────────────────────────────

export class BatchSelectionDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  batchId!: string;

  @ApiProperty({ example: 'BATCH-2024-001' })
  batchNumber!: string;

  @ApiProperty({ description: 'Quantity from this batch in base units', example: 50 })
  quantity!: number;

  @ApiProperty({ description: 'Unit price', example: 15.75 })
  unitPrice!: number;

  @ApiProperty({ description: 'Total price for this batch selection', example: 787.5 })
  totalPrice!: number;

  @ApiProperty({ example: '2024-12-31' })
  expiryDate!: Date;

  @ApiProperty({ example: 120 })
  daysUntilExpiry!: number;

  @ApiPropertyOptional({ description: 'Will use an already-opened pack', example: true })
  willUseOpenedPack?: boolean;

  @ApiPropertyOptional({ description: 'Will open a new sealed pack', example: false })
  willOpenNewPack?: boolean;

  @ApiPropertyOptional({ description: 'Opened pack identifier', example: 'BATCH-2024-001-PACK-1234567890' })
  packIdentifier?: string;

  @ApiPropertyOptional({ description: 'Batch is discounted', example: true })
  isDiscounted?: boolean;

  @ApiPropertyOptional({ description: 'Discount percentage', example: 40 })
  discountPercentage?: number;
}

export class DispenseSelectionDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  itemId!: string;

  @ApiProperty({ example: 'MED001' })
  itemCode!: string;

  @ApiProperty({ example: 'Amoxicillin 500mg' })
  itemName!: string;

  @ApiProperty({ description: 'Quantity to dispense in base units', example: 50 })
  quantity!: number;

  @ApiProperty({ description: 'Base unit of measure', example: 'TABLET' })
  unitOfMeasure!: string;

  @ApiProperty({ description: 'Unit price', example: 15.75 })
  unitPrice!: number;

  @ApiProperty({ description: 'Total price', example: 787.5 })
  totalPrice!: number;

  @ApiProperty({ type: [BatchSelectionDto] })
  batchSelections!: BatchSelectionDto[];

  @ApiProperty({ example: true })
  requiresPrescription!: boolean;

  @ApiProperty({ example: false })
  isControlledSubstance!: boolean;

  @ApiPropertyOptional({ description: 'Is a partial dispense (sub-pack quantity)', example: true })
  isPartialDispense?: boolean;

  @ApiPropertyOptional({ description: 'Original pack size for partial dispense', example: 500 })
  originalPackSize?: number;

  @ApiPropertyOptional({ description: 'Any discount was applied', example: true })
  hasDiscount?: boolean;

  @ApiPropertyOptional({ description: 'Total discount amount', example: 50.25 })
  totalDiscount?: number;

  @ApiPropertyOptional({ description: 'Pricing breakdown' })
  pricingBreakdown?: {
    itemBasePrice: number;
    batchDiscountedPrice: number;
    finalUnitPrice: number;
    quantityDispensed: number;
    totalBeforeDiscount: number;
    totalAfterDiscount: number;
    savings: number;
  };
}
