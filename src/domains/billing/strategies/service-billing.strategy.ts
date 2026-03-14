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

// ─── Service Category Configuration ────────────────────────────────────────────

/**
 * Maximum number of billable service events per day, keyed by category.
 * A value of `Infinity` indicates no limit.
 */
const SERVICE_CATEGORY_LIMITS: Record<string, number> = {
  CONSULTATION: 5,
  PROCEDURE: 10,
  DIAGNOSTIC: 20,
  THERAPY: 3,
  EMERGENCY: Infinity,
};

/** Default limit when the category is unknown. */
const DEFAULT_CATEGORY_LIMIT = 10;

/** Provider professional fee as a fraction of the base service price. */
const PROVIDER_FEE_RATE = 0.20;

/**
 * Default insurance coverage rates per service category (0-100).
 * Used when no explicit coverage details are provided.
 */
const INSURANCE_COVERAGE_RATES: Record<string, number> = {
  CONSULTATION: 80,
  PROCEDURE: 70,
  DIAGNOSTIC: 90,
  THERAPY: 60,
  EMERGENCY: 100,
};

/**
 * Service Billing Strategy
 *
 * Handles billing for clinical services such as consultations, procedures,
 * diagnostics, therapy sessions, and emergency services.
 *
 * Features:
 * - Per-category daily billing limits
 * - Automatic provider professional fee calculation (20% of base price)
 * - Category-aware insurance coverage rates
 * - Duplicate service detection within the same appointment
 * - Full reversal with refund transaction generation
 */
@Injectable()
export class ServiceBillingStrategy implements BillingStrategy {
  readonly strategyName = 'ServiceBillingStrategy';
  readonly priority = StrategyPriority.MEDIUM;

  private readonly context = ServiceBillingStrategy.name;

  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext(this.context);
  }

  // ─── BillingStrategy interface ─────────────────────────────────────────

  /**
   * Returns true for SERVICE movement type.
   */
  supports(movementType: MovementType, _context?: BillingContext): boolean {
    return movementType === MovementType.SERVICE;
  }

  /**
   * Process a service billing operation.
   *
   * 1. Validate context and daily limits
   * 2. Calculate service price + provider fee
   * 3. Apply insurance coverage
   * 4. Create or reuse a PatientBill
   * 5. Create a BillItem and BillingTransaction
   * 6. Emit audit trail
   */
  async processBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingResult> {
    const operationReference = this.generateReference('SVC');
    const auditEntries: AuditEntry[] = [];
    const warnings: string[] = [];
    const errors: BillingError[] = [];

    this.logger.log(`Processing service billing: ${operationReference}`);

    // Pre-flight validation
    const validation = await this.validateBilling(context);
    if (!validation.isValid) {
      return this.buildFailedResult(operationReference, validation.errors, auditEntries);
    }
    warnings.push(...validation.warnings);

    // Duplicate detection
    const isDuplicate = await this.checkDuplicateService(context, manager);
    if (isDuplicate) {
      errors.push({
        code: 'DUPLICATE_SERVICE',
        message: `Service "${context.item.name}" has already been billed for this appointment`,
      });
      return this.buildFailedResult(operationReference, errors, auditEntries);
    }

    // Pricing
    const category = (context.serviceCategory || 'CONSULTATION').toUpperCase();
    const basePrice = this.resolveBasePrice(context);
    const providerFee = basePrice * PROVIDER_FEE_RATE;
    const lineTotal = (basePrice + providerFee) * context.quantity;
    const { insuranceCoveredAmount, patientResponsibility } =
      this.calculateInsuranceSplit(lineTotal, context, category);

    const exec = async (em: EntityManager): Promise<BillingResult> => {
      // Resolve or create bill
      const bill = await this.resolveOrCreateBill(context, em);

      // Create BillItem
      const billItem = em.create(BillItem, {
        billId: bill.id,
        description: `Service: ${context.item.name} [${category}]`,
        quantity: context.quantity,
        unitPrice: basePrice + providerFee,
        totalPrice: lineTotal,
        department: context.department,
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
          serviceCategory: category,
          basePrice,
          providerFee,
          providerId: context.providerId,
          itemCode: context.item.code,
          ...(context.movementMetadata || {}),
        },
      });
      const savedBillItem = await em.save(BillItem, billItem);

      // Update bill totals
      bill.subtotal = Number(bill.subtotal) + lineTotal;
      bill.total = Number(bill.total) + patientResponsibility;
      await em.save(PatientBill, bill);

      // Create BillingTransaction
      const transaction = em.create(BillingTransaction, {
        transactionReference: operationReference,
        transactionType: 'SERVICE',
        billId: bill.id,
        amount: lineTotal,
        balanceBefore: Number(bill.subtotal) - lineTotal,
        balanceAfter: Number(bill.subtotal),
        status: 'COMPLETED',
        transactionDate: new Date(),
        processedBy: context.initiatedBy,
        description: `Service billing: ${context.item.name} [${category}] x${context.quantity}`,
        notes: context.reason,
        metadata: {
          operationReference,
          movementType: context.movementType,
          serviceCategory: category,
          basePrice,
          providerFee,
          providerId: context.providerId,
          itemId: context.item.id,
          insuranceCoveredAmount,
          patientResponsibility,
        },
      });
      const savedTransaction = await em.save(BillingTransaction, transaction);

      // Audit
      auditEntries.push({
        action: `Service billing created: ${context.item.name} [${category}] x${context.quantity}`,
        resourceType: 'BillingTransaction',
        resourceId: savedTransaction.id,
        userId: context.initiatedBy,
        workspaceId: context.workspaceId,
        timestamp: new Date(),
        newState: {
          transactionReference: operationReference,
          amount: lineTotal,
          serviceCategory: category,
          providerId: context.providerId,
        },
      });

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
        billingState: BillingState.COMPLETED,
        operationReference,
        auditEntries,
        metadata: {
          serviceCategory: category,
          basePrice,
          providerFee,
          providerId: context.providerId,
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
        this.logger.warn('Failed to persist audit entries for service billing');
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Service billing failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return this.buildFailedResult(
        operationReference,
        [
          {
            code: 'SERVICE_BILLING_FAILED',
            message: (error as Error).message,
            details: { stack: (error as Error).stack },
          },
        ],
        auditEntries,
      );
    }
  }

  /**
   * Reverse a previously processed service billing.
   */
  async reverseBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingReversalResult> {
    const operationReference = this.generateReference('SVC-REV');
    const auditEntries: AuditEntry[] = [];

    this.logger.log(
      `Reversing service billing: ${operationReference}, original ref: ${context.originalTransactionReference}`,
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
      const insuranceRefundAmount = context.isInsuranceClaim && context.insuranceCoverage
        ? refundAmount * (context.insuranceCoverage.coveragePercentage / 100)
        : 0;
      const patientRefundAmount = refundAmount - insuranceRefundAmount;

      // Create reversal
      const reversalTransaction = em.create(BillingTransaction, {
        transactionReference: operationReference,
        transactionType: 'SERVICE_REVERSAL',
        billId: originalTransaction.billId,
        amount: -refundAmount,
        balanceBefore: Number(originalTransaction.balanceAfter),
        balanceAfter: Number(originalTransaction.balanceAfter) - refundAmount,
        status: 'COMPLETED',
        transactionDate: new Date(),
        processedBy: context.initiatedBy,
        description: `Reversal of service: ${context.item.name}`,
        notes: context.reason || 'Service reversal',
        metadata: {
          operationReference,
          originalTransactionReference: context.originalTransactionReference,
          refundAmount,
          insuranceRefundAmount,
          patientRefundAmount,
        },
      });
      const savedReversal = await em.save(BillingTransaction, reversalTransaction);

      // Update bill
      if (originalTransaction.billId) {
        const bill = await em.findOne(PatientBill, {
          where: { id: originalTransaction.billId },
        });
        if (bill) {
          bill.subtotal = Math.max(0, Number(bill.subtotal) - refundAmount);
          bill.total = Math.max(0, Number(bill.total) - patientRefundAmount);
          if (Number(bill.total) <= 0) {
            bill.status = BillStatus.REFUNDED;
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
        reversedBy: context.initiatedBy,
      };
      await em.save(BillingTransaction, originalTransaction);

      auditEntries.push({
        action: `Service reversal: ${context.item.name}, refund: ${refundAmount}`,
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
        restoredItems: [],
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
        this.logger.warn('Failed to persist audit entries for service reversal');
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Service reversal failed: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return {
        success: false,
        reversalTransaction: {},
        refundAmount: 0,
        restoredItems: [],
        warnings: [],
        errors: [{ code: 'SERVICE_REVERSAL_FAILED', message: (error as Error).message }],
        billingState: BillingState.FAILED,
        operationReference,
        auditEntries,
      };
    }
  }

  /**
   * Validate a service billing context.
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
      errors.push({ code: 'MISSING_SERVICE_ITEM', message: 'Service item is required' });
    }
    if (!context.quantity || context.quantity <= 0) {
      errors.push({ code: 'INVALID_QUANTITY', message: 'Quantity must be greater than zero' });
    }

    // Category daily limit check
    const category = (context.serviceCategory || 'CONSULTATION').toUpperCase();
    const maxPerDay = SERVICE_CATEGORY_LIMITS[category] ?? DEFAULT_CATEGORY_LIMIT;

    if (maxPerDay !== Infinity) {
      const todayCount = await this.getTodayServiceCount(context, category);
      if (todayCount >= maxPerDay) {
        errors.push({
          code: 'DAILY_LIMIT_EXCEEDED',
          message: `Daily limit for ${category} services reached (${maxPerDay} per day). Current count: ${todayCount}`,
          field: 'serviceCategory',
        });
      } else if (todayCount >= maxPerDay - 1) {
        warnings.push(
          `Approaching daily limit for ${category} services (${todayCount + 1}/${maxPerDay})`,
        );
      }
    }

    // Pricing check
    const basePrice = this.resolveBasePrice(context);
    if (basePrice <= 0) {
      warnings.push('Base service price is zero or negative; the service may be billed at no charge');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Produce a cost estimate for a service billing operation.
   */
  async estimateBilling(context: MovementBillingContext): Promise<BillingEstimate> {
    const category = (context.serviceCategory || 'CONSULTATION').toUpperCase();
    const basePrice = this.resolveBasePrice(context);
    const providerFee = basePrice * PROVIDER_FEE_RATE;
    const subtotal = (basePrice + providerFee) * context.quantity;
    const discountAmount = 0;
    const taxAmount = 0;
    const totalAmount = subtotal - discountAmount + taxAmount;

    const { insuranceCoveredAmount, patientResponsibility } =
      this.calculateInsuranceSplit(totalAmount, context, category);

    return {
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      insuranceCoverage: insuranceCoveredAmount,
      patientResponsibility,
      requiresApproval: false,
      metadata: {
        serviceCategory: category,
        basePrice,
        providerFee,
        quantity: context.quantity,
      },
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * Resolve the base service price.
   */
  private resolveBasePrice(context: MovementBillingContext): number {
    if (context.unitPrice !== undefined && context.unitPrice !== null) {
      return context.unitPrice;
    }
    if (context.item?.sellingPrice !== undefined && context.item.sellingPrice !== null) {
      return context.item.sellingPrice;
    }
    return 0;
  }

  /**
   * Calculate insurance vs patient split.
   * Falls back to default category-based rates when no explicit coverage is provided.
   */
  private calculateInsuranceSplit(
    total: number,
    context: MovementBillingContext,
    category: string,
  ): { insuranceCoveredAmount: number; patientResponsibility: number } {
    if (!context.isInsuranceClaim) {
      return { insuranceCoveredAmount: 0, patientResponsibility: total };
    }

    let coverageRate: number;

    if (context.insuranceCoverage) {
      coverageRate = context.insuranceCoverage.coveragePercentage / 100;
    } else {
      // Fall back to default category rate
      const defaultRate = INSURANCE_COVERAGE_RATES[category] ?? 70;
      coverageRate = defaultRate / 100;
    }

    let insuranceCoveredAmount = total * coverageRate;

    if (
      context.insuranceCoverage?.maxClaimAmount &&
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
   * Count how many services of a given category have been billed today
   * for the same patient.
   */
  private async getTodayServiceCount(
    context: MovementBillingContext,
    category: string,
  ): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    try {
      const count = await this.dataSource
        .createQueryBuilder(BillingTransaction, 'bt')
        .innerJoin(PatientBill, 'pb', 'bt.billId = pb.id')
        .where('bt.transactionType = :type', { type: 'SERVICE' })
        .andWhere('bt.status != :status', { status: 'REVERSED' })
        .andWhere('pb.patientId = :patientId', { patientId: context.patientId })
        .andWhere('bt.transactionDate >= :today', { today })
        .andWhere('bt.transactionDate < :tomorrow', { tomorrow })
        .andWhere(`JSON_EXTRACT(bt.metadata, '$.serviceCategory') = :category`, { category })
        .getCount();

      return count;
    } catch {
      // If query fails (e.g. tables not yet created), return 0 to avoid blocking
      this.logger.warn('Could not query today service count; defaulting to 0');
      return 0;
    }
  }

  /**
   * Detect duplicate service billing for the same appointment and item.
   */
  private async checkDuplicateService(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<boolean> {
    const em = manager || this.dataSource.manager;

    try {
      const existing = await em
        .createQueryBuilder(BillingTransaction, 'bt')
        .where('bt.transactionType = :type', { type: 'SERVICE' })
        .andWhere('bt.status != :status', { status: 'REVERSED' })
        .andWhere(`JSON_EXTRACT(bt.metadata, '$.itemId') = :itemId`, {
          itemId: context.item.id,
        })
        .andWhere('bt.billId IN (SELECT id FROM patient_bills WHERE appointmentId = :appointmentId)', {
          appointmentId: context.appointmentId,
        })
        .getCount();

      return existing > 0;
    } catch {
      return false;
    }
  }

  /**
   * Find an existing PatientBill for the appointment or create one.
   */
  private async resolveOrCreateBill(
    context: MovementBillingContext,
    em: EntityManager,
  ): Promise<PatientBill> {
    if (context.existingBill) {
      return context.existingBill;
    }

    if (context.existingBillId) {
      const existing = await em.findOne(PatientBill, {
        where: { id: context.existingBillId },
      });
      if (existing) return existing;
    }

    const existingBill = await em.findOne(PatientBill, {
      where: { appointmentId: context.appointmentId },
    });
    if (existingBill) return existingBill;

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
   * Persist audit entries via AuditLogService (fire-and-forget).
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

  private generateBillNumber(): string {
    const date = new Date();
    const datePart = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `BILL-${datePart}-${random}`;
  }
}
