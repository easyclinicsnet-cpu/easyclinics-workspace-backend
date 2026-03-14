import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  MovementType,
  BillStatus,
  AuditEventType,
  AuditOutcome,
} from '../../../common/enums';
import { BillItem } from '../entities/bill-item.entity';
import { BillingTransaction } from '../entities/billing-transaction.entity';
import { PatientBill } from '../entities/patient-bill.entity';
import { AuditLogService } from '../../audit/services/audit-log.service';
import {
  BillingStrategy,
  BillingContext,
  MovementBillingContext,
  BillingResult,
  BillingReversalResult,
  ValidationResult,
  BillingEstimate,
  BillingError,
  BillingState,
  StrategyPriority,
  AuditEntry,
} from './billing-strategy.interface';

/** Monetary threshold above which adjustments require supervisor approval. */
const ADJUSTMENT_APPROVAL_THRESHOLD = 500;

/**
 * Adjustment Billing Strategy
 *
 * Handles billing adjustments for inventory corrections, physical count
 * discrepancies, cost adjustments, and manual price overrides.
 *
 * Features:
 * - Support for positive (ADJUSTMENT_IN) and negative (ADJUSTMENT_OUT) adjustments
 * - Cost corrections and physical count reconciliation
 * - Approval gating for high-value adjustments
 * - Reason-based categorisation for audit compliance
 * - Full audit trail with previous/new state tracking
 */
@Injectable()
export class AdjustmentBillingStrategy implements BillingStrategy {
  readonly strategyName = 'AdjustmentBillingStrategy';
  readonly priority = StrategyPriority.LOW;

  private readonly context = AdjustmentBillingStrategy.name;

  /** Movement types handled by this strategy. */
  private readonly supportedTypes: MovementType[] = [
    MovementType.ADJUSTMENT_IN,
    MovementType.ADJUSTMENT_OUT,
    MovementType.ADJUSTMENT_CORRECTION,
    MovementType.PHYSICAL_COUNT,
    MovementType.ADJUSTMENT,
  ];

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext(this.context);
  }

  // ─── BillingStrategy interface ─────────────────────────────────────────

  /**
   * Returns true for ADJUSTMENT_IN, ADJUSTMENT_OUT, ADJUSTMENT_CORRECTION,
   * PHYSICAL_COUNT, and ADJUSTMENT movement types.
   */
  supports(movementType: MovementType, _context?: BillingContext): boolean {
    return this.supportedTypes.includes(movementType);
  }

  /**
   * Process an adjustment billing operation.
   *
   * 1. Validate the adjustment context
   * 2. Determine adjustment direction (credit or debit)
   * 3. Create an adjustment BillingTransaction
   * 4. Update bill totals if applicable
   * 5. Log audit trail
   */
  async processBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingResult> {
    const operationReference = this.generateReference('ADJ');
    const auditEntries: AuditEntry[] = [];
    const warnings: string[] = [];

    this.logger.log(
      `Processing adjustment billing: ${operationReference}, type: ${context.movementType}`,
    );

    // Pre-flight validation
    const validation = await this.validateBilling(context);
    if (!validation.isValid) {
      return this.buildFailedResult(operationReference, validation.errors, auditEntries);
    }
    warnings.push(...validation.warnings);

    const exec = async (em: EntityManager): Promise<BillingResult> => {
      // 1. Determine adjustment amount and direction
      const unitPrice = this.resolveUnitPrice(context);
      const adjustmentAmount = unitPrice * context.quantity;
      const isCredit = this.isCreditAdjustment(context.movementType);
      const signedAmount = isCredit ? -adjustmentAmount : adjustmentAmount;

      // 2. Check approval threshold
      const requiresApproval = Math.abs(adjustmentAmount) >= ADJUSTMENT_APPROVAL_THRESHOLD;
      if (requiresApproval) {
        warnings.push(
          `Adjustment amount (${Math.abs(adjustmentAmount).toFixed(2)}) exceeds approval threshold (${ADJUSTMENT_APPROVAL_THRESHOLD})`,
        );
      }

      // 3. Resolve the bill
      let bill: PatientBill | null = null;
      if (context.existingBillId) {
        bill = await em.findOne(PatientBill, { where: { id: context.existingBillId } });
      } else if (context.appointmentId) {
        bill = await em.findOne(PatientBill, { where: { appointmentId: context.appointmentId } });
      }

      // 4. Create adjustment BillItem (only if bill exists)
      let savedBillItem: BillItem | undefined;
      if (bill) {
        const billItem = em.create(BillItem, {
          billId: bill.id,
          description: `Adjustment (${context.movementType}): ${context.item.name} (${context.item.code})`,
          quantity: isCredit ? -context.quantity : context.quantity,
          unitPrice,
          totalPrice: signedAmount,
          department: context.department,
          medicationItemId: context.item.medicationItemId,
          consumableItemId: context.item.consumableItemId,
          batchId: context.batch?.id,
          actualUnitCost: context.batch?.costPrice,
          metadata: {
            operationReference,
            movementType: context.movementType,
            adjustmentReason: context.reason,
            adjustmentDirection: isCredit ? 'CREDIT' : 'DEBIT',
          },
        });
        savedBillItem = await em.save(BillItem, billItem);
      }

      // 5. Create BillingTransaction
      const transaction = em.create(BillingTransaction, {
        transactionReference: operationReference,
        transactionType: `ADJUSTMENT_${isCredit ? 'CREDIT' : 'DEBIT'}`,
        billId: bill?.id,
        amount: signedAmount,
        balanceBefore: bill ? Number(bill.total) : 0,
        balanceAfter: bill ? Math.max(0, Number(bill.total) + signedAmount) : signedAmount,
        status: requiresApproval ? 'PENDING_APPROVAL' : 'COMPLETED',
        transactionDate: new Date(),
        processedBy: context.initiatedBy,
        description: `${isCredit ? 'Credit' : 'Debit'} adjustment: ${context.item.name} x${context.quantity}`,
        notes: context.reason || `${context.movementType} adjustment`,
        metadata: {
          operationReference,
          movementType: context.movementType,
          itemId: context.item.id,
          itemCode: context.item.code,
          adjustmentDirection: isCredit ? 'CREDIT' : 'DEBIT',
          adjustmentAmount,
          batchId: context.batch?.id,
        },
      });
      const savedTransaction = await em.save(BillingTransaction, transaction);

      // 6. Update bill totals if applicable
      if (bill) {
        bill.subtotal = Math.max(0, Number(bill.subtotal) + signedAmount);
        bill.total = Math.max(0, Number(bill.total) + signedAmount);

        if (Number(bill.total) <= 0 && isCredit) {
          bill.status = BillStatus.REFUNDED;
        }

        await em.save(PatientBill, bill);
      }

      // 7. Audit entry
      auditEntries.push({
        action: `Adjustment billing (${isCredit ? 'CREDIT' : 'DEBIT'}): ${context.item.name} x${context.quantity}, amount: ${signedAmount}`,
        resourceType: 'BillingTransaction',
        resourceId: savedTransaction.id,
        userId: context.initiatedBy,
        workspaceId: context.workspaceId,
        timestamp: new Date(),
        newState: {
          transactionReference: operationReference,
          amount: signedAmount,
          movementType: context.movementType,
          reason: context.reason,
        },
      });

      return {
        success: true,
        billingTransactions: [savedTransaction],
        billItems: savedBillItem ? [savedBillItem] : [],
        totalAmount: signedAmount,
        warnings,
        errors: [],
        bill: bill || undefined,
        billingState: requiresApproval
          ? BillingState.PENDING_APPROVAL
          : BillingState.COMPLETED,
        operationReference,
        auditEntries,
        metadata: {
          adjustmentDirection: isCredit ? 'CREDIT' : 'DEBIT',
          adjustmentAmount,
          movementType: context.movementType,
          unitPrice,
          quantity: context.quantity,
        },
      };
    };

    try {
      let result: BillingResult;
      if (manager) {
        result = await exec(manager);
      } else {
        result = await this.dataSource.transaction(async (em) => exec(em));
      }

      this.persistAuditEntries(auditEntries, context).catch(() => {
        this.logger.warn('Failed to persist audit entries for adjustment billing');
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Adjustment billing failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return this.buildFailedResult(
        operationReference,
        [{ code: 'ADJUSTMENT_BILLING_FAILED', message: (error as Error).message }],
        auditEntries,
      );
    }
  }

  /**
   * Reverse a previously processed adjustment.
   */
  async reverseBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingReversalResult> {
    const operationReference = this.generateReference('ADJ-REV');
    const auditEntries: AuditEntry[] = [];

    this.logger.log(
      `Reversing adjustment billing: ${operationReference}, original ref: ${context.originalTransactionReference}`,
    );

    if (!context.originalTransactionReference) {
      return {
        success: false,
        reversalTransaction: {},
        refundAmount: 0,
        restoredItems: [],
        warnings: [],
        errors: [
          { code: 'MISSING_ORIGINAL_REFERENCE', message: 'Original transaction reference is required for reversal' },
        ],
        billingState: BillingState.FAILED,
        operationReference,
        auditEntries,
      };
    }

    const exec = async (em: EntityManager): Promise<BillingReversalResult> => {
      const originalTransaction = await em.findOne(BillingTransaction, {
        where: { transactionReference: context.originalTransactionReference },
      });

      if (!originalTransaction) {
        return {
          success: false,
          reversalTransaction: {},
          refundAmount: 0,
          restoredItems: [],
          warnings: [],
          errors: [
            { code: 'ORIGINAL_TRANSACTION_NOT_FOUND', message: `Transaction ${context.originalTransactionReference} not found` },
          ],
          billingState: BillingState.FAILED,
          operationReference,
          auditEntries,
        };
      }

      // Reverse the original amount
      const reversalAmount = -Number(originalTransaction.amount);

      const reversalTransaction = em.create(BillingTransaction, {
        transactionReference: operationReference,
        transactionType: 'ADJUSTMENT_REVERSAL',
        billId: originalTransaction.billId,
        amount: reversalAmount,
        balanceBefore: Number(originalTransaction.balanceAfter),
        balanceAfter: Number(originalTransaction.balanceAfter) + reversalAmount,
        status: 'COMPLETED',
        transactionDate: new Date(),
        processedBy: context.initiatedBy,
        description: `Adjustment reversal for ${context.originalTransactionReference}`,
        notes: context.reason || 'Adjustment reversal',
        metadata: {
          operationReference,
          originalTransactionReference: context.originalTransactionReference,
          reversalAmount,
        },
      });
      const savedReversal = await em.save(BillingTransaction, reversalTransaction);

      // Update bill totals
      if (originalTransaction.billId) {
        const bill = await em.findOne(PatientBill, {
          where: { id: originalTransaction.billId },
        });
        if (bill) {
          bill.subtotal = Math.max(0, Number(bill.subtotal) + reversalAmount);
          bill.total = Math.max(0, Number(bill.total) + reversalAmount);
          await em.save(PatientBill, bill);
        }
      }

      // Mark original as reversed
      originalTransaction.status = 'REVERSED';
      originalTransaction.metadata = {
        ...originalTransaction.metadata,
        reversalReference: operationReference,
        reversedAt: new Date().toISOString(),
      };
      await em.save(BillingTransaction, originalTransaction);

      auditEntries.push({
        action: `Adjustment reversal: ${context.originalTransactionReference}`,
        resourceType: 'BillingTransaction',
        resourceId: savedReversal.id,
        userId: context.initiatedBy,
        workspaceId: context.workspaceId,
        timestamp: new Date(),
        previousState: { status: originalTransaction.status, amount: originalTransaction.amount },
        newState: { status: 'REVERSED', reversalAmount },
      });

      return {
        success: true,
        reversalTransaction: savedReversal,
        refundAmount: Math.abs(reversalAmount),
        restoredItems: [
          { itemId: context.item.id, quantity: context.quantity, batchId: context.batch?.id },
        ],
        warnings: [],
        errors: [],
        billingState: BillingState.REVERSED,
        operationReference,
        auditEntries,
      };
    };

    try {
      let result: BillingReversalResult;
      if (manager) {
        result = await exec(manager);
      } else {
        result = await this.dataSource.transaction(async (em) => exec(em));
      }

      this.persistAuditEntries(auditEntries, context).catch(() => {
        this.logger.warn('Failed to persist audit entries for adjustment reversal');
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Adjustment reversal failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return {
        success: false,
        reversalTransaction: {},
        refundAmount: 0,
        restoredItems: [],
        warnings: [],
        errors: [{ code: 'ADJUSTMENT_REVERSAL_FAILED', message: (error as Error).message }],
        billingState: BillingState.FAILED,
        operationReference,
        auditEntries,
      };
    }
  }

  /**
   * Validate an adjustment billing context without executing.
   */
  async validateBilling(context: MovementBillingContext): Promise<ValidationResult> {
    const errors: BillingError[] = [];
    const warnings: string[] = [];

    if (!context.workspaceId) {
      errors.push({ code: 'MISSING_WORKSPACE', message: 'Workspace ID is required' });
    }
    if (!context.item) {
      errors.push({ code: 'MISSING_ITEM', message: 'Adjusted item is required' });
    }
    if (!context.quantity || context.quantity <= 0) {
      errors.push({ code: 'INVALID_QUANTITY', message: 'Adjustment quantity must be greater than zero' });
    }
    if (!context.reason) {
      warnings.push('No adjustment reason provided; a reason is recommended for audit compliance');
    }
    if (!context.initiatedBy) {
      errors.push({ code: 'MISSING_INITIATOR', message: 'Initiating user ID is required' });
    }

    // Physical count adjustments should include count data
    if (
      context.movementType === MovementType.PHYSICAL_COUNT &&
      !context.movementMetadata?.physicalCount
    ) {
      warnings.push('Physical count adjustment missing physicalCount in metadata');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Produce a cost estimate for an adjustment operation.
   */
  async estimateBilling(context: MovementBillingContext): Promise<BillingEstimate> {
    const unitPrice = this.resolveUnitPrice(context);
    const adjustmentAmount = unitPrice * context.quantity;
    const isCredit = this.isCreditAdjustment(context.movementType);
    const signedAmount = isCredit ? -adjustmentAmount : adjustmentAmount;
    const requiresApproval = Math.abs(adjustmentAmount) >= ADJUSTMENT_APPROVAL_THRESHOLD;

    return {
      subtotal: signedAmount,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: signedAmount,
      requiresApproval,
      approvalReason: requiresApproval
        ? `Adjustment amount (${Math.abs(adjustmentAmount).toFixed(2)}) exceeds threshold (${ADJUSTMENT_APPROVAL_THRESHOLD})`
        : undefined,
      metadata: {
        adjustmentDirection: isCredit ? 'CREDIT' : 'DEBIT',
        unitPrice,
        quantity: context.quantity,
        movementType: context.movementType,
      },
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * Determine whether the adjustment type results in a credit (negative amount).
   */
  private isCreditAdjustment(movementType: MovementType): boolean {
    const creditTypes: MovementType[] = [
      MovementType.ADJUSTMENT_OUT,
      MovementType.ADJUSTMENT_CORRECTION,
    ];
    return creditTypes.includes(movementType);
  }

  private resolveUnitPrice(context: MovementBillingContext): number {
    if (context.unitPrice !== undefined && context.unitPrice !== null) {
      return context.unitPrice;
    }
    if (context.item?.sellingPrice !== undefined && context.item.sellingPrice !== null) {
      return context.item.sellingPrice;
    }
    if (context.batch?.costPrice !== undefined && context.batch.costPrice !== null) {
      return context.batch.costPrice;
    }
    return 0;
  }

  private async persistAuditEntries(
    entries: AuditEntry[],
    context: MovementBillingContext,
  ): Promise<void> {
    for (const entry of entries) {
      try {
        await this.auditLogService.log(
          {
            userId: entry.userId,
            action: entry.action,
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            newState: entry.newState,
            previousState: entry.previousState,
            metadata: entry.metadata,
          },
          context.workspaceId,
        );
      } catch {
        this.logger.warn(`Failed to persist audit entry: ${entry.action}`);
      }
    }
  }

  private buildFailedResult(
    operationReference: string,
    errors: BillingError[],
    auditEntries: AuditEntry[],
  ): BillingResult {
    return {
      success: false,
      billingTransactions: [],
      billItems: [],
      totalAmount: 0,
      warnings: [],
      errors,
      billingState: BillingState.FAILED,
      operationReference,
      auditEntries,
    };
  }

  private generateReference(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `${prefix}-${timestamp}-${random}`;
  }
}
