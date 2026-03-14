import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  MovementType,
  BillStatus,
  InsuranceClaimStatus,
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

/** Maximum return window in days. */
const RETURN_WINDOW_DAYS = 30;

/** Restocking fee as a fraction of the original item price. */
const RESTOCKING_FEE_RATE = 0.10;

/**
 * Return Billing Strategy
 *
 * Handles billing adjustments for returned medications and consumables.
 * Creates credit transactions and adjusts bill totals accordingly.
 *
 * Features:
 * - Credit transaction generation for returns
 * - Restocking fee calculation
 * - Return window validation
 * - Original transaction lookup and reversal
 * - Insurance refund split calculation
 * - Full audit trail
 */
@Injectable()
export class ReturnBillingStrategy implements BillingStrategy {
  readonly strategyName = 'ReturnBillingStrategy';
  readonly priority = StrategyPriority.MEDIUM;

  private readonly context = ReturnBillingStrategy.name;

  /** Movement types handled by this strategy. */
  private readonly supportedTypes: MovementType[] = [MovementType.RETURN];

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext(this.context);
  }

  // ─── BillingStrategy interface ─────────────────────────────────────────

  /**
   * Returns true for RETURN movement types.
   */
  supports(movementType: MovementType, _context?: BillingContext): boolean {
    return this.supportedTypes.includes(movementType);
  }

  /**
   * Process a return billing operation.
   *
   * 1. Validate the return context
   * 2. Find the original dispense transaction
   * 3. Calculate refund amount (minus restocking fee)
   * 4. Create a credit BillingTransaction
   * 5. Update bill totals
   * 6. Log audit trail
   */
  async processBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingResult> {
    const operationReference = this.generateReference('RET');
    const auditEntries: AuditEntry[] = [];
    const warnings: string[] = [];

    this.logger.log(`Processing return billing: ${operationReference}`);

    // Pre-flight validation
    const validation = await this.validateBilling(context);
    if (!validation.isValid) {
      return this.buildFailedResult(operationReference, validation.errors, auditEntries);
    }
    warnings.push(...validation.warnings);

    const exec = async (em: EntityManager): Promise<BillingResult> => {
      // 1. Find the original transaction if reference is provided
      let originalTransaction: BillingTransaction | null = null;
      if (context.originalTransactionReference) {
        originalTransaction = await em.findOne(BillingTransaction, {
          where: { transactionReference: context.originalTransactionReference },
        });
      }

      // 2. Calculate refund amount
      const unitPrice = this.resolveUnitPrice(context, originalTransaction);
      const grossRefund = unitPrice * context.quantity;
      const restockingFee = this.calculateRestockingFee(grossRefund, context);
      const netRefund = grossRefund - restockingFee;

      // 3. Insurance refund split
      const { insuranceRefundAmount, patientRefundAmount } =
        this.calculateInsuranceRefundSplit(netRefund, context);

      if (restockingFee > 0) {
        warnings.push(
          `Restocking fee of ${restockingFee.toFixed(2)} applied (${(RESTOCKING_FEE_RATE * 100).toFixed(0)}%)`,
        );
      }

      // 4. Find or validate the bill
      let bill: PatientBill | null = null;
      if (context.existingBillId) {
        bill = await em.findOne(PatientBill, {
          where: { id: context.existingBillId },
        });
      } else if (originalTransaction?.billId) {
        bill = await em.findOne(PatientBill, {
          where: { id: originalTransaction.billId },
        });
      } else if (context.appointmentId) {
        bill = await em.findOne(PatientBill, {
          where: { appointmentId: context.appointmentId },
        });
      }

      if (!bill) {
        return this.buildFailedResult(
          operationReference,
          [{ code: 'BILL_NOT_FOUND', message: 'No bill found for this return' }],
          auditEntries,
        );
      }

      // 5. Create credit BillItem
      const creditItem = em.create(BillItem, {
        billId: bill.id,
        description: `Return: ${context.item.name} (${context.item.code}) x${context.quantity}`,
        quantity: context.quantity,
        unitPrice: -unitPrice,
        totalPrice: -netRefund,
        department: context.department,
        medicationItemId: context.item.medicationItemId,
        consumableItemId: context.item.consumableItemId,
        batchId: context.batch?.id,
        actualUnitCost: context.batch?.costPrice,
        hasInsuranceClaim: context.isInsuranceClaim || false,
        insuranceClaimStatus: context.isInsuranceClaim
          ? InsuranceClaimStatus.PENDING
          : InsuranceClaimStatus.NOT_CLAIMED,
        metadata: {
          operationReference,
          movementType: context.movementType,
          returnReason: context.reason,
          restockingFee,
          originalTransactionReference: context.originalTransactionReference,
        },
      });
      const savedCreditItem = await em.save(BillItem, creditItem);

      // 6. Create credit BillingTransaction
      const transaction = em.create(BillingTransaction, {
        transactionReference: operationReference,
        transactionType: 'RETURN',
        billId: bill.id,
        amount: -netRefund,
        balanceBefore: Number(bill.total),
        balanceAfter: Math.max(0, Number(bill.total) - netRefund),
        status: 'COMPLETED',
        transactionDate: new Date(),
        processedBy: context.initiatedBy,
        description: `Return credit: ${context.item.name} x${context.quantity}`,
        notes: context.reason || 'Item return',
        metadata: {
          operationReference,
          movementType: context.movementType,
          itemId: context.item.id,
          itemCode: context.item.code,
          grossRefund,
          restockingFee,
          netRefund,
          insuranceRefundAmount,
          patientRefundAmount,
          originalTransactionReference: context.originalTransactionReference,
        },
      });
      const savedTransaction = await em.save(BillingTransaction, transaction);

      // 7. Update bill totals
      bill.subtotal = Math.max(0, Number(bill.subtotal) - grossRefund);
      bill.total = Math.max(0, Number(bill.total) - patientRefundAmount);

      if (Number(bill.total) <= 0) {
        bill.status = BillStatus.REFUNDED;
      }

      await em.save(PatientBill, bill);

      // 8. Mark original transaction as returned if found
      if (originalTransaction) {
        originalTransaction.status = 'RETURNED';
        originalTransaction.metadata = {
          ...originalTransaction.metadata,
          returnReference: operationReference,
          returnedAt: new Date().toISOString(),
          returnedBy: context.initiatedBy,
        };
        await em.save(BillingTransaction, originalTransaction);
      }

      // 9. Audit entry
      auditEntries.push({
        action: `Return billing: ${context.item.name} x${context.quantity}, refund: ${netRefund}`,
        resourceType: 'BillingTransaction',
        resourceId: savedTransaction.id,
        userId: context.initiatedBy,
        workspaceId: context.workspaceId,
        timestamp: new Date(),
        newState: {
          transactionReference: operationReference,
          refundAmount: netRefund,
          restockingFee,
          itemCode: context.item.code,
          quantity: context.quantity,
        },
      });

      return {
        success: true,
        billingTransactions: [savedTransaction],
        billItems: [savedCreditItem],
        totalAmount: -netRefund,
        warnings,
        errors: [],
        bill,
        insuranceCoveredAmount: insuranceRefundAmount,
        patientResponsibility: patientRefundAmount,
        billingState: BillingState.COMPLETED,
        operationReference,
        auditEntries,
        metadata: {
          grossRefund,
          restockingFee,
          netRefund,
          originalTransactionReference: context.originalTransactionReference,
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
        this.logger.warn('Failed to persist audit entries for return billing');
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Return billing failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return this.buildFailedResult(
        operationReference,
        [{ code: 'RETURN_BILLING_FAILED', message: (error as Error).message }],
        auditEntries,
      );
    }
  }

  /**
   * Reverse a previously processed return (re-charge the patient).
   */
  async reverseBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingReversalResult> {
    const operationReference = this.generateReference('RET-REV');
    const auditEntries: AuditEntry[] = [];

    this.logger.log(
      `Reversing return billing: ${operationReference}, original ref: ${context.originalTransactionReference}`,
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

      // The original return was a negative amount; reversing it means adding back
      const rechargeAmount = Math.abs(Number(originalTransaction.amount));

      const reversalTransaction = em.create(BillingTransaction, {
        transactionReference: operationReference,
        transactionType: 'RETURN_REVERSAL',
        billId: originalTransaction.billId,
        amount: rechargeAmount,
        balanceBefore: Number(originalTransaction.balanceAfter),
        balanceAfter: Number(originalTransaction.balanceAfter) + rechargeAmount,
        status: 'COMPLETED',
        transactionDate: new Date(),
        processedBy: context.initiatedBy,
        description: `Return reversal: ${context.item.name} x${context.quantity}`,
        notes: context.reason || 'Return reversal',
        metadata: {
          operationReference,
          originalTransactionReference: context.originalTransactionReference,
          rechargeAmount,
        },
      });
      const savedReversal = await em.save(BillingTransaction, reversalTransaction);

      // Update bill totals
      if (originalTransaction.billId) {
        const bill = await em.findOne(PatientBill, {
          where: { id: originalTransaction.billId },
        });
        if (bill) {
          bill.subtotal = Number(bill.subtotal) + rechargeAmount;
          bill.total = Number(bill.total) + rechargeAmount;
          if (bill.status === BillStatus.REFUNDED) {
            bill.status = BillStatus.PENDING;
          }
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
        action: `Return reversal: recharge ${rechargeAmount}`,
        resourceType: 'BillingTransaction',
        resourceId: savedReversal.id,
        userId: context.initiatedBy,
        workspaceId: context.workspaceId,
        timestamp: new Date(),
        previousState: { status: 'COMPLETED', amount: originalTransaction.amount },
        newState: { status: 'REVERSED', rechargeAmount },
      });

      return {
        success: true,
        reversalTransaction: savedReversal,
        refundAmount: rechargeAmount,
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
        this.logger.warn('Failed to persist audit entries for return reversal');
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Return reversal failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return {
        success: false,
        reversalTransaction: {},
        refundAmount: 0,
        restoredItems: [],
        warnings: [],
        errors: [{ code: 'RETURN_REVERSAL_FAILED', message: (error as Error).message }],
        billingState: BillingState.FAILED,
        operationReference,
        auditEntries,
      };
    }
  }

  /**
   * Validate a return billing context without executing.
   */
  async validateBilling(context: MovementBillingContext): Promise<ValidationResult> {
    const errors: BillingError[] = [];
    const warnings: string[] = [];

    if (!context.patientId) {
      errors.push({ code: 'MISSING_PATIENT', message: 'Patient ID is required' });
    }
    if (!context.workspaceId) {
      errors.push({ code: 'MISSING_WORKSPACE', message: 'Workspace ID is required' });
    }
    if (!context.item) {
      errors.push({ code: 'MISSING_ITEM', message: 'Returned item is required' });
    }
    if (!context.quantity || context.quantity <= 0) {
      errors.push({ code: 'INVALID_QUANTITY', message: 'Return quantity must be greater than zero' });
    }
    if (!context.reason) {
      warnings.push('No return reason provided; consider adding one for audit purposes');
    }

    // Check return window if original transaction reference is provided
    if (context.originalTransactionReference && context.movementMetadata?.originalDate) {
      const originalDate = new Date(context.movementMetadata.originalDate);
      const daysSinceOriginal = Math.floor(
        (Date.now() - originalDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceOriginal > RETURN_WINDOW_DAYS) {
        warnings.push(
          `Return is outside the ${RETURN_WINDOW_DAYS}-day return window (${daysSinceOriginal} days ago). Approval may be required.`,
        );
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Produce a cost estimate for a return operation.
   */
  async estimateBilling(context: MovementBillingContext): Promise<BillingEstimate> {
    const unitPrice = this.resolveUnitPrice(context, null);
    const grossRefund = unitPrice * context.quantity;
    const restockingFee = this.calculateRestockingFee(grossRefund, context);
    const netRefund = grossRefund - restockingFee;

    const { insuranceRefundAmount, patientRefundAmount } =
      this.calculateInsuranceRefundSplit(netRefund, context);

    return {
      subtotal: -grossRefund,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: -netRefund,
      insuranceCoverage: insuranceRefundAmount,
      patientResponsibility: patientRefundAmount,
      requiresApproval: false,
      metadata: {
        grossRefund,
        restockingFee,
        netRefund,
        unitPrice,
        quantity: context.quantity,
      },
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private resolveUnitPrice(
    context: MovementBillingContext,
    originalTransaction: BillingTransaction | null,
  ): number {
    if (context.unitPrice !== undefined && context.unitPrice !== null) {
      return context.unitPrice;
    }
    if (originalTransaction?.metadata?.unitPrice) {
      return Number(originalTransaction.metadata.unitPrice);
    }
    if (context.item?.sellingPrice !== undefined) {
      return context.item.sellingPrice;
    }
    if (context.batch?.costPrice !== undefined) {
      return context.batch.costPrice;
    }
    return 0;
  }

  private calculateRestockingFee(
    grossRefund: number,
    context: MovementBillingContext,
  ): number {
    // No restocking fee for emergency returns
    if (context.movementMetadata?.isEmergencyReturn) {
      return 0;
    }
    // No fee for defective/expired items
    if (
      context.reason?.toLowerCase().includes('defective') ||
      context.reason?.toLowerCase().includes('expired')
    ) {
      return 0;
    }
    return Math.round(grossRefund * RESTOCKING_FEE_RATE * 100) / 100;
  }

  private calculateInsuranceRefundSplit(
    netRefund: number,
    context: MovementBillingContext,
  ): { insuranceRefundAmount: number; patientRefundAmount: number } {
    if (!context.isInsuranceClaim || !context.insuranceCoverage) {
      return { insuranceRefundAmount: 0, patientRefundAmount: netRefund };
    }

    const coverageRate = context.insuranceCoverage.coveragePercentage / 100;
    const insuranceRefundAmount = Math.round(netRefund * coverageRate * 100) / 100;
    const patientRefundAmount = Math.round((netRefund - insuranceRefundAmount) * 100) / 100;

    return { insuranceRefundAmount, patientRefundAmount };
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
