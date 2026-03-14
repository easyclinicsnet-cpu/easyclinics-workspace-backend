import {
  StockProjection,
  TurnoverAnalysis,
  DispensePatternAnalysis,
  StockLevelReport,
  ExpiryAlertReport,
  StockValuationReport,
} from '../types';
import { StockStatus } from '../enums';
import { InventoryHelper } from './inventory.helper';
import { INVENTORY_CONSTANTS } from '../constants';

/**
 * Stock calculation utilities for projections, turnover, and analysis
 */
export class StockCalculator {
  static calculateStockProjection(
    currentStock: number,
    averageDailyUsage: number,
    reorderPoint: number,
    incomingStock: number = 0,
  ): StockProjection {
    const projectedStock = currentStock + incomingStock;
    const daysUntilStockout =
      averageDailyUsage > 0 ? Math.floor(projectedStock / averageDailyUsage) : Infinity;

    return {
      currentStock,
      projectedStock,
      daysUntilStockout: daysUntilStockout === Infinity ? -1 : daysUntilStockout,
      averageDailyUsage,
      reorderPoint,
    };
  }

  static calculateTurnoverAnalysis(
    averageInventoryValue: number,
    totalDispenseValue: number,
    fullDispenseCount: number,
    partialDispenseCount: number,
    periodDays: number = 365,
  ): TurnoverAnalysis {
    const turnoverRate =
      averageInventoryValue > 0
        ? Math.round((totalDispenseValue / averageInventoryValue) * 100) / 100
        : 0;
    const daysOfInventory =
      turnoverRate > 0 ? Math.round(periodDays / turnoverRate) : -1;

    return {
      turnoverRate,
      daysOfInventory,
      fullDispenseCount,
      partialDispenseCount,
      totalDispenseValue,
    };
  }

  static calculateDispensePattern(
    fullDispenses: number,
    partialDispenses: number,
    totalPartialQuantity: number,
  ): DispensePatternAnalysis {
    const totalDispenses = fullDispenses + partialDispenses;
    const partialPercentage =
      totalDispenses > 0
        ? Math.round((partialDispenses / totalDispenses) * 10000) / 100
        : 0;
    const averagePartialQuantity =
      partialDispenses > 0
        ? Math.round((totalPartialQuantity / partialDispenses) * 10000) / 10000
        : 0;

    return {
      totalDispenses,
      fullDispenses,
      partialDispenses,
      partialPercentage,
      averagePartialQuantity,
    };
  }

  static buildStockLevelReport(item: {
    id: string;
    name: string;
    code: string;
    type: string;
    totalQuantity: number;
    availableQuantity: number;
    reservedQuantity: number;
    minimumStockLevel: number;
    reorderQuantity: number;
    unitCost: number;
  }): StockLevelReport {
    const stockStatus = InventoryHelper.calculateStockStatus(
      Number(item.availableQuantity),
      Number(item.minimumStockLevel),
      Number(item.reorderQuantity),
    );

    return {
      itemId: item.id,
      itemName: item.name,
      itemCode: item.code,
      itemType: item.type,
      totalQuantity: Number(item.totalQuantity),
      availableQuantity: Number(item.availableQuantity),
      reservedQuantity: Number(item.reservedQuantity),
      minimumStockLevel: Number(item.minimumStockLevel),
      reorderQuantity: Number(item.reorderQuantity),
      stockStatus,
      unitCost: Number(item.unitCost),
      totalValue: InventoryHelper.calculateStockValue(
        Number(item.availableQuantity),
        Number(item.unitCost),
      ),
    };
  }

  static buildExpiryAlertReport(batch: {
    id: string;
    batchNumber: string;
    itemId: string;
    itemName: string;
    expiryDate: Date;
    availableQuantity: number;
    unitCost: number;
  }): ExpiryAlertReport {
    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      itemId: batch.itemId,
      itemName: batch.itemName,
      expiryDate: new Date(batch.expiryDate),
      daysUntilExpiry: InventoryHelper.calculateDaysUntilExpiry(batch.expiryDate),
      availableQuantity: Number(batch.availableQuantity),
      unitCost: Number(batch.unitCost),
      totalValue: InventoryHelper.calculateStockValue(
        Number(batch.availableQuantity),
        Number(batch.unitCost),
      ),
    };
  }

  static buildStockValuationReport(item: {
    id: string;
    name: string;
    code: string;
    totalQuantity: number;
    averageUnitCost: number;
    batchCount: number;
  }): StockValuationReport {
    return {
      itemId: item.id,
      itemName: item.name,
      itemCode: item.code,
      totalQuantity: Number(item.totalQuantity),
      averageUnitCost: Number(item.averageUnitCost),
      totalValue: InventoryHelper.calculateStockValue(
        Number(item.totalQuantity),
        Number(item.averageUnitCost),
      ),
      batchCount: item.batchCount,
    };
  }

  static calculateAverageDailyUsage(
    totalDispensed: number,
    periodDays: number,
  ): number {
    if (periodDays <= 0) return 0;
    return Math.round((totalDispensed / periodDays) * 10000) / 10000;
  }

  static calculateReorderPoint(
    averageDailyUsage: number,
    leadTimeDays: number,
    safetyStockDays: number = 7,
  ): number {
    return Math.ceil(averageDailyUsage * (leadTimeDays + safetyStockDays));
  }
}
