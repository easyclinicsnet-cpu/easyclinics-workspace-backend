/**
 * Inventory Domain Types
 * Type definitions for partial dispense tracking and pack management
 */

// ─── Partial Dispense Types ──────────────────────────────────────────────────

export interface CurrentOpenPackInfo {
  packIdentifier: string;
  batchId: string;
  originalPackSize: number;
  remainingQuantity: number;
  openedAt: string;
  openedBy: string;
}

export interface OpenedPackHistoryEntry {
  packIdentifier: string;
  batchId: string;
  originalPackSize: number;
  openedAt: string;
  openedBy: string;
  depletedAt?: string;
  totalDispensed: number;
}

export interface LastPartialDispenseInfo {
  dispensedAt: string;
  dispensedBy: string;
  quantity: number;
  packIdentifier: string;
  batchId: string;
}

export interface PartialDispenseMetadata {
  currentOpenPack?: CurrentOpenPackInfo;
  openedPacksHistory: OpenedPackHistoryEntry[];
  lastPartialDispense?: LastPartialDispenseInfo;
  totalPartialDispenses: number;
}

export interface BatchQuantityTrackingConfig {
  isFractionalTracking: boolean;
  packSize?: number;
  quantityUnit?: string;
  totalPacks: number;
  openedPacks: number;
}

// ─── Partial Dispense Results ────────────────────────────────────────────────

export interface PartialDispenseResult {
  success: boolean;
  dispensedQuantity: number;
  remainingInPack: number;
  packIdentifier: string;
  batchId: string;
  unitPrice: number;
  totalPrice: number;
  isNewPackOpened: boolean;
}

export interface WholePackDispenseResult {
  success: boolean;
  packsDispensed: number;
  totalQuantity: number;
  batchId: string;
  unitPrice: number;
  totalPrice: number;
}

export interface PackTrackingSummary {
  totalPacks: number;
  openedPacks: number;
  sealedPacks: number;
  currentOpenPackRemaining?: number;
}

// ─── Stock Calculation Types ─────────────────────────────────────────────────

export interface StockProjection {
  currentStock: number;
  projectedStock: number;
  daysUntilStockout: number;
  averageDailyUsage: number;
  reorderPoint: number;
}

export interface TurnoverAnalysis {
  turnoverRate: number;
  daysOfInventory: number;
  fullDispenseCount: number;
  partialDispenseCount: number;
  totalDispenseValue: number;
}

export interface DispensePatternAnalysis {
  totalDispenses: number;
  fullDispenses: number;
  partialDispenses: number;
  partialPercentage: number;
  averagePartialQuantity: number;
}

// ─── Report Types ────────────────────────────────────────────────────────────

export interface StockLevelReport {
  itemId: string;
  itemName: string;
  itemCode: string;
  itemType: string;
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  minimumStockLevel: number;
  reorderQuantity: number;
  stockStatus: string;
  unitCost: number;
  totalValue: number;
}

export interface StockMovementReport {
  movementId: string;
  itemId: string;
  itemName: string;
  batchNumber?: string;
  movementType: string;
  quantity: number;
  department: string;
  initiatedBy?: string;
  date: Date;
}

export interface ExpiryAlertReport {
  batchId: string;
  batchNumber: string;
  itemId: string;
  itemName: string;
  expiryDate: Date;
  daysUntilExpiry: number;
  availableQuantity: number;
  unitCost: number;
  totalValue: number;
}

export interface StockValuationReport {
  itemId: string;
  itemName: string;
  itemCode: string;
  totalQuantity: number;
  averageUnitCost: number;
  totalValue: number;
  batchCount: number;
}

// ─── Split Unit Types ────────────────────────────────────────────────────────

export interface SplitUnitDefinition {
  name: string;
  quantity: number;
  unit: string;
  priceMultiplier?: number;
}

// ─── Type Guards ─────────────────────────────────────────────────────────────

export function isPartialDispenseMetadata(obj: any): obj is PartialDispenseMetadata {
  return (
    obj &&
    typeof obj === 'object' &&
    Array.isArray(obj.openedPacksHistory) &&
    typeof obj.totalPartialDispenses === 'number'
  );
}

export function hasPackTracking(obj: any): obj is BatchQuantityTrackingConfig {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.isFractionalTracking === 'boolean' &&
    typeof obj.totalPacks === 'number'
  );
}
