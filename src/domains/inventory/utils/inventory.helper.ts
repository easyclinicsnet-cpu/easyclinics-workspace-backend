import { INVENTORY_CONSTANTS, INBOUND_MOVEMENT_TYPES, OUTBOUND_MOVEMENT_TYPES } from '../constants';
import { StockStatus } from '../enums';

/**
 * Static helper methods for inventory calculations
 */
export class InventoryHelper {
  static calculateStockStatus(
    availableQuantity: number,
    minimumStockLevel: number,
    reorderQuantity: number,
  ): StockStatus {
    if (availableQuantity <= 0) return StockStatus.OUT_OF_STOCK;

    const criticalThreshold = minimumStockLevel * INVENTORY_CONSTANTS.STOCK_THRESHOLDS.CRITICAL_STOCK_PERCENTAGE;
    if (availableQuantity <= criticalThreshold) return StockStatus.CRITICAL_STOCK;

    const lowThreshold = minimumStockLevel * INVENTORY_CONSTANTS.STOCK_THRESHOLDS.LOW_STOCK_PERCENTAGE;
    if (availableQuantity <= minimumStockLevel || availableQuantity <= lowThreshold) return StockStatus.LOW_STOCK;

    const overstockThreshold = reorderQuantity * INVENTORY_CONSTANTS.STOCK_THRESHOLDS.OVERSTOCK_MULTIPLIER;
    if (availableQuantity >= overstockThreshold) return StockStatus.OVERSTOCKED;

    return StockStatus.IN_STOCK;
  }

  static isInboundMovement(movementType: string): boolean {
    return INBOUND_MOVEMENT_TYPES.includes(movementType as any);
  }

  static isOutboundMovement(movementType: string): boolean {
    return OUTBOUND_MOVEMENT_TYPES.includes(movementType as any);
  }

  static getMovementDirection(movementType: string): 1 | -1 | 0 {
    if (InventoryHelper.isInboundMovement(movementType)) return 1;
    if (InventoryHelper.isOutboundMovement(movementType)) return -1;
    return 0;
  }

  static calculateDaysUntilExpiry(expiryDate: Date): number {
    const now = new Date();
    const expiry = new Date(expiryDate);
    const diffMs = expiry.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  static isExpired(expiryDate: Date): boolean {
    return new Date(expiryDate) < new Date();
  }

  static isExpiringSoon(expiryDate: Date, warningDays?: number): boolean {
    const days = warningDays ?? INVENTORY_CONSTANTS.EXPIRY.WARNING_DAYS;
    return InventoryHelper.calculateDaysUntilExpiry(expiryDate) <= days;
  }

  static isCriticalExpiry(expiryDate: Date): boolean {
    return InventoryHelper.calculateDaysUntilExpiry(expiryDate) <= INVENTORY_CONSTANTS.EXPIRY.CRITICAL_DAYS;
  }

  static calculateStockValue(quantity: number, unitCost: number): number {
    return Math.round(quantity * unitCost * 100) / 100;
  }

  static calculateBaseUnitPrice(sellingPrice: number, packSize: number): number {
    if (packSize <= 0) return sellingPrice;
    return Math.round((sellingPrice / packSize) * 10000) / 10000;
  }

  static calculatePartialDispensePrice(
    baseUnitPrice: number,
    quantity: number,
  ): number {
    return Math.round(baseUnitPrice * quantity * 100) / 100;
  }

  static generateBatchNumber(prefix: string, date?: Date): string {
    const d = date || new Date();
    const year = d.getFullYear().toString().slice(-2);
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${year}${month}${day}-${random}`;
  }

  static generateItemCode(prefix: string, sequence: number): string {
    return `${prefix}-${sequence.toString().padStart(6, '0')}`;
  }

  static calculatePacksFromQuantity(
    quantity: number,
    packSize: number,
  ): { wholePacks: number; remainder: number } {
    if (packSize <= 0) return { wholePacks: 0, remainder: quantity };
    const wholePacks = Math.floor(quantity / packSize);
    const remainder = Math.round((quantity % packSize) * 10000) / 10000;
    return { wholePacks, remainder };
  }

  static calculateQuantityFromPacks(
    packs: number,
    packSize: number,
    additionalUnits: number = 0,
  ): number {
    return packs * packSize + additionalUnits;
  }

  static paginationDefaults(page?: number, limit?: number): { page: number; limit: number; skip: number } {
    const p = Math.max(1, page || 1);
    const l = Math.min(
      Math.max(1, limit || INVENTORY_CONSTANTS.DEFAULTS.PAGE_SIZE),
      INVENTORY_CONSTANTS.DEFAULTS.MAX_PAGE_SIZE,
    );
    return { page: p, limit: l, skip: (p - 1) * l };
  }
}
