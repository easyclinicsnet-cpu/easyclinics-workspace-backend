/**
 * Inventory Domain Interfaces
 */

import { ItemType, MovementType, AdjustmentType } from '../../../common/enums';
import { BatchPriority, EmergencyLevel } from '../enums';
import { MedicationItem } from '../entities/medication-item.entity';
import { ConsumableItem } from '../entities/consumable-item.entity';
import { Batch } from '../entities/batch.entity';
import { SplitUnitDefinition } from '../types';

// ─── Inventory Item Interfaces ───────────────────────────────────────────────

export interface IInventoryItem {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
  type: ItemType;
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  minimumStockLevel: number;
  reorderQuantity: number;
  unitCost: number;
  sellingPrice?: number;
  isSplittable: boolean;
  basePackSize?: number;
  basePackUnit?: string;
  trackInBaseUnits: boolean;
}

export interface ISplittableItem extends IInventoryItem {
  isSplittable: true;
  basePackSize: number;
  basePackUnit: string;
  minimumDispenseQuantity?: number;
  useOpenedPacksFirst: boolean;
  splitUnits?: SplitUnitDefinition[];
  baseUnitPrice?: number;
}

export type InventoryItemUnion = MedicationItem | ConsumableItem;

// ─── Batch Selection Interfaces ──────────────────────────────────────────────

export interface IBatchSelectionCriteria {
  workspaceId: string;
  itemId: string;
  itemType: ItemType;
  quantity: number;
  priority?: BatchPriority;
  requireSterile?: boolean;
  excludeQuarantined?: boolean;
  excludeExpired?: boolean;
  department?: string;
}

export interface IEmergencyBatchSelectionCriteria extends IBatchSelectionCriteria {
  emergencyLevel: EmergencyLevel;
  authorizedBy: string;
  justification: string;
  overrideExpiry?: boolean;
  overrideQuality?: boolean;
}

export interface IBatchSelectionItem {
  batch: Batch;
  allocatedQuantity: number;
  unitPrice: number;
  totalPrice: number;
  isPartial: boolean;
}

export interface IBatchSelectionResult {
  items: IBatchSelectionItem[];
  totalQuantity: number;
  totalCost: number;
  fullyAllocated: boolean;
  shortfall: number;
  warnings: string[];
}

export interface IBatchSelectionStrategy {
  select(
    batches: Batch[],
    requiredQuantity: number,
    criteria: IBatchSelectionCriteria,
  ): IBatchSelectionResult;
}

// ─── Movement Interfaces ─────────────────────────────────────────────────────

export interface IMovementData {
  workspaceId: string;
  itemId: string;
  itemType: ItemType;
  batchId?: string;
  quantity: number;
  movementType: MovementType;
  department: string;
  reference?: string;
  initiatedBy?: string;
  metadata?: Record<string, any>;
}

export interface IMovementStrategy {
  execute(data: IMovementData): Promise<void>;
}

// ─── Adjustment Interfaces ───────────────────────────────────────────────────

export interface IAdjustmentData {
  workspaceId: string;
  itemId: string;
  itemType: ItemType;
  batchId?: string;
  quantity: number;
  adjustmentType: AdjustmentType;
  reason: string;
  initiatedBy: string;
  approvedBy?: string;
  metadata?: Record<string, any>;
}

export interface IAdjustmentStrategy {
  execute(data: IAdjustmentData): Promise<void>;
}

// ─── Audit Interfaces ────────────────────────────────────────────────────────

export interface IInventoryAuditParams {
  workspaceId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  itemType?: ItemType;
  patientId?: string;
  previousState?: Record<string, any>;
  newState?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface IDispenseAuditParams extends IInventoryAuditParams {
  batchId?: string;
  quantity: number;
  department: string;
  isPartial: boolean;
  isEmergency: boolean;
}

// ─── Pricing Interfaces ─────────────────────────────────────────────────────

export interface IPricingResolution {
  unitPrice: number;
  totalPrice: number;
  source: 'override' | 'batch' | 'item' | 'proportional' | 'cost_markup';
  metadata?: Record<string, any>;
}

// ─── Pagination Interfaces ───────────────────────────────────────────────────

export interface IPaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface IPaginatedResult<T> {
  data: T[];
  meta: IPaginationMeta;
}

// ─── Storage Conditions Interfaces ───────────────────────────────────────────

export interface IStorageConditions {
  minTemperature?: number;
  maxTemperature?: number;
  humidity?: number;
  lightSensitive?: boolean;
  specialHandling?: string;
  requiresRefrigeration?: boolean;
  requiresFreezing?: boolean;
}

export interface IMaterialComposition {
  latexFree?: boolean;
  sterile?: boolean;
  color?: string;
  singleUse?: boolean;
  bpaFree?: boolean;
  pvcFree?: boolean;
}
