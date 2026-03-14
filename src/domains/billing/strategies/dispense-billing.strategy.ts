import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { MovementType, BillStatus, InsuranceClaimStatus, AuditEventType, AuditOutcome } from '../../../common/enums';
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

/** Monetary threshold above which dispense operations require approval. */
const HIGH_VALUE_THRESHOLD = 1000;

/**
 * Dispense Billing Strategy
 *
 * Handles billing for medication and consumable dispensing operations
 * including full dispense, partial dispense, and emergency dispense.
 *
 * Features:
 * - Automatic BillingTransaction and BillItem creation
 * - Insurance claim integration
 * - Stock and batch validation
 * - Duplicate prevention via composite keys
 * - High-value approval gating (threshold: 1000)
 * - Full reversal with refund transaction generation
 */
@Injectable()
export class DispenseBillingStrategy implements BillingStrategy {
  readonly strategyName = 'DispenseBillingStrategy';
  readonly priority = StrategyPriority.HIGH;

  private readonly context = DispenseBillingStrategy.name;

  /** Movement types handled by this strategy. */
  private readonly supportedTypes: MovementType[] = [
    MovementType.DISPENSE,
    MovementType.PARTIAL_DISPENSE,
    MovementType.EMERGENCY_DISPENSE,
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
   * Returns true for DISPENSE, PARTIAL_DISPENSE, and EMERGENCY_DISPENSE.
   */
  supports(movementType: MovementType, _context?: BillingContext): boolean {
    return this.supportedTypes.includes(movementType);
  }

  /**
   * Process a dispense billing operation.
   *
   * 1. Validate the context
   * 2. Calculate pricing (with optional insurance split)
   * 3. Create or reuse a PatientBill
   * 4. Create a BillItem
   * 5. Create a BillingTransaction
   * 6. Log audit trail
   */
  async processBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingResult> {
    const operationReference = this.generateReference('DISP');
    const auditEntries: AuditEntry[] = [];
    const warnings: string[] = [];
    const errors: BillingError[] = [];

    this.logger.log(`Processing dispense billing: ${operationReference}`);

    // Pre-flight validation
    const validation = await this.validateBilling(context);
    if (!validation.isValid) {
      return this.buildFailedResult(operationReference, validation.errors, auditEntries);
    }
    warnings.push(...validation.warnings);

    // Check for duplicate dispense
    const duplicateCheck = await this.checkDuplicate(context, manager);
    if (duplicateCheck) {
      errors.push({
        code: 'DUPLICATE_DISPENSE',
        message: `A billing record already exists for item ${context.item.code} on bill ${context.existingBillId || context.appointmentId}`,
      });
      return this.buildFailedResult(operationReference, errors, auditEntries);
    }

    // Calculate amounts
    const unitPrice = this.resolveUnitPrice(context);
    const lineTotal = unitPrice * context.quantity;
    const { insuranceCoveredAmount, patientResponsibility } =
      this.calculateInsuranceSplit(lineTotal, context);

    // High-value approval check
    const requiresApproval = lineTotal >= HIGH_VALUE_THRESHOLD;
    if (requiresApproval) {
      warnings.push(
        `High-value dispense (${lineTotal}) requires approval (threshold: ${HIGH_VALUE_THRESHOLD})`,
      );
    }

    const exec = async (em: EntityManager): Promise<BillingResult> => {
      // 1. Resolve or create PatientBill
      const bill = await this.resolveOrCreateBill(context, em);

      // 2. Create BillItem
      const billItem = em.create(BillItem, {
        billId: bill.id,
        description: `Dispense: ${context.item.name} (${context.item.code})`,
        quantity: context.quantity,
        unitPrice,
        totalPrice: lineTotal,
        department: context.department,
        medicationItemId: context.item.medicationItemId,
        consumableItemId: context.item.consumableItemId,
        batchId: context.batch?.id,
        actualUnitCost: context.batch?.costPrice,
        hasInsuranceClaim: context.isInsuranceClaim || false,
        insuranceClaimStatus: context.isInsuranceClaim
          ? InsuranceClaimStatus.PENDING
          : InsuranceClaimStatus.NOT_CLAIMED,
        totalClaimedAmount: insuranceCoveredAmount,
        totalApprovedAmount: 0,
        totalDeniedAmount: 0,
        metadata: {
          operationReference,
          movementType: context.movementType,
          batchNumber: context.batch?.batchNumber,
          itemCode: context.item.code,
          ...(context.movementMetadata || {}),
        },
      });
      const savedBillItem = await em.save(BillItem, billItem);

      // 3. Update bill totals
      bill.subtotal = Number(bill.subtotal) + lineTotal;
      bill.total = Number(bill.total) + patientResponsibility;
      await em.save(PatientBill, bill);

      // 4. Create BillingTransaction
      const transaction = em.create(BillingTransaction, {
        transactionReference: operationReference,
        transactionType: 'DISPENSE',
        billId: bill.id,
        amount: lineTotal,
        balanceBefore: Number(bill.subtotal) - lineTotal,
        balanceAfter: Number(bill.subtotal),
        status: requiresApproval ? 'PENDING_APPROVAL' : 'COMPLETED',
        transactionDate: new Date(),
        processedBy: context.initiatedBy,
        description: `Dispense billing for ${context.item.name} x${context.quantity}`,
        notes: context.reason,
        metadata: {
          operationReference,
          movementType: context.movementType,
          itemId: context.item.id,
          itemCode: context.item.code,
          batchId: context.batch?.id,
          insuranceCoveredAmount,
          patientResponsibility,
        },
      });
      const savedTransaction = await em.save(BillingTransaction, transaction);

      // 5. Audit entry
      const auditEntry: AuditEntry = {
        action: `Dispense billing created: ${context.item.name} x${context.quantity}`,
        resourceType: 'BillingTransaction',
        resourceId: savedTransaction.id,
        userId: context.initiatedBy,
        workspaceId: context.workspaceId,
        timestamp: new Date(),
        newState: {
          transactionReference: operationReference,
          amount: lineTotal,
          itemCode: context.item.code,
          quantity: context.quantity,
        },
      };
      auditEntries.push(auditEntry);

      return {
        success: true,
        billingTransactions: [savedTransaction],
        billItems: [savedBillItem],
        totalAmount: lineTotal,
        warnings,
        errors: [],
        bill,
        insuranceCoveredAmount,
        patientResponsibility,
        billingState: requiresApproval
          ? BillingState.PENDING_APPROVAL
          : BillingState.COMPLETED,
        operationReference,
        auditEntries,
        metadata: {
          unitPrice,
          quantity: context.quantity,
          movementType: context.movementType,
          batchId: context.batch?.id,
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

      // Fire-and-forget audit log
      this.persistAuditEntries(auditEntries, context).catch(() => {
        this.logger.warn('Failed to persist audit entries for dispense billing');
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Dispense billing failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return this.buildFailedResult(
        operationReference,
        [
          {
            code: 'DISPENSE_BILLING_FAILED',
            message: (error as Error).message,
            details: { stack: (error as Error).stack },
          },
        ],
        auditEntries,
      );
    }
  }

  /**
   * Reverse a previously processed dispense billing.
   * Creates a reversal transaction and marks the original items as refunded.
   */
  async reverseBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingReversalResult> {
    const operationReference = this.generateReference('DISP-REV');
    const auditEntries: AuditEntry[] = [];
    const warnings: string[] = [];

    this.logger.log(
      `Reversing dispense billing: ${operationReference}, original ref: ${context.originalTransactionReference}`,
    );

    if (!context.originalTransactionReference) {
      return {
        success: false,
        reversalTransaction: {},
        refundAmount: 0,
        restoredItems: [],
        warnings: [],
        errors: [
          {
            code: 'MISSING_ORIGINAL_REFERENCE',
            message: 'Original transaction reference is required for reversal',
          },
        ],
        billingState: BillingState.FAILED,
        operationReference,
        auditEntries,
      };
    }

    const exec = async (em: EntityManager): Promise<BillingReversalResult> => {
      // Find original transaction
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
            {
              code: 'ORIGINAL_TRANSACTION_NOT_FOUND',
              message: `Transaction ${context.originalTransactionReference} not found`,
            },
          ],
          billingState: BillingState.FAILED,
          operationReference,
          auditEntries,
        };
      }

      const refundAmount = Number(originalTransaction.amount);

      // Calculate insurance refund split
      const insuranceRefundAmount = context.isInsuranceClaim && context.insuranceCoverage
        ? refundAmount * (context.insuranceCoverage.coveragePercentage / 100)
        : 0;
      const patientRefundAmount = refundAmount - insuranceRefundAmount;

      // Create reversal transaction
      const reversalTransaction = em.create(BillingTransaction, {
        transactionReference: operationReference,
        transactionType: 'DISPENSE_REVERSAL',
        billId: originalTransaction.billId,
        amount: -refundAmount,
        balanceBefore: Number(originalTransaction.balanceAfter),
        balanceAfter: Number(originalTransaction.balanceAfter) - refundAmount,
        status: 'COMPLETED',
        transactionDate: new Date(),
        processedBy: context.initiatedBy,
        description: `Reversal of dispense: ${context.item.name} x${context.quantity}`,
        notes: context.reason || 'Dispense reversal',
        metadata: {
          operationReference,
          originalTransactionReference: context.originalTransactionReference,
          refundAmount,
          insuranceRefundAmount,
          patientRefundAmount,
          itemId: context.item.id,
        },
      });
      const savedReversal = await em.save(BillingTransaction, reversalTransaction);

      // Update bill totals if bill exists
      if (originalTransaction.billId) {
        const bill = await em.findOne(PatientBill, {
          where: { id: originalTransaction.billId },
        });
        if (bill) {
          bill.subtotal = Math.max(0, Number(bill.subtotal) - refundAmount);
          bill.total = Math.max(0, Number(bill.total) - patientRefundAmount);

          // Set bill status based on remaining balance
          if (Number(bill.total) <= 0) {
            bill.status = BillStatus.REFUNDED;
          }

          await em.save(PatientBill, bill);
        }
      }

      // Mark original transaction as reversed
      originalTransaction.status = 'REVERSED';
      originalTransaction.metadata = {
        ...originalTransaction.metadata,
        reversalReference: operationReference,
        reversedAt: new Date().toISOString(),
        reversedBy: context.initiatedBy,
      };
      await em.save(BillingTransaction, originalTransaction);

      // Audit
      auditEntries.push({
        action: `Dispense reversal: ${context.item.name} x${context.quantity}, refund: ${refundAmount}`,
        resourceType: 'BillingTransaction',
        resourceId: savedReversal.id,
        userId: context.initiatedBy,
        workspaceId: context.workspaceId,
        timestamp: new Date(),
        previousState: { status: 'COMPLETED', amount: originalTransaction.amount },
        newState: { status: 'REVERSED', refundAmount },
      });

      return {
        success: true,
        reversalTransaction: savedReversal,
        refundAmount,
        insuranceRefundAmount,
        patientRefundAmount,
        restoredItems: [
          {
            itemId: context.item.id,
            quantity: context.quantity,
            batchId: context.batch?.id,
          },
        ],
        warnings,
        errors: [],
        billingState: BillingState.REVERSED,
        operationReference,
        auditEntries,
        metadata: {
          originalTransactionReference: context.originalTransactionReference,
        },
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
        this.logger.warn('Failed to persist audit entries for dispense reversal');
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Dispense reversal failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return {
        success: false,
        reversalTransaction: {},
        refundAmount: 0,
        restoredItems: [],
        warnings: [],
        errors: [
          {
            code: 'DISPENSE_REVERSAL_FAILED',
            message: (error as Error).message,
          },
        ],
        billingState: BillingState.FAILED,
        operationReference,
        auditEntries,
      };
    }
  }

  /**
   * Validate a dispense billing context without executing.
   */
  async validateBilling(context: MovementBillingContext): Promise<ValidationResult> {
    const errors: BillingError[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!context.patientId) {
      errors.push({ code: 'MISSING_PATIENT', message: 'Patient ID is required' });
    }
    if (!context.appointmentId) {
      errors.push({ code: 'MISSING_APPOINTMENT', message: 'Appointment ID is required' });
    }
    if (!context.workspaceId) {
      errors.push({ code: 'MISSING_WORKSPACE', message: 'Workspace ID is required' });
    }
    if (!context.item) {
      errors.push({ code: 'MISSING_ITEM', message: 'Dispensed item is required' });
    }
    if (!context.quantity || context.quantity <= 0) {
      errors.push({ code: 'INVALID_QUANTITY', message: 'Quantity must be greater than zero' });
    }

    // Stock validation
    if (context.billingRules?.validateStockAvailability && context.batch) {
      if (
        context.batch.availableQuantity !== undefined &&
        context.batch.availableQuantity < context.quantity
      ) {
        errors.push({
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock in batch ${context.batch.batchNumber}. Available: ${context.batch.availableQuantity}, Requested: ${context.quantity}`,
          field: 'batch.availableQuantity',
        });
      }
    }

    // Batch validation
    if (context.billingRules?.requireBatchLinking && !context.batch) {
      errors.push({
        code: 'BATCH_REQUIRED',
        message: 'Batch linking is required by billing rules but no batch was provided',
      });
    }

    // Batch expiry validation
    if (context.batch?.expiryDate) {
      const expiryDate = new Date(context.batch.expiryDate);
      if (expiryDate < new Date()) {
        errors.push({
          code: 'EXPIRED_BATCH',
          message: `Batch ${context.batch.batchNumber} expired on ${expiryDate.toISOString()}`,
          field: 'batch.expiryDate',
        });
      }
    }

    // Pricing validation
    const unitPrice = this.resolveUnitPrice(context);
    if (unitPrice <= 0) {
      warnings.push('Unit price is zero or negative; the item may be billed at no charge');
    }

    // Insurance validation
    if (context.isInsuranceClaim && !context.insuranceCoverage) {
      warnings.push('Insurance claim flagged but no coverage details provided');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Produce a cost estimate for a dispense operation.
   */
  async estimateBilling(context: MovementBillingContext): Promise<BillingEstimate> {
    const unitPrice = this.resolveUnitPrice(context);
    const subtotal = unitPrice * context.quantity;
    const discountAmount = 0; // Discount calculation deferred to service layer
    const taxAmount = 0; // Tax calculation deferred to service layer
    const totalAmount = subtotal - discountAmount + taxAmount;

    const { insuranceCoveredAmount, patientResponsibility } =
      this.calculateInsuranceSplit(totalAmount, context);

    const requiresApproval = totalAmount >= HIGH_VALUE_THRESHOLD;

    return {
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      insuranceCoverage: insuranceCoveredAmount,
      patientResponsibility,
      requiresApproval,
      approvalReason: requiresApproval
        ? `Total amount (${totalAmount}) exceeds high-value threshold (${HIGH_VALUE_THRESHOLD})`
        : undefined,
      metadata: {
        unitPrice,
        quantity: context.quantity,
        itemCode: context.item?.code,
      },
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * Resolve the unit selling price from context, item, or batch.
   */
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

  /**
   * Calculate the insurance vs patient split for a given total.
   */
  private calculateInsuranceSplit(
    total: number,
    context: MovementBillingContext,
  ): { insuranceCoveredAmount: number; patientResponsibility: number } {
    if (!context.isInsuranceClaim || !context.insuranceCoverage) {
      return { insuranceCoveredAmount: 0, patientResponsibility: total };
    }

    const coverageRate = context.insuranceCoverage.coveragePercentage / 100;
    let insuranceCoveredAmount = total * coverageRate;

    // Enforce max claim amount
    if (
      context.insuranceCoverage.maxClaimAmount &&
      insuranceCoveredAmount > context.insuranceCoverage.maxClaimAmount
    ) {
      insuranceCoveredAmount = context.insuranceCoverage.maxClaimAmount;
    }

    const patientResponsibility = total - insuranceCoveredAmount;

    return {
      insuranceCoveredAmount: Math.round(insuranceCoveredAmount * 100) / 100,
      patientResponsibility: Math.round(patientResponsibility * 100) / 100,
    };
  }

  /**
   * Detect duplicate dispense billing using a composite key
   * (appointmentId + itemId + batchId + movementType).
   */
  private async checkDuplicate(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<boolean> {
    const em = manager || this.dataSource.manager;

    const existing = await em
      .createQueryBuilder(BillingTransaction, 'bt')
      .where('bt.transactionType = :type', { type: 'DISPENSE' })
      .andWhere('bt.status != :status', { status: 'REVERSED' })
      .andWhere(`JSON_EXTRACT(bt.metadata, '$.itemId') = :itemId`, {
        itemId: context.item.id,
      })
      .andWhere(`JSON_EXTRACT(bt.metadata, '$.movementType') = :movementType`, {
        movementType: context.movementType,
      })
      .andWhere('bt.billId IN (SELECT id FROM patient_bills WHERE appointmentId = :appointmentId)', {
        appointmentId: context.appointmentId,
      })
      .getCount();

    return existing > 0;
  }

  /**
   * Find an existing PatientBill for the appointment or create a new one.
   */
  private async resolveOrCreateBill(
    context: MovementBillingContext,
    em: EntityManager,
  ): Promise<PatientBill> {
    // Use existing bill if provided
    if (context.existingBill) {
      return context.existingBill;
    }

    if (context.existingBillId) {
      const existing = await em.findOne(PatientBill, {
        where: { id: context.existingBillId },
      });
      if (existing) {
        return existing;
      }
    }

    // Look for an existing bill for this appointment
    const existingBill = await em.findOne(PatientBill, {
      where: { appointmentId: context.appointmentId },
    });
    if (existingBill) {
      return existingBill;
    }

    // Create new bill
    const billNumber = this.generateBillNumber();
    const newBill = em.create(PatientBill, {
      billNumber,
      patientId: context.patientId,
      appointmentId: context.appointmentId,
      department: context.department,
      subtotal: 0,
      total: 0,
      discountAmount: 0,
      taxAmount: 0,
      status: BillStatus.PENDING,
      issuedAt: new Date(),
      metadata: {
        createdByStrategy: this.strategyName,
        workspaceId: context.workspaceId,
      },
    });

    return em.save(PatientBill, newBill);
  }

  /**
   * Persist audit entries via the AuditLogService (fire-and-forget).
   */
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
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            newState: entry.newState,
            metadata: entry.metadata,
          },
          context.workspaceId,
        );
      } catch {
        this.logger.warn(`Failed to persist audit entry: ${entry.action}`);
      }
    }
  }

  /**
   * Build a standardised failed BillingResult.
   */
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

  /**
   * Generate a unique operation reference.
   */
  private generateReference(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Generate a unique bill number.
   */
  private generateBillNumber(): string {
    const date = new Date();
    const datePart = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `BILL-${datePart}-${random}`;
  }
}
