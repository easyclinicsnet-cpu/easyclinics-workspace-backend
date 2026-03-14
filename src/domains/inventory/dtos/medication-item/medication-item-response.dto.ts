import { MedicationItem, MedicationForm, MedicationUnit } from '../../entities/medication-item.entity';
import { ItemType } from '../../../../common/enums';
import { IStorageConditions, IMaterialComposition } from '../../interfaces';
import { SplitUnitDefinition } from '../../types';
import { BatchResponseDto } from '../batch/batch-response.dto';

export class MedicationItemResponseDto {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  description?: string;
  type: ItemType;
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  minimumStockLevel: number;
  reorderQuantity: number;
  totalPackCount: number;
  trackInBaseUnits: boolean;
  form?: MedicationForm;
  barcode?: string;
  unitOfMeasure?: MedicationUnit;
  unitCost: number;
  sellingPrice?: number;
  baseUnitPrice?: number;
  requiresPrescription: boolean;
  isControlledSubstance: boolean;
  isHighRisk: boolean;
  isSingleUse: boolean;
  isSterile: boolean;
  isSplittable: boolean;
  basePackSize?: number;
  basePackUnit?: string;
  minimumDispenseQuantity?: number;
  useOpenedPacksFirst: boolean;
  splitUnits?: SplitUnitDefinition[];
  materialComposition?: IMaterialComposition;
  storageConditions?: IStorageConditions;
  storageOverrides?: IStorageConditions;
  metadata?: Record<string, any>;
  categoryId: string;
  supplierId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;

  // Computed fields
  stockValue: number;
  stockStatus: string;

  // Nested relations (when loaded)
  batches?: BatchResponseDto[];

  static fromEntity(entity: MedicationItem): MedicationItemResponseDto {
    const dto = new MedicationItemResponseDto();
    dto.id = entity.id;
    dto.workspaceId = entity.workspaceId;
    dto.code = entity.code;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.type = entity.type;
    dto.totalQuantity = Number(entity.totalQuantity);
    dto.availableQuantity = Number(entity.availableQuantity);
    dto.reservedQuantity = Number(entity.reservedQuantity);
    dto.minimumStockLevel = Number(entity.minimumStockLevel);
    dto.reorderQuantity = Number(entity.reorderQuantity);
    dto.totalPackCount = Number(entity.totalPackCount);
    dto.trackInBaseUnits = entity.trackInBaseUnits;
    dto.form = entity.form;
    dto.barcode = entity.barcode;
    dto.unitOfMeasure = entity.unitOfMeasure;
    dto.unitCost = Number(entity.unitCost);
    dto.sellingPrice = entity.sellingPrice ? Number(entity.sellingPrice) : undefined;
    dto.baseUnitPrice = entity.baseUnitPrice ? Number(entity.baseUnitPrice) : undefined;
    dto.requiresPrescription = entity.requiresPrescription;
    dto.isControlledSubstance = entity.isControlledSubstance;
    dto.isHighRisk = entity.isHighRisk;
    dto.isSingleUse = entity.isSingleUse;
    dto.isSterile = entity.isSterile;
    dto.isSplittable = entity.isSplittable;
    dto.basePackSize = entity.basePackSize ? Number(entity.basePackSize) : undefined;
    dto.basePackUnit = entity.basePackUnit;
    dto.minimumDispenseQuantity = entity.minimumDispenseQuantity ? Number(entity.minimumDispenseQuantity) : undefined;
    dto.useOpenedPacksFirst = entity.useOpenedPacksFirst;
    dto.splitUnits = entity.splitUnits;
    dto.materialComposition = entity.materialComposition;
    dto.storageConditions = entity.storageConditions;
    dto.storageOverrides = entity.storageOverrides;
    dto.metadata = entity.metadata;
    dto.categoryId = entity.categoryId;
    dto.supplierId = entity.supplierId;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt?.toISOString();
    dto.updatedAt = entity.updatedAt?.toISOString();
    dto.stockValue = Number(entity.availableQuantity) * Number(entity.unitCost);
    dto.stockStatus = MedicationItemResponseDto.computeStockStatus(entity);
    if (entity.batches) {
      dto.batches = entity.batches.map(BatchResponseDto.fromEntity);
    }
    return dto;
  }

  private static computeStockStatus(entity: MedicationItem): string {
    const available = Number(entity.availableQuantity);
    const minimum = Number(entity.minimumStockLevel);
    if (available <= 0) return 'OUT_OF_STOCK';
    if (minimum > 0 && available <= minimum * 0.1) return 'CRITICAL_STOCK';
    if (minimum > 0 && available <= minimum * 0.2) return 'LOW_STOCK';
    if (minimum > 0 && available >= minimum * 3) return 'OVERSTOCKED';
    return 'IN_STOCK';
  }
}
