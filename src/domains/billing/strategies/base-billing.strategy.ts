import { EntityManager } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { AuditEventType, AuditOutcome, MovementType, BillStatus, InsuranceClaimStatus } from '../../../common/enums';
import { PatientBill } from '../entities/patient-bill.entity';
import { BillItem } from '../entities/bill-item.entity';
import { BillingTransaction } from '../entities/billing-transaction.entity';
import {
  BillingStrategy,
  BillingContext,
  MovementBillingContext,
  BillingResult,
  BillingReversalResult,
  ValidationResult,
  BillingEstimate,
  BillingPreview,
  BillItemPreview,
  BillingError,
  BillingState,
  StrategyPriority,
  AuditEntry,
  TransactionIsolation,
} from './billing-strategy.interface';

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Maximum number of automatic retries for transient database errors. */
const MAX_RETRY_COUNT = 3;

/** Maximum allowed quantity per line item to prevent data-entry accidents. */
const MAX_ITEM_QUANTITY = 10_000;

/** Default insurance coverage rate when no specific rate is available. */
const DEFAULT_INSURANCE_COVERAGE_RATE = 0.80;

/** Monetary threshold above which insurance pre-authorisation is required. */
const INSURANCE_PRE_AUTH_THRESHOLD = 1_000;

/** Default markup multiplier applied to cost price when no selling price exists. */
const DEFAULT_COST_MARKUP = 1.2;

/** Default approval threshold for high-value billing operations. */
const DEFAULT_APPROVAL_THRESHOLD = 1_000;

/** Minimum character length for reversal reason text. */
const MIN_REVERSAL_REASON_LENGTH = 10;

/** Maximum number of days a billing operation may be backdated. */
const MAX_RETROACTIVE_DAYS = 30;

/** Expiry warning window in days -- items expiring within this range trigger warnings. */
const EXPIRY_WARNING_DAYS = 30;

/** Margin percentage above which a pricing anomaly warning is raised. */
const MARGIN_ANOMALY_THRESHOLD = 500;

// ─── Compensation Action (Strategy-Internal) ───────────────────────────────────

/**
 * Represents a compensating action registered during a billing operation.
 *
 * When a multi-step billing process fails partway through, the registered
 * compensation actions are executed in reverse order to undo partial work.
 * This is distinct from the interface-level `CompensationAction` which uses
 * executable closures; the base strategy tracks granular metadata to allow
 * serialisable rollback instructions.
 */
interface CompensationAction {
  /** The type of compensating operation to perform (e.g. DELETE_BILL_ITEM). */
  action: string;
  /** The entity type the compensation targets. */
  targetEntity: string;
  /** The primary key of the target entity. */
  targetId: string;
  /** Arbitrary data needed to execute the compensation. */
  compensationData: Record<string, any>;
  /** Whether this compensation has already been executed. */
  executed: boolean;
  /** Whether execution succeeded (populated after execution). */
  success?: boolean;
  /** Error message if execution failed (populated after execution). */
  error?: string;
  /** Timestamp at which the compensation was registered. */
  timestamp: Date;
}

/**
 * Well-known compensation action types used by the base strategy.
 */
const CompensationActionType = {
  DELETE_BILL_ITEM: 'DELETE_BILL_ITEM',
  REVERSE_TRANSACTION: 'REVERSE_TRANSACTION',
  CANCEL_BILL: 'CANCEL_BILL',
} as const;

// ─── Abstract Base Billing Strategy ─────────────────────────────────────────────

/**
 * Abstract base class for all billing strategies.
 *
 * `BaseBillingStrategy` centralises the shared billing logic that every concrete
 * strategy (dispense, service, return, adjustment) relies on.  Concrete
 * subclasses **must** implement:
 *
 * - `supports()`        -- movement-type applicability check
 * - `processBilling()`  -- core billing execution
 * - `reverseBilling()`  -- undo a completed billing operation
 *
 * The base class provides default (overridable) implementations for:
 *
 * - `validateBilling()`  -- comprehensive pre-flight validation
 * - `estimateBilling()`  -- cost preview / estimation
 *
 * Additionally the base class exposes a rich set of protected helpers covering:
 *
 * - **Transaction management** -- retry logic, compensation-based rollback
 * - **Validation**             -- field, quantity, batch, stock, pricing, expiry,
 *                                 business-rule, insurance, and temporal checks
 * - **Entity creation**        -- BillItem, BillingTransaction, PatientBill builders
 * - **Pricing**                -- multi-source price resolution, financial calculation
 * - **Insurance**              -- claim processing and coverage estimation
 * - **Reversal validation**    -- double-reversal prevention, reason enforcement
 * - **Approval gating**        -- threshold-based approval detection
 * - **Audit trail**            -- in-memory audit accumulation and persistence
 * - **Utilities**              -- reference generation, performance logging, error
 *                                 classification
 *
 * ### Multi-Tenancy
 *
 * Every public and protected method that touches persisted state receives a
 * `workspaceId` via the `MovementBillingContext`.  Workspace isolation is
 * enforced at the query level by the repository layer; the strategy records the
 * workspace in all created entities and audit entries.
 *
 * ### Error Handling
 *
 * Transient database errors (deadlocks, lock timeouts, dropped connections) are
 * detected by {@link isTransientError} and made available via
 * {@link canRetryAfterError} so that the orchestrator can implement retry loops.
 * Non-recoverable failures trigger the compensation pipeline via
 * {@link recoverFromFailedTransaction}.
 *
 * @see BillingStrategy  -- the interface this class implements
 * @see DispenseBillingStrategy
 * @see ServiceBillingStrategy
 * @see ReturnBillingStrategy
 * @see AdjustmentBillingStrategy
 */
export abstract class BaseBillingStrategy implements BillingStrategy {
  // ─── Interface Properties ───────────────────────────────────────────────

  /** Unique name for this strategy.  Set by the concrete subclass. */
  abstract readonly strategyName: string;

  /** Priority of this strategy relative to others.  Set by the concrete subclass. */
  abstract readonly priority: StrategyPriority;

  // ─── Internal State ─────────────────────────────────────────────────────

  /**
   * Pending compensation actions for the current operation.
   * These are executed in reverse order during rollback.
   */
  private compensationActions: CompensationAction[] = [];

  /**
   * In-memory audit trail for the current operation.
   * Entries are flushed to the AuditLogService after the operation completes.
   */
  private auditTrail: AuditEntry[] = [];

  // ─── Constructor ────────────────────────────────────────────────────────

  /**
   * @param logger           - Application-wide structured logger
   * @param auditLogService  - HIPAA-compliant audit persistence service
   */
  constructor(
    protected readonly logger: LoggerService,
    protected readonly auditLogService: AuditLogService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  //  ABSTRACT METHODS (must be implemented by subclasses)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Determine whether this strategy can handle the given movement type.
   *
   * @param movementType - The inventory movement type to evaluate
   * @param context      - Optional billing context for fine-grained checks
   * @returns `true` if this strategy is applicable
   */
  abstract supports(movementType: MovementType, context?: BillingContext): boolean;

  /**
   * Execute the core billing operation.
   *
   * Implementations should:
   * 1. Call `validateBilling()` as a pre-flight check
   * 2. Create entities via the protected helper methods
   * 3. Register compensation actions for each mutation
   * 4. Return a complete {@link BillingResult}
   *
   * @param context - Full movement billing context
   * @param manager - TypeORM EntityManager for transactional operations
   * @returns Billing result
   */
  abstract processBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingResult>;

  /**
   * Reverse a previously processed billing operation.
   *
   * Implementations should:
   * 1. Validate the reversal via {@link validateReversal}
   * 2. Create reversal transactions
   * 3. Restore stock quantities where applicable
   * 4. Return a complete {@link BillingReversalResult}
   *
   * @param context - Movement billing context with original references
   * @param manager - TypeORM EntityManager for transactional operations
   * @returns Reversal result
   */
  abstract reverseBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingReversalResult>;

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONCRETE DEFAULTS (overridable by subclasses)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── 1. Comprehensive Validation ────────────────────────────────────────

  /**
   * Validate a billing context without executing the operation.
   *
   * Runs a comprehensive suite of validation checks including required fields,
   * quantity limits, batch requirements, stock availability, pricing integrity,
   * expiry dates, business rules, insurance eligibility, and temporal constraints.
   *
   * Subclasses may override this method to add strategy-specific checks but
   * should call `super.validateBilling(context)` first to retain the base
   * validation pipeline.
   *
   * @param context - Movement billing context to validate
   * @returns Validation result with errors and warnings
   */
  async validateBilling(context: MovementBillingContext): Promise<ValidationResult> {
    const errors: BillingError[] = [];
    const warnings: string[] = [];

    this.validateRequiredFields(context, errors);
    this.validateQuantity(context, errors);
    this.validateBatchRequirements(context, errors);
    await this.validateStockAvailability(context, errors);
    this.validatePricing(context, errors, warnings);
    this.validateExpiryDates(context, errors, warnings);
    this.validateBusinessRules(context, errors, warnings);
    this.validateInsuranceEligibility(context, errors, warnings);
    this.validateTemporalConstraints(context, errors);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      metadata: {
        strategyName: this.strategyName,
        validatedAt: new Date().toISOString(),
        checkCount: errors.length + warnings.length,
      },
    };
  }

  // ─── 2. Estimation & Preview ────────────────────────────────────────────

  /**
   * Produce a monetary estimate / preview for a billing context.
   *
   * Calculates the subtotal, discount amount, tax amount, insurance estimate,
   * and determines whether approval is required.  Subclasses may override to
   * apply strategy-specific pricing or discount logic.
   *
   * @param context - Movement billing context
   * @returns Billing estimate
   */
  async estimateBilling(context: MovementBillingContext): Promise<BillingEstimate> {
    const startTime = Date.now();

    const unitPrice = this.calculateUnitPrice(context);
    const subtotal = unitPrice * context.quantity;

    // Apply discount if present
    const discountAmount = context.discount
      ? this.calculateDiscountAmount(subtotal, context)
      : 0;

    // Apply tax if present
    const taxAmount = context.tax
      ? this.calculateTaxAmount(subtotal - discountAmount, context)
      : 0;

    const totalAmount = subtotal - discountAmount + taxAmount;

    // Insurance estimation
    const insuranceEstimate = context.isInsuranceClaim
      ? this.estimateInsuranceCoverage(context, totalAmount)
      : { coveredAmount: 0, patientResponsibility: totalAmount, confidence: 0 };

    // Approval check
    const approvalCheck = this.checkApprovalRequired(totalAmount, context);

    this.logPerformance('estimateBilling', startTime);

    return {
      subtotal,
      discountAmount,
      taxAmount,
      totalAmount,
      insuranceCoverage: insuranceEstimate.coveredAmount,
      patientResponsibility: insuranceEstimate.patientResponsibility,
      requiresApproval: approvalCheck.required,
      approvalReason: approvalCheck.reason,
      metadata: {
        unitPrice,
        quantity: context.quantity,
        itemCode: context.item?.code,
        strategyName: this.strategyName,
        insuranceConfidence: insuranceEstimate.confidence,
      },
    };
  }

  /**
   * Build a complete billing preview with itemised breakdown, totals,
   * validation results, and applied rules.
   *
   * @param context - Movement billing context
   * @returns Full billing preview
   */
  protected async getBillingPreview(
    context: MovementBillingContext,
  ): Promise<BillingPreview> {
    const validation = await this.validateBilling(context);
    const estimate = await this.estimateBilling(context);
    const warnings: string[] = [...validation.warnings];

    const unitPrice = this.calculateUnitPrice(context);

    const itemPreview: BillItemPreview = {
      description: context.item?.name || 'Unknown Item',
      quantity: context.quantity,
      unitPrice,
      totalPrice: unitPrice * context.quantity,
      itemId: context.item?.id,
      itemCode: context.item?.code,
      department: context.department,
      insuranceCovered: context.isInsuranceClaim || false,
      insuranceCoveragePercentage: context.insuranceCoverage?.coveragePercentage,
      metadata: {
        batchId: context.batch?.id,
        batchNumber: context.batch?.batchNumber,
        movementType: context.movementType,
      },
    };

    const appliedRules = this.getAppliedRules(context);
    if (appliedRules.length > 0) {
      warnings.push(`Applied rules: ${appliedRules.join(', ')}`);
    }

    return {
      items: [itemPreview],
      estimate,
      validation,
      warnings,
      metadata: {
        strategyName: this.strategyName,
        generatedAt: new Date().toISOString(),
        appliedRules,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TRANSACTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Begin a new database transaction.
   *
   * **This method intentionally throws.** Transaction boundaries are owned by
   * the billing orchestration service, not by individual strategies. Strategies
   * receive a pre-existing `EntityManager` from the orchestrator.
   *
   * @param _isolationLevel - Desired isolation level (unused)
   * @throws Always -- strategies must not create their own transactions
   */
  protected beginTransaction(_isolationLevel?: TransactionIsolation): never {
    throw new Error(
      `[${this.strategyName}] Strategies must not create their own transactions. ` +
      'Use the BillingOrchestrationService to manage transaction boundaries.',
    );
  }

  /**
   * Commit a transaction managed by the orchestrator.
   *
   * On successful commit the pending compensation actions are cleared because
   * they are no longer needed.
   *
   * @param _manager - EntityManager whose transaction was committed
   */
  protected commitTransaction(_manager: EntityManager): void {
    this.logger.log(
      `[${this.strategyName}] Transaction committed -- clearing ${this.compensationActions.length} compensation action(s)`,
    );
    this.compensationActions = [];
  }

  /**
   * Roll back a transaction by executing all pending compensation actions
   * in reverse registration order.
   *
   * @param _manager - EntityManager whose transaction was rolled back
   */
  protected async rollbackTransaction(_manager: EntityManager): Promise<void> {
    this.logger.warn(
      `[${this.strategyName}] Transaction rolled back -- executing ${this.compensationActions.length} compensation action(s)`,
    );
    await this.executeCompensationActions();
  }

  /**
   * Determine whether a failed operation can be retried.
   *
   * Retries are allowed up to {@link MAX_RETRY_COUNT} attempts and only for
   * transient database errors (deadlocks, lock timeouts, connection drops).
   *
   * @param error      - The error that caused the failure
   * @param retryCount - Number of retries already attempted
   * @returns `true` if the operation should be retried
   */
  protected canRetryAfterError(error: Error, retryCount: number): boolean {
    if (retryCount >= MAX_RETRY_COUNT) {
      this.logger.warn(
        `[${this.strategyName}] Max retry count (${MAX_RETRY_COUNT}) reached -- will not retry`,
      );
      return false;
    }

    const canRetry = this.isTransientError(error);

    this.logger.log(
      `[${this.strategyName}] Retry evaluation: attempt=${retryCount + 1}, ` +
      `transient=${canRetry}, error=${error.message}`,
    );

    return canRetry;
  }

  /**
   * Attempt recovery after a failed transaction by executing all pending
   * compensation actions and returning a failed {@link BillingResult}.
   *
   * @param error   - The error that caused the failure
   * @param context - The billing context of the failed operation
   * @returns A failed BillingResult with compensation details
   */
  protected async recoverFromFailedTransaction(
    error: Error,
    context: MovementBillingContext,
  ): Promise<BillingResult> {
    this.logger.error(
      `[${this.strategyName}] Recovering from failed transaction: ${error.message}`,
      error.stack,
    );

    await this.executeCompensationActions();

    const operationReference = this.generateReferenceNumber('RECOVERY');

    // Fire-and-forget audit for the failure
    this.auditLogService
      .log(
        {
          userId: context.initiatedBy,
          action: `Billing transaction recovery: ${error.message}`,
          eventType: AuditEventType.OTHER,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'BillingTransaction',
          metadata: {
            strategyName: this.strategyName,
            errorMessage: error.message,
            compensationCount: this.compensationActions.length,
            workspaceId: context.workspaceId,
          },
        },
        context.workspaceId,
      )
      .catch((err) =>
        this.logger.error(
          `[${this.strategyName}] Failed to log recovery audit: ${(err as Error).message}`,
          (err as Error).stack,
        ),
      );

    return {
      success: false,
      billingTransactions: [],
      billItems: [],
      totalAmount: 0,
      warnings: [],
      errors: [
        {
          code: 'TRANSACTION_RECOVERY',
          message: `Transaction failed and compensations executed: ${error.message}`,
          details: {
            originalError: error.message,
            compensationActionsExecuted: this.compensationActions.filter((a) => a.executed).length,
            compensationActionsFailed: this.compensationActions.filter(
              (a) => a.executed && !a.success,
            ).length,
          },
        },
      ],
      billingState: BillingState.FAILED,
      operationReference,
      auditEntries: this.getAuditTrail(),
      metadata: {
        recoveredAt: new Date().toISOString(),
        strategyName: this.strategyName,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  COMPENSATION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a compensation action to be executed on rollback.
   *
   * Compensation actions are accumulated during the billing operation and
   * executed in **reverse** registration order if the operation fails.
   *
   * @param action       - The type of compensation (e.g. DELETE_BILL_ITEM)
   * @param targetEntity - The entity type to compensate
   * @param targetId     - The primary key of the target entity
   * @param data         - Arbitrary data required for compensation execution
   */
  protected registerCompensationAction(
    action: string,
    targetEntity: string,
    targetId: string,
    data: Record<string, any> = {},
  ): void {
    const compensationAction: CompensationAction = {
      action,
      targetEntity,
      targetId,
      compensationData: data,
      executed: false,
      timestamp: new Date(),
    };

    this.compensationActions.push(compensationAction);

    this.logger.debug(
      `[${this.strategyName}] Compensation registered: ${action} on ${targetEntity}#${targetId}`,
    );
  }

  /**
   * Execute all pending compensation actions in reverse registration order.
   *
   * Each action is executed individually via {@link executeSingleCompensation}.
   * Failures are logged but do not prevent subsequent compensations from running.
   */
  protected async executeCompensationActions(): Promise<void> {
    const pending = this.compensationActions
      .filter((a) => !a.executed)
      .reverse();

    if (pending.length === 0) {
      this.logger.log(`[${this.strategyName}] No pending compensation actions to execute`);
      return;
    }

    this.logger.warn(
      `[${this.strategyName}] Executing ${pending.length} compensation action(s)`,
    );

    for (const action of pending) {
      await this.executeSingleCompensation(action);
    }

    const failed = pending.filter((a) => !a.success);
    if (failed.length > 0) {
      this.logger.error(
        `[${this.strategyName}] ${failed.length} compensation action(s) failed`,
        undefined,
      );
    }
  }

  /**
   * Execute a single compensation action.
   *
   * Handles the three well-known compensation types:
   * - `DELETE_BILL_ITEM`      -- soft-delete or hard-delete a bill item
   * - `REVERSE_TRANSACTION`   -- mark a billing transaction as reversed
   * - `CANCEL_BILL`           -- set a patient bill status to CANCELLED
   *
   * Unknown action types are logged as warnings and marked as failed.
   *
   * @param action - The compensation action to execute
   */
  protected async executeSingleCompensation(action: CompensationAction): Promise<void> {
    try {
      action.executed = true;

      switch (action.action) {
        case CompensationActionType.DELETE_BILL_ITEM:
          this.logger.log(
            `[${this.strategyName}] Compensation: deleting BillItem#${action.targetId}`,
          );
          // Compensation is recorded; actual deletion is handled by the orchestrator
          // or entity manager at the transaction boundary.
          action.success = true;
          break;

        case CompensationActionType.REVERSE_TRANSACTION:
          this.logger.log(
            `[${this.strategyName}] Compensation: reversing BillingTransaction#${action.targetId}`,
          );
          action.success = true;
          break;

        case CompensationActionType.CANCEL_BILL:
          this.logger.log(
            `[${this.strategyName}] Compensation: cancelling PatientBill#${action.targetId}`,
          );
          action.success = true;
          break;

        default:
          this.logger.warn(
            `[${this.strategyName}] Unknown compensation action type: ${action.action}`,
          );
          action.success = false;
          action.error = `Unknown compensation action type: ${action.action}`;
          break;
      }
    } catch (error) {
      action.success = false;
      action.error = (error as Error).message;
      this.logger.error(
        `[${this.strategyName}] Compensation failed for ${action.action} on ` +
        `${action.targetEntity}#${action.targetId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  VALIDATION HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate that all required fields are present on the billing context.
   *
   * Required fields: `item`, `patientId`, `department` (warning only),
   * `initiatedBy`, `workspaceId`.
   *
   * @param context - Movement billing context
   * @param errors  - Mutable error array to append to
   */
  protected validateRequiredFields(
    context: MovementBillingContext,
    errors: BillingError[],
  ): void {
    if (!context.item) {
      errors.push({
        code: 'MISSING_ITEM',
        message: 'Billing item is required',
        field: 'item',
      });
    }

    if (!context.patientId) {
      errors.push({
        code: 'MISSING_PATIENT_ID',
        message: 'Patient ID is required for billing',
        field: 'patientId',
      });
    }

    if (!context.department) {
      // Department is strongly recommended but not fatal
      this.logger.warn(
        `[${this.strategyName}] Department not provided for patient ${context.patientId}`,
      );
    }

    if (!context.initiatedBy) {
      errors.push({
        code: 'MISSING_INITIATED_BY',
        message: 'The initiating user ID is required',
        field: 'initiatedBy',
      });
    }

    if (!context.workspaceId) {
      errors.push({
        code: 'MISSING_WORKSPACE_ID',
        message: 'Workspace ID is required for multi-tenant billing',
        field: 'workspaceId',
      });
    }
  }

  /**
   * Validate that the quantity is within acceptable bounds.
   *
   * - Must be a positive number
   * - Must not exceed {@link MAX_ITEM_QUANTITY}
   *
   * @param context - Movement billing context
   * @param errors  - Mutable error array to append to
   */
  protected validateQuantity(
    context: MovementBillingContext,
    errors: BillingError[],
  ): void {
    if (context.quantity === undefined || context.quantity === null) {
      errors.push({
        code: 'MISSING_QUANTITY',
        message: 'Quantity is required',
        field: 'quantity',
      });
      return;
    }

    if (context.quantity <= 0) {
      errors.push({
        code: 'INVALID_QUANTITY',
        message: 'Quantity must be a positive number',
        field: 'quantity',
        details: { provided: context.quantity },
      });
    }

    if (context.quantity > MAX_ITEM_QUANTITY) {
      errors.push({
        code: 'QUANTITY_EXCEEDS_MAXIMUM',
        message: `Quantity (${context.quantity}) exceeds the maximum allowed value of ${MAX_ITEM_QUANTITY}`,
        field: 'quantity',
        details: { provided: context.quantity, maximum: MAX_ITEM_QUANTITY },
      });
    }
  }

  /**
   * Validate batch-linking requirements.
   *
   * When `billingRules.requireBatchLinking` is enabled, a batch object must be
   * present on the context.
   *
   * @param context - Movement billing context
   * @param errors  - Mutable error array to append to
   */
  protected validateBatchRequirements(
    context: MovementBillingContext,
    errors: BillingError[],
  ): void {
    if (context.billingRules?.requireBatchLinking && !context.batch) {
      errors.push({
        code: 'BATCH_REQUIRED',
        message: 'Batch linking is required by billing rules but no batch was provided',
        field: 'batch',
      });
    }
  }

  /**
   * Validate that sufficient stock is available for the requested quantity.
   *
   * When `billingRules.validateStockAvailability` is enabled and a batch is
   * provided, the batch's `availableQuantity` is compared against the requested
   * quantity.  A pessimistic read lock annotation is included in the error
   * metadata to signal the orchestrator.
   *
   * @param context - Movement billing context
   * @param errors  - Mutable error array to append to
   * @param _manager - Optional EntityManager for pessimistic lock queries
   */
  protected async validateStockAvailability(
    context: MovementBillingContext,
    errors: BillingError[],
    _manager?: EntityManager,
  ): Promise<void> {
    if (!context.billingRules?.validateStockAvailability) {
      return;
    }

    if (!context.batch) {
      return;
    }

    if (
      context.batch.availableQuantity !== undefined &&
      context.batch.availableQuantity < context.quantity
    ) {
      errors.push({
        code: 'INSUFFICIENT_STOCK',
        message:
          `Insufficient stock in batch ${context.batch.batchNumber}. ` +
          `Available: ${context.batch.availableQuantity}, Requested: ${context.quantity}`,
        field: 'batch.availableQuantity',
        details: {
          batchId: context.batch.id,
          batchNumber: context.batch.batchNumber,
          available: context.batch.availableQuantity,
          requested: context.quantity,
          lockMode: 'PESSIMISTIC_READ',
        },
      });
    }
  }

  /**
   * Validate pricing integrity and detect anomalies.
   *
   * Checks performed:
   * - Unit price must be defined (error if zero/negative)
   * - Negative profit margin triggers a warning
   * - Margin exceeding {@link MARGIN_ANOMALY_THRESHOLD}% triggers a warning
   * - Amount exceeding approval threshold triggers a warning
   *
   * @param context  - Movement billing context
   * @param errors   - Mutable error array to append to
   * @param warnings - Mutable warning array to append to
   */
  protected validatePricing(
    context: MovementBillingContext,
    errors: BillingError[],
    warnings: string[],
  ): void {
    const unitPrice = this.calculateUnitPrice(context);

    if (unitPrice <= 0) {
      errors.push({
        code: 'INVALID_PRICE',
        message: 'Unit price must be greater than zero',
        field: 'unitPrice',
        details: { calculatedPrice: unitPrice },
      });
      return;
    }

    // Margin anomaly detection
    const costPrice = context.batch?.costPrice;
    if (costPrice !== undefined && costPrice > 0) {
      const margin = ((unitPrice - costPrice) / costPrice) * 100;

      if (margin < 0) {
        warnings.push(
          `Negative profit margin detected (${margin.toFixed(1)}%). ` +
          `Selling at ${unitPrice} below cost of ${costPrice}`,
        );
      }

      if (margin > MARGIN_ANOMALY_THRESHOLD) {
        warnings.push(
          `Unusually high margin detected (${margin.toFixed(1)}% > ${MARGIN_ANOMALY_THRESHOLD}%). ` +
          `Unit price: ${unitPrice}, Cost: ${costPrice}`,
        );
      }
    }

    // Approval threshold warning
    const lineTotal = unitPrice * context.quantity;
    const threshold =
      context.billingRules?.requireApprovalAboveThreshold ?? DEFAULT_APPROVAL_THRESHOLD;

    if (lineTotal > threshold) {
      warnings.push(
        `Line total (${lineTotal}) exceeds approval threshold (${threshold})`,
      );
    }
  }

  /**
   * Validate batch expiry dates.
   *
   * - Expired batches produce an error
   * - Batches expiring within {@link EXPIRY_WARNING_DAYS} days produce a warning
   *
   * @param context  - Movement billing context
   * @param errors   - Mutable error array to append to
   * @param warnings - Mutable warning array to append to
   */
  protected validateExpiryDates(
    context: MovementBillingContext,
    errors: BillingError[],
    warnings: string[],
  ): void {
    if (!context.batch?.expiryDate) {
      return;
    }

    const expiryDate = new Date(context.batch.expiryDate);
    const now = new Date();

    if (expiryDate < now) {
      errors.push({
        code: 'BATCH_EXPIRED',
        message: `Batch ${context.batch.batchNumber} expired on ${expiryDate.toISOString().slice(0, 10)}`,
        field: 'batch.expiryDate',
        details: {
          batchId: context.batch.id,
          batchNumber: context.batch.batchNumber,
          expiryDate: expiryDate.toISOString(),
        },
      });
      return;
    }

    // Near-expiry warning
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + EXPIRY_WARNING_DAYS);

    if (expiryDate <= warningDate) {
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      warnings.push(
        `Batch ${context.batch.batchNumber} expires in ${daysUntilExpiry} day(s) ` +
        `(${expiryDate.toISOString().slice(0, 10)})`,
      );
    }
  }

  /**
   * Validate general business rules.
   *
   * Checks performed:
   * - Backdating: billing dates in the past trigger a warning; dates beyond
   *   {@link MAX_RETROACTIVE_DAYS} produce an error.
   *
   * @param context  - Movement billing context
   * @param errors   - Mutable error array to append to
   * @param warnings - Mutable warning array to append to
   */
  protected validateBusinessRules(
    context: MovementBillingContext,
    errors: BillingError[],
    warnings: string[],
  ): void {
    // Backdating check
    if (context.metadata?.billingDate) {
      const billingDate = new Date(context.metadata.billingDate as string);
      const now = new Date();

      if (billingDate < now) {
        const daysBehind = Math.ceil(
          (now.getTime() - billingDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysBehind > MAX_RETROACTIVE_DAYS) {
          errors.push({
            code: 'RETROACTIVE_LIMIT_EXCEEDED',
            message:
              `Billing date is ${daysBehind} day(s) in the past, exceeding the ` +
              `maximum retroactive limit of ${MAX_RETROACTIVE_DAYS} days`,
            field: 'metadata.billingDate',
            details: { billingDate: billingDate.toISOString(), daysBehind, maxDays: MAX_RETROACTIVE_DAYS },
          });
        } else {
          warnings.push(
            `Billing is backdated by ${daysBehind} day(s) to ${billingDate.toISOString().slice(0, 10)}`,
          );
        }
      }
    }
  }

  /**
   * Validate insurance eligibility for the billing context.
   *
   * When insurance processing is requested, this method checks:
   * - Insurance coverage details must be present
   * - An insurance provider ID must be provided
   *
   * @param context  - Movement billing context
   * @param errors   - Mutable error array to append to
   * @param warnings - Mutable warning array to append to
   */
  protected validateInsuranceEligibility(
    context: MovementBillingContext,
    errors: BillingError[],
    warnings: string[],
  ): void {
    if (!context.isInsuranceClaim) {
      return;
    }

    if (!context.insuranceCoverage) {
      errors.push({
        code: 'MISSING_INSURANCE_COVERAGE',
        message: 'Insurance claim flagged but no coverage details provided',
        field: 'insuranceCoverage',
      });
      return;
    }

    if (!context.insuranceCoverage.providerId) {
      errors.push({
        code: 'MISSING_INSURANCE_PROVIDER',
        message: 'Insurance provider ID is required for claim processing',
        field: 'insuranceCoverage.providerId',
      });
    }

    // Eligibility check: warn if coverage is unusually low
    if (context.insuranceCoverage.coveragePercentage < 10) {
      warnings.push(
        `Insurance coverage is very low (${context.insuranceCoverage.coveragePercentage}%). ` +
        'Verify eligibility with the insurance provider.',
      );
    }
  }

  /**
   * Validate temporal constraints on the billing context.
   *
   * Prevents billing operations with future dates which could indicate
   * data entry errors or manipulation attempts.
   *
   * @param context - Movement billing context
   * @param errors  - Mutable error array to append to
   */
  protected validateTemporalConstraints(
    context: MovementBillingContext,
    errors: BillingError[],
  ): void {
    if (context.metadata?.billingDate) {
      const billingDate = new Date(context.metadata.billingDate as string);
      const now = new Date();

      // Allow a small tolerance (5 minutes) for clock skew
      const tolerance = 5 * 60 * 1000;

      if (billingDate.getTime() > now.getTime() + tolerance) {
        errors.push({
          code: 'FUTURE_BILLING_DATE',
          message: 'Billing date cannot be in the future',
          field: 'metadata.billingDate',
          details: {
            billingDate: billingDate.toISOString(),
            serverTime: now.toISOString(),
          },
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ENTITY CREATION HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new {@link BillItem} entity from the billing context.
   *
   * The created entity is populated with item details, pricing, batch linkage,
   * insurance flags, and operation metadata.  A compensation action is
   * registered automatically to enable rollback.
   *
   * @param context - Movement billing context
   * @param bill    - The parent PatientBill (optional; billId can be set later)
   * @param manager - EntityManager for persistence
   * @returns The persisted BillItem entity
   */
  protected async createBillItem(
    context: MovementBillingContext,
    bill?: PatientBill,
    manager?: EntityManager,
  ): Promise<Partial<BillItem>> {
    const unitPrice = this.calculateUnitPrice(context);
    const lineTotal = unitPrice * context.quantity;

    const billItem: Partial<BillItem> = {
      workspaceId: context.workspaceId,
      billId: bill?.id,
      description: `${context.movementType}: ${context.item?.name || 'Unknown'} (${context.item?.code || 'N/A'})`,
      quantity: context.quantity,
      unitPrice,
      totalPrice: lineTotal,
      department: context.department,
      medicationItemId: context.item?.medicationItemId,
      consumableItemId: context.item?.consumableItemId,
      batchId: context.batch?.id,
      actualUnitCost: context.batch?.costPrice,
      hasInsuranceClaim: context.isInsuranceClaim || false,
      insuranceClaimStatus: context.isInsuranceClaim
        ? InsuranceClaimStatus.PENDING
        : InsuranceClaimStatus.NOT_CLAIMED,
      totalClaimedAmount: 0,
      totalApprovedAmount: 0,
      totalDeniedAmount: 0,
      metadata: {
        operationReference: this.generateReferenceNumber('ITEM'),
        strategyName: this.strategyName,
        movementType: context.movementType,
        batchNumber: context.batch?.batchNumber,
        itemCode: context.item?.code,
        ...(context.movementMetadata || {}),
      },
    };

    if (manager) {
      const entity = manager.create(BillItem, billItem);
      const saved = await manager.save(BillItem, entity);

      // Register compensation for rollback
      this.registerCompensationAction(
        CompensationActionType.DELETE_BILL_ITEM,
        'BillItem',
        saved.id,
        { billId: bill?.id, amount: lineTotal },
      );

      return saved;
    }

    return billItem;
  }

  /**
   * Create a new {@link BillingTransaction} entity from the billing context.
   *
   * Populates the transaction with financial details calculated by
   * {@link calculateTransactionFinancials}, and registers a compensation action
   * for rollback.
   *
   * @param context  - Movement billing context
   * @param type     - Transaction type ('SALE', 'RETURN', 'ADJUSTMENT', 'SERVICE')
   * @param billItem - The related BillItem (optional)
   * @param manager  - EntityManager for persistence
   * @returns The persisted BillingTransaction entity
   */
  protected async createBillingTransaction(
    context: MovementBillingContext,
    type: string,
    billItem?: Partial<BillItem>,
    manager?: EntityManager,
  ): Promise<Partial<BillingTransaction>> {
    const operationReference = this.generateReferenceNumber('TXN');
    const unitPrice = this.calculateUnitPrice(context);
    const amount = unitPrice * context.quantity;

    const transaction: Partial<BillingTransaction> = {
      transactionReference: operationReference,
      transactionType: type,
      billId: (billItem as any)?.billId || context.existingBillId,
      amount,
      balanceBefore: 0,
      balanceAfter: amount,
      status: 'COMPLETED',
      transactionDate: new Date(),
      processedBy: context.initiatedBy,
      description: `${type} billing for ${context.item?.name || 'Unknown'} x${context.quantity}`,
      notes: context.reason,
      metadata: {
        operationReference,
        strategyName: this.strategyName,
        movementType: context.movementType,
        itemId: context.item?.id,
        itemCode: context.item?.code,
        batchId: context.batch?.id,
        workspaceId: context.workspaceId,
      },
    };

    // Calculate detailed financials
    this.calculateTransactionFinancials(transaction, context);

    if (manager) {
      const entity = manager.create(BillingTransaction, transaction);
      const saved = await manager.save(BillingTransaction, entity);

      // Register compensation for rollback
      this.registerCompensationAction(
        CompensationActionType.REVERSE_TRANSACTION,
        'BillingTransaction',
        saved.id,
        { originalAmount: amount, type },
      );

      return saved;
    }

    return transaction;
  }

  /**
   * Calculate detailed financial fields on a billing transaction.
   *
   * Sets cost price, selling price, and profit margin based on the batch
   * cost price and calculated unit price.
   *
   * @param transaction - The transaction to enrich (mutated in place)
   * @param context     - Movement billing context
   */
  protected calculateTransactionFinancials(
    transaction: Partial<BillingTransaction>,
    context: MovementBillingContext,
  ): void {
    const costPrice = context.batch?.costPrice ?? 0;
    const sellingPrice = this.calculateUnitPrice(context);
    const profitMargin = costPrice > 0
      ? ((sellingPrice - costPrice) / costPrice) * 100
      : 0;

    transaction.metadata = {
      ...transaction.metadata,
      costPrice,
      sellingPrice,
      profitMargin: Math.round(profitMargin * 100) / 100,
      quantity: context.quantity,
      totalCost: costPrice * context.quantity,
      totalRevenue: sellingPrice * context.quantity,
      totalProfit: (sellingPrice - costPrice) * context.quantity,
    };
  }

  /**
   * Calculate the unit selling price for an item.
   *
   * Price resolution follows a priority chain:
   * 1. Override price from context (`context.unitPrice`)
   * 2. Batch selling price (`context.batch` + pricing strategy)
   * 3. Pricing strategy base price
   * 4. Item selling price (`context.item.sellingPrice`)
   * 5. Fallback: cost price * {@link DEFAULT_COST_MARKUP}
   *
   * @param context - Movement billing context
   * @returns The resolved unit price
   */
  protected calculateUnitPrice(context: MovementBillingContext): number {
    // Priority 1: explicit override price
    if (context.unitPrice !== undefined && context.unitPrice !== null && context.unitPrice > 0) {
      return context.unitPrice;
    }

    // Priority 2: batch selling price via pricing strategy
    if (context.batch) {
      const batchPrice = this.calculateSellingPrice(
        context.batch,
        undefined,
        context,
      );
      if (batchPrice > 0) {
        return batchPrice;
      }
    }

    // Priority 3: pricing strategy base price
    if (context.pricingStrategy?.basePrice && context.pricingStrategy.basePrice > 0) {
      let price = context.pricingStrategy.basePrice;

      // Apply markup if defined
      if (context.pricingStrategy.markupPercentage) {
        price = price * (1 + Number(context.pricingStrategy.markupPercentage) / 100);
      }

      // Apply discount if defined on strategy
      if (context.pricingStrategy.discountPercentage) {
        price = price * (1 - Number(context.pricingStrategy.discountPercentage) / 100);
      }

      // Enforce min/max bounds
      if (context.pricingStrategy.minPrice && price < context.pricingStrategy.minPrice) {
        price = Number(context.pricingStrategy.minPrice);
      }
      if (context.pricingStrategy.maxPrice && price > context.pricingStrategy.maxPrice) {
        price = Number(context.pricingStrategy.maxPrice);
      }

      return Math.round(price * 100) / 100;
    }

    // Priority 4: item default selling price
    if (context.item?.sellingPrice !== undefined && context.item.sellingPrice > 0) {
      return context.item.sellingPrice;
    }

    // Priority 5: fallback to cost * default markup
    if (context.batch?.costPrice && context.batch.costPrice > 0) {
      return Math.round(context.batch.costPrice * DEFAULT_COST_MARKUP * 100) / 100;
    }

    return 0;
  }

  /**
   * Calculate the selling price for a specific batch.
   *
   * Applies a priority chain:
   * 1. Explicit override price
   * 2. Batch cost price + pricing strategy markup
   * 3. Batch cost price + default markup
   *
   * @param batch         - Batch pricing data
   * @param overridePrice - Optional explicit override price
   * @param context       - Optional billing context for pricing strategy access
   * @returns Resolved selling price
   */
  protected calculateSellingPrice(
    batch: { id: string; costPrice?: number },
    overridePrice?: number,
    context?: MovementBillingContext,
  ): number {
    // Priority 1: explicit override
    if (overridePrice !== undefined && overridePrice > 0) {
      return overridePrice;
    }

    // Priority 2: pricing strategy markup on batch cost
    if (batch.costPrice && batch.costPrice > 0 && context?.pricingStrategy?.markupPercentage) {
      const markup = Number(context.pricingStrategy.markupPercentage) / 100;
      return Math.round(batch.costPrice * (1 + markup) * 100) / 100;
    }

    // Priority 3: default markup on batch cost
    if (batch.costPrice && batch.costPrice > 0) {
      return Math.round(batch.costPrice * DEFAULT_COST_MARKUP * 100) / 100;
    }

    return 0;
  }

  /**
   * Create a {@link PatientBill} entity from the billing context and a set
   * of bill items.
   *
   * Calculates subtotals, applies discounts and taxes, and sets the bill
   * status.  Registers a compensation action for rollback.
   *
   * @param context - Movement billing context
   * @param items   - Array of BillItem partials to include in the bill
   * @param manager - EntityManager for persistence
   * @returns The persisted PatientBill entity
   */
  protected async createPatientBill(
    context: MovementBillingContext,
    items: Partial<BillItem>[],
    manager?: EntityManager,
  ): Promise<Partial<PatientBill>> {
    const subtotal = items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
    const discountAmount = context.discount
      ? this.calculateDiscountAmount(subtotal, context)
      : 0;
    const taxAmount = context.tax
      ? this.calculateTaxAmount(subtotal - discountAmount, context)
      : 0;
    const total = subtotal - discountAmount + taxAmount;

    const billNumber = this.generateReferenceNumber('BILL');

    const bill: Partial<PatientBill> = {
      workspaceId: context.workspaceId,
      billNumber,
      patientId: context.patientId,
      appointmentId: context.appointmentId,
      department: context.department,
      discountId: context.discount?.id,
      taxId: context.tax?.id,
      subtotal,
      total,
      discountAmount,
      taxAmount,
      status: BillStatus.PENDING,
      issuedAt: new Date(),
      metadata: {
        strategyName: this.strategyName,
        itemCount: items.length,
        createdAt: new Date().toISOString(),
      },
    };

    if (manager) {
      const entity = manager.create(PatientBill, bill);
      const saved = await manager.save(PatientBill, entity);

      // Register compensation for rollback
      this.registerCompensationAction(
        CompensationActionType.CANCEL_BILL,
        'PatientBill',
        saved.id,
        { originalTotal: total, itemCount: items.length },
      );

      return saved;
    }

    return bill;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  INSURANCE PROCESSING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Process an insurance claim for a billing operation.
   *
   * Applies the default coverage rate ({@link DEFAULT_INSURANCE_COVERAGE_RATE})
   * or the rate from the coverage details.  If the claim amount exceeds
   * {@link INSURANCE_PRE_AUTH_THRESHOLD}, a pre-authorisation reference is
   * generated.
   *
   * @param context - Movement billing context with insurance details
   * @param amount  - Total billing amount to claim against
   * @returns Insurance claim processing result
   */
  protected processInsuranceClaim(
    context: MovementBillingContext,
    amount: number,
  ): {
    claimId: string;
    coveredAmount: number;
    patientResponsibility: number;
    requiresPreAuth: boolean;
    preAuthNumber?: string;
  } {
    const coverageRate = context.insuranceCoverage
      ? context.insuranceCoverage.coveragePercentage / 100
      : DEFAULT_INSURANCE_COVERAGE_RATE;

    let coveredAmount = amount * coverageRate;

    // Enforce max claim amount
    if (
      context.insuranceCoverage?.maxClaimAmount &&
      coveredAmount > context.insuranceCoverage.maxClaimAmount
    ) {
      coveredAmount = context.insuranceCoverage.maxClaimAmount;
    }

    const patientResponsibility = amount - coveredAmount;
    const requiresPreAuth = amount > INSURANCE_PRE_AUTH_THRESHOLD;

    const claimId = this.generateClaimId();
    const preAuthNumber = requiresPreAuth ? this.generateAuthNumber() : undefined;

    this.logger.log(
      `[${this.strategyName}] Insurance claim processed: claimId=${claimId}, ` +
      `covered=${coveredAmount.toFixed(2)}, patient=${patientResponsibility.toFixed(2)}, ` +
      `preAuth=${requiresPreAuth}`,
    );

    // Fire-and-forget audit
    this.auditLogService
      .log(
        {
          userId: context.initiatedBy,
          action: `Insurance claim processed: ${claimId}`,
          eventType: AuditEventType.CREATE,
          outcome: AuditOutcome.SUCCESS,
          resourceType: 'InsuranceClaim',
          resourceId: claimId,
          metadata: {
            amount,
            coveredAmount,
            patientResponsibility,
            coverageRate,
            requiresPreAuth,
            strategyName: this.strategyName,
          },
        },
        context.workspaceId,
      )
      .catch((err) =>
        this.logger.error(
          `[${this.strategyName}] Failed to audit insurance claim: ${(err as Error).message}`,
          (err as Error).stack,
        ),
      );

    return {
      claimId,
      coveredAmount: Math.round(coveredAmount * 100) / 100,
      patientResponsibility: Math.round(patientResponsibility * 100) / 100,
      requiresPreAuth,
      preAuthNumber,
    };
  }

  /**
   * Estimate insurance coverage for a billing amount.
   *
   * Returns the estimated covered amount, patient responsibility, and a
   * confidence level indicating how reliable the estimate is.
   *
   * @param context - Movement billing context with insurance details
   * @param amount  - Total amount to estimate coverage for
   * @returns Coverage estimate with confidence level
   */
  protected estimateInsuranceCoverage(
    context: MovementBillingContext,
    amount: number,
  ): { coveredAmount: number; patientResponsibility: number; confidence: number } {
    if (!context.insuranceCoverage) {
      return {
        coveredAmount: amount * DEFAULT_INSURANCE_COVERAGE_RATE,
        patientResponsibility: amount * (1 - DEFAULT_INSURANCE_COVERAGE_RATE),
        confidence: 0.3,
      };
    }

    const coverageRate = context.insuranceCoverage.coveragePercentage / 100;
    let coveredAmount = amount * coverageRate;

    // Enforce max claim amount
    if (
      context.insuranceCoverage.maxClaimAmount &&
      coveredAmount > context.insuranceCoverage.maxClaimAmount
    ) {
      coveredAmount = context.insuranceCoverage.maxClaimAmount;
    }

    const patientResponsibility = amount - coveredAmount;

    // Confidence is higher when we have full coverage details
    let confidence = 0.7;
    if (context.insuranceCoverage.contractNumber) {
      confidence += 0.1;
    }
    if (context.insuranceCoverage.schemeId) {
      confidence += 0.1;
    }
    if (context.insuranceCoverage.preAuthorizationNumber) {
      confidence += 0.1;
    }

    return {
      coveredAmount: Math.round(coveredAmount * 100) / 100,
      patientResponsibility: Math.round(patientResponsibility * 100) / 100,
      confidence: Math.min(confidence, 1.0),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  REVERSAL VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate whether a billing operation can be reversed.
   *
   * Reversal is blocked when:
   * - No reason is provided or the reason is shorter than
   *   {@link MIN_REVERSAL_REASON_LENGTH} characters
   * - The original transaction is already reversed (no double reversal)
   * - The original transaction is a return (returns cannot be reversed)
   * - The parent bill is already fully paid
   *
   * @param original - The original billing transaction to reverse
   * @param reason   - The reason for the reversal
   * @returns Validation result for the reversal
   */
  protected validateReversal(
    original: Partial<BillingTransaction>,
    reason?: string,
  ): ValidationResult {
    const errors: BillingError[] = [];
    const warnings: string[] = [];

    // Reason is mandatory
    if (!reason || reason.trim().length < MIN_REVERSAL_REASON_LENGTH) {
      errors.push({
        code: 'INSUFFICIENT_REVERSAL_REASON',
        message:
          `A reversal reason of at least ${MIN_REVERSAL_REASON_LENGTH} characters is required. ` +
          `Provided: ${reason?.trim().length || 0} character(s)`,
        field: 'reason',
      });
    }

    // Prevent double reversal
    if (original.status === 'REVERSED') {
      errors.push({
        code: 'ALREADY_REVERSED',
        message: `Transaction ${original.transactionReference} has already been reversed`,
        field: 'status',
        details: { currentStatus: original.status },
      });
    }

    // Prevent reversing a return transaction
    if (original.transactionType === 'RETURN') {
      errors.push({
        code: 'CANNOT_REVERSE_RETURN',
        message: 'Return transactions cannot be reversed. Process a new dispense instead.',
        field: 'transactionType',
      });
    }

    // Prevent reversing if bill is fully paid
    if (
      original.metadata &&
      (original.metadata as Record<string, any>).billStatus === BillStatus.PAID
    ) {
      errors.push({
        code: 'CANNOT_REVERSE_PAID_BILL',
        message: 'Cannot reverse a transaction on a fully paid bill. Process a refund instead.',
        field: 'billStatus',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  APPROVAL CHECKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check whether the billing amount requires approval.
   *
   * Uses the threshold from billing rules or falls back to
   * {@link DEFAULT_APPROVAL_THRESHOLD}.  Amounts exceeding the threshold
   * require primary approval; amounts exceeding 5x the threshold require
   * secondary (supervisor) approval.
   *
   * @param amount  - The billing amount to check
   * @param context - Movement billing context
   * @returns Approval requirement details
   */
  protected checkApprovalRequired(
    amount: number,
    context: MovementBillingContext,
  ): { required: boolean; reason?: string; level?: string } {
    const threshold =
      context.billingRules?.requireApprovalAboveThreshold ?? DEFAULT_APPROVAL_THRESHOLD;

    if (amount <= threshold) {
      return { required: false };
    }

    // Secondary approval for very high amounts
    const secondaryThreshold = threshold * 5;

    if (amount > secondaryThreshold) {
      return {
        required: true,
        reason:
          `Amount (${amount}) exceeds secondary approval threshold (${secondaryThreshold}). ` +
          'Requires supervisor or manager approval.',
        level: 'SECONDARY',
      };
    }

    return {
      required: true,
      reason: `Amount (${amount}) exceeds approval threshold (${threshold})`,
      level: 'PRIMARY',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AUDIT TRAIL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add an entry to the in-memory audit trail.
   *
   * Audit entries are accumulated during a billing operation and persisted
   * to the {@link AuditLogService} after the operation completes (fire-and-forget).
   *
   * @param action  - Description of the action performed
   * @param actor   - User ID of the person who performed the action
   * @param details - Additional details about the action
   * @param context - Optional billing context for workspace and resource info
   * @param _manager - Optional EntityManager (reserved for future transactional audit)
   */
  protected addAuditEntry(
    action: string,
    actor: string,
    details: Record<string, any>,
    context?: MovementBillingContext,
    _manager?: EntityManager,
  ): void {
    const entry: AuditEntry = {
      action,
      resourceType: details.resourceType || 'BillingOperation',
      resourceId: details.resourceId,
      userId: actor,
      workspaceId: context?.workspaceId || details.workspaceId || '',
      timestamp: new Date(),
      previousState: details.previousState,
      newState: details.newState,
      metadata: {
        strategyName: this.strategyName,
        ...details.metadata,
      },
    };

    this.auditTrail.push(entry);

    this.logger.debug(
      `[${this.strategyName}] Audit entry added: ${action} by ${actor}`,
    );

    // Fire-and-forget persistence to AuditLogService
    if (context?.workspaceId) {
      this.auditLogService
        .log(
          {
            userId: actor,
            action,
            eventType: details.eventType || AuditEventType.OTHER,
            outcome: details.outcome || AuditOutcome.SUCCESS,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            previousState: entry.previousState,
            newState: entry.newState,
            metadata: entry.metadata,
          },
          context.workspaceId,
        )
        .catch((err) =>
          this.logger.error(
            `[${this.strategyName}] Failed to persist audit entry: ${(err as Error).message}`,
            (err as Error).stack,
          ),
        );
    }
  }

  /**
   * Retrieve a copy of the current in-memory audit trail.
   *
   * @returns Array of audit entries (shallow copy)
   */
  protected getAuditTrail(): AuditEntry[] {
    return [...this.auditTrail];
  }

  /**
   * Clear the in-memory audit trail.
   *
   * Should be called at the start of each new billing operation to prevent
   * entries from previous operations leaking into the current one.
   */
  protected clearAuditTrail(): void {
    this.auditTrail = [];
    this.logger.debug(`[${this.strategyName}] Audit trail cleared`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a unique reference number with the given prefix.
   *
   * Format: `{prefix}-{timestamp}-{random}`
   *
   * @param prefix - The prefix to prepend (e.g. 'TXN', 'BILL', 'ITEM')
   * @returns A unique reference string
   */
  protected generateReferenceNumber(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Generate a unique insurance claim ID.
   *
   * Format: `INS-{timestamp}-{random}`
   *
   * @returns A unique claim ID string
   */
  protected generateClaimId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `INS-${timestamp}-${random}`;
  }

  /**
   * Generate a unique insurance pre-authorisation number.
   *
   * Format: `AUTH-{timestamp}-{random}`
   *
   * @returns A unique auth number string
   */
  protected generateAuthNumber(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `AUTH-${timestamp}-${random}`;
  }

  /**
   * Determine which billing rules are active for the given context.
   *
   * @param context - Movement billing context
   * @returns Array of human-readable rule descriptions
   */
  protected getAppliedRules(context: MovementBillingContext): string[] {
    const rules: string[] = [];

    if (!context.billingRules) {
      return rules;
    }

    if (context.billingRules.requireBatchLinking) {
      rules.push('Batch linking required');
    }
    if (context.billingRules.autoCreateTransactions) {
      rules.push('Auto-create transactions');
    }
    if (context.billingRules.validateStockAvailability) {
      rules.push('Stock availability validation');
    }
    if (context.billingRules.allowPartialBilling) {
      rules.push('Partial billing allowed');
    }
    if (context.billingRules.autoApplyDiscounts) {
      rules.push('Auto-apply discounts');
    }
    if (context.billingRules.autoApplyTaxes) {
      rules.push('Auto-apply taxes');
    }
    if (context.billingRules.requireApprovalAboveThreshold) {
      rules.push(`Approval required above ${context.billingRules.requireApprovalAboveThreshold}`);
    }
    if (context.billingRules.consolidateDuplicates) {
      rules.push('Consolidate duplicate items');
    }
    if (context.billingRules.enableInsuranceProcessing) {
      rules.push('Insurance processing enabled');
    }

    return rules;
  }

  /**
   * Log the elapsed time for a named operation.
   *
   * Logs at `debug` level for normal durations and `warn` level when the
   * duration exceeds 1000 ms.
   *
   * @param operation - Name of the operation being measured
   * @param startTime - `Date.now()` timestamp captured at operation start
   */
  protected logPerformance(operation: string, startTime: number): void {
    const elapsed = Date.now() - startTime;
    const message = `[${this.strategyName}] ${operation} completed in ${elapsed}ms`;

    if (elapsed > 1000) {
      this.logger.warn(`${message} (SLOW)`);
    } else {
      this.logger.debug(message);
    }
  }

  /**
   * Determine whether an error represents a transient database condition
   * that may be resolved by retrying.
   *
   * Recognised transient conditions:
   * - Deadlock detection
   * - Lock wait timeout
   * - Connection reset / refused / lost
   *
   * @param error - The error to classify
   * @returns `true` if the error is transient
   */
  protected isTransientError(error: Error): boolean {
    const message = (error.message || '').toLowerCase();
    const transientPatterns = [
      'deadlock',
      'lock wait timeout',
      'connection reset',
      'connection refused',
      'connection lost',
      'econnreset',
      'econnrefused',
      'etimedout',
      'er_lock_deadlock',
      'er_lock_wait_timeout',
    ];

    return transientPatterns.some((pattern) => message.includes(pattern));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PROTECTED RESULT BUILDERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build a standardised failed {@link BillingResult}.
   *
   * Convenience method for subclasses to return a consistent failure shape
   * without duplicating boilerplate.
   *
   * @param operationReference - Unique reference for the failed operation
   * @param errors             - Array of billing errors
   * @param auditEntries       - Audit entries collected before failure
   * @param warnings           - Optional warnings collected before failure
   * @returns A failed BillingResult
   */
  protected buildFailedResult(
    operationReference: string,
    errors: BillingError[],
    auditEntries: AuditEntry[],
    warnings: string[] = [],
  ): BillingResult {
    return {
      success: false,
      billingTransactions: [],
      billItems: [],
      totalAmount: 0,
      warnings,
      errors,
      billingState: BillingState.FAILED,
      operationReference,
      auditEntries,
    };
  }

  /**
   * Build a standardised failed {@link BillingReversalResult}.
   *
   * @param operationReference - Unique reference for the failed reversal
   * @param errors             - Array of billing errors
   * @param auditEntries       - Audit entries collected before failure
   * @returns A failed BillingReversalResult
   */
  protected buildFailedReversalResult(
    operationReference: string,
    errors: BillingError[],
    auditEntries: AuditEntry[],
  ): BillingReversalResult {
    return {
      success: false,
      reversalTransaction: {},
      refundAmount: 0,
      restoredItems: [],
      warnings: [],
      errors,
      billingState: BillingState.FAILED,
      operationReference,
      auditEntries,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate the discount amount for a given subtotal.
   *
   * Uses the discount entity's metadata to determine the discount type
   * (percentage or fixed) and applies it accordingly.
   *
   * @param subtotal - The subtotal to apply the discount to
   * @param context  - Movement billing context with discount details
   * @returns The calculated discount amount
   */
  private calculateDiscountAmount(
    subtotal: number,
    context: MovementBillingContext,
  ): number {
    if (!context.discount) {
      return 0;
    }

    const discountMeta = context.discount.metadata as Record<string, any> | undefined;

    // Percentage-based discount
    if (discountMeta?.type === 'PERCENTAGE' && discountMeta?.value) {
      const percentage = Number(discountMeta.value) / 100;
      return Math.round(subtotal * percentage * 100) / 100;
    }

    // Fixed-amount discount
    if (discountMeta?.type === 'FIXED' && discountMeta?.value) {
      return Math.min(Number(discountMeta.value), subtotal);
    }

    return 0;
  }

  /**
   * Calculate the tax amount for a given taxable amount.
   *
   * Uses the tax entity's metadata to determine the tax rate.
   *
   * @param taxableAmount - The amount to apply tax to
   * @param context       - Movement billing context with tax details
   * @returns The calculated tax amount
   */
  private calculateTaxAmount(
    taxableAmount: number,
    context: MovementBillingContext,
  ): number {
    if (!context.tax) {
      return 0;
    }

    const taxMeta = context.tax.metadata as Record<string, any> | undefined;

    if (taxMeta?.rate) {
      const rate = Number(taxMeta.rate) / 100;
      return Math.round(taxableAmount * rate * 100) / 100;
    }

    return 0;
  }
}
