import { Batch } from '../../entities/batch.entity';
import { ItemType } from '../../../../common/enums';

export class BatchResponseDto {
  id: string;
  workspaceId: string;
  batchNumber: string;
  itemType: ItemType;
  manufactureDate: string;
  expiryDate: string;
  initialQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  totalPacks: number;
  openedPacks: number;
  packSize?: number;
  quantityUnit?: string;
  isFractionalTracking: boolean;
  unitCost: number;
  sellingPrice?: number;
  location?: string;
  notes?: string;
  isPartial: boolean;
  parentBatchId?: string;
  partialQuantity?: number;
  isSterile: boolean;
  sterilityIndicator?: string;
  sterilityExpiryDate?: string;
  isQualityTested: boolean;
  qualityTestDate?: string;
  qualityTestResult?: string;
  isQuarantined: boolean;
  quarantineReason?: string;
  certificateOfAnalysis?: string;
  receivedDate?: string;
  metadata?: Record<string, any>;
  medicationItemId?: string;
  consumableItemId?: string;
  supplierId?: string;

  // Resolved from relations (available on list + detail)
  itemName?: string;
  itemCode?: string;
  supplierName?: string;

  isActive: boolean;
  createdAt: string;
  updatedAt: string;

  // Computed
  isExpired: boolean;
  daysUntilExpiry: number;
  stockValue: number;

  static fromEntity(entity: Batch): BatchResponseDto {
    const dto = new BatchResponseDto();
    dto.id = entity.id;
    dto.workspaceId = entity.workspaceId;
    dto.batchNumber = entity.batchNumber;
    dto.itemType = entity.itemType;
    dto.manufactureDate = entity.manufactureDate?.toString();
    dto.expiryDate = entity.expiryDate?.toString();
    dto.initialQuantity = Number(entity.initialQuantity);
    dto.availableQuantity = Number(entity.availableQuantity);
    dto.reservedQuantity = Number(entity.reservedQuantity);
    dto.totalPacks = Number(entity.totalPacks);
    dto.openedPacks = Number(entity.openedPacks);
    dto.packSize = entity.packSize ? Number(entity.packSize) : undefined;
    dto.quantityUnit = entity.quantityUnit;
    dto.isFractionalTracking = entity.isFractionalTracking;
    dto.unitCost = Number(entity.unitCost);
    dto.sellingPrice = entity.sellingPrice ? Number(entity.sellingPrice) : undefined;
    dto.location = entity.location;
    dto.notes = entity.notes;
    dto.isPartial = entity.isPartial;
    dto.parentBatchId = entity.parentBatchId;
    dto.partialQuantity = entity.partialQuantity ? Number(entity.partialQuantity) : undefined;
    dto.isSterile = entity.isSterile;
    dto.sterilityIndicator = entity.sterilityIndicator;
    dto.sterilityExpiryDate = entity.sterilityExpiryDate?.toString();
    dto.isQualityTested = entity.isQualityTested;
    dto.qualityTestDate = entity.qualityTestDate?.toString();
    dto.qualityTestResult = entity.qualityTestResult;
    dto.isQuarantined = entity.isQuarantined;
    dto.quarantineReason = entity.quarantineReason;
    dto.certificateOfAnalysis = entity.certificateOfAnalysis;
    dto.receivedDate = entity.receivedDate?.toString();
    dto.metadata = entity.metadata;
    dto.medicationItemId = entity.medicationItemId;
    dto.consumableItemId = entity.consumableItemId;
    dto.supplierId = entity.supplierId;

    // Resolve names from loaded relations.
    // Fall back to (entity as any) access in case the relation was loaded
    // via addSelect / getRawOne rather than leftJoinAndSelect hydration.
    const medItem = entity.medicationItem ?? (entity as any).medicationItem;
    const conItem = entity.consumableItem ?? (entity as any).consumableItem;
    const sup     = entity.supplier       ?? (entity as any).supplier;
    dto.itemName     = medItem?.name  ?? conItem?.name  ?? undefined;
    dto.itemCode     = medItem?.code  ?? conItem?.code  ?? undefined;
    dto.supplierName = sup?.name ?? undefined;

    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt?.toISOString();
    dto.updatedAt = entity.updatedAt?.toISOString();
    const now = new Date();
    const expiry = new Date(entity.expiryDate);
    dto.isExpired = expiry < now;
    dto.daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    dto.stockValue = Number(entity.availableQuantity) * Number(entity.unitCost);
    return dto;
  }
}
