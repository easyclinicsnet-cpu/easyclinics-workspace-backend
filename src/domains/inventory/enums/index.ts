/**
 * Inventory Domain Enums
 * Domain-specific enums that complement the common enums
 */

export enum BatchPriority {
  FEFO = 'FEFO',
  FIFO = 'FIFO',
  LEFO = 'LEFO',
  OPTIMAL_COST = 'OPTIMAL_COST',
  EMERGENCY = 'EMERGENCY',
}

export enum BatchAlertType {
  EXPIRING_SOON = 'EXPIRING_SOON',
  EXPIRED = 'EXPIRED',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  QUARANTINED = 'QUARANTINED',
  QUALITY_FAILED = 'QUALITY_FAILED',
  STERILITY_EXPIRED = 'STERILITY_EXPIRED',
}

export enum BatchSortField {
  EXPIRY_DATE = 'expiryDate',
  MANUFACTURE_DATE = 'manufactureDate',
  AVAILABLE_QUANTITY = 'availableQuantity',
  UNIT_COST = 'unitCost',
  CREATED_AT = 'createdAt',
  BATCH_NUMBER = 'batchNumber',
}

export enum StockStatus {
  IN_STOCK = 'IN_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  CRITICAL_STOCK = 'CRITICAL_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  OVERSTOCKED = 'OVERSTOCKED',
}

export enum EmergencyLevel {
  NONE = 'NONE',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum DispenseType {
  FULL = 'FULL',
  PARTIAL = 'PARTIAL',
  EMERGENCY = 'EMERGENCY',
}

export enum TransferReason {
  RESTOCK = 'RESTOCK',
  REDISTRIBUTION = 'REDISTRIBUTION',
  CONSOLIDATION = 'CONSOLIDATION',
  PATIENT_TRANSFER = 'PATIENT_TRANSFER',
  EXPIRY_MANAGEMENT = 'EXPIRY_MANAGEMENT',
  OTHER = 'OTHER',
}

export enum TransferType {
  INTERNAL = 'INTERNAL',
  EXTERNAL = 'EXTERNAL',
  INTER_DEPARTMENT = 'INTER_DEPARTMENT',
}

export enum AuditActionType {
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
  AUTOMATED_UPDATE = 'AUTOMATED_UPDATE',
  SYSTEM_SYNC = 'SYSTEM_SYNC',
  TRANSFER = 'TRANSFER',
  OTHER = 'OTHER',
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
