import { EntityManager } from 'typeorm';
import { BillItem } from '../entities/bill-item.entity';
import { BillingTransaction } from '../entities/billing-transaction.entity';
import { Discount } from '../entities/discount.entity';
import { Tax } from '../entities/tax.entity';
import { PricingStrategy } from '../entities/pricing-strategy.entity';
import { PatientBill } from '../entities/patient-bill.entity';
import { MovementType } from '../../../common/enums';

// ─── Strategy-Specific Enums ───────────────────────────────────────────────────

/**
 * Determines the priority order in which strategies are evaluated.
 * Lower numeric values indicate higher priority.
 */
export enum StrategyPriority {
  CRITICAL = 0,
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
  FALLBACK = 4,
}

/**
 * Represents the current lifecycle state of a billing operation.
 */
export enum BillingState {
  INITIATED = 'INITIATED',
  VALIDATING = 'VALIDATING',
  PROCESSING = 'PROCESSING',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
  PARTIALLY_REVERSED = 'PARTIALLY_REVERSED',
}

/**
 * Transaction isolation levels for billing operations.
 */
export enum TransactionIsolation {
  READ_UNCOMMITTED = 'READ UNCOMMITTED',
  READ_COMMITTED = 'READ COMMITTED',
  REPEATABLE_READ = 'REPEATABLE READ',
  SERIALIZABLE = 'SERIALIZABLE',
}

/**
 * Status of a transactional billing operation.
 */
export enum TransactionStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMMITTED = 'COMMITTED',
  ROLLED_BACK = 'ROLLED_BACK',
  FAILED = 'FAILED',
}

/**
 * Database lock modes used during billing operations.
 */
export enum LockMode {
  NONE = 'NONE',
  PESSIMISTIC_READ = 'PESSIMISTIC_READ',
  PESSIMISTIC_WRITE = 'PESSIMISTIC_WRITE',
  OPTIMISTIC = 'OPTIMISTIC',
}

// ─── Inventory Placeholder ─────────────────────────────────────────────────────

/**
 * Lightweight representation of an inventory item.
 * Used in place of a full inventory entity since the inventory module
 * integration is not yet finalised.
 */
export interface InventoryLikeItem {
  id: string;
  name: string;
  code: string;
  type?: string;
  medicationItemId?: string;
  consumableItemId?: string;
  sellingPrice?: number;
  batches?: any[];
  metadata?: Record<string, any>;
}

// ─── Core Context & Rules ──────────────────────────────────────────────────────

/**
 * Rules that govern how a billing operation should be processed.
 */
export interface BillingRules {
  /** Whether bill items must be linked to specific inventory batches. */
  requireBatchLinking: boolean;
  /** Automatically create billing transactions when items are added. */
  autoCreateTransactions: boolean;
  /** Check stock availability before processing a dispense. */
  validateStockAvailability: boolean;
  /** Allow partial billing when full stock is unavailable. */
  allowPartialBilling?: boolean;
  /** Apply configured discounts automatically. */
  autoApplyDiscounts?: boolean;
  /** Apply configured taxes automatically. */
  autoApplyTaxes?: boolean;
  /** Require approval above a certain monetary threshold. */
  requireApprovalAboveThreshold?: number;
  /** Maximum number of retries for failed transactions. */
  maxRetryAttempts?: number;
  /** Whether duplicate items should be consolidated into a single line. */
  consolidateDuplicates?: boolean;
  /** Enable insurance claim processing. */
  enableInsuranceProcessing?: boolean;
  /** Additional rule metadata. */
  metadata?: Record<string, any>;
}

/**
 * Primary context object passed to every billing strategy.
 * Contains all information needed to evaluate and execute a billing operation.
 */
export interface BillingContext {
  /** Patient receiving the billed service or item. */
  patientId: string;
  /** Appointment during which the billing event occurred. */
  appointmentId: string;
  /** Clinical department originating the charge. */
  department?: string;
  /** User who initiated the billing action. */
  initiatedBy: string;
  /** Tenant workspace identifier for multi-tenancy. */
  workspaceId: string;
  /** Insurance provider id if the claim is insurance-backed. */
  insuranceProviderId?: string;
  /** Whether this billing event produces an insurance claim. */
  isInsuranceClaim?: boolean;
  /** Insurance coverage details when applicable. */
  insuranceCoverage?: InsuranceCoverageDetails;
  /** Rules that control billing behaviour. */
  billingRules?: BillingRules;
  /** Transaction-level options. */
  transactionOptions?: TransactionContext;
  /** Existing patient bill to append items to (if any). */
  existingBillId?: string;
  /** Existing patient bill entity (pre-loaded). */
  existingBill?: PatientBill;
  /** Applicable discount entity. */
  discount?: Discount;
  /** Applicable tax entity. */
  tax?: Tax;
  /** Pricing strategy to apply. */
  pricingStrategy?: PricingStrategy;
  /** ISO currency code (defaults to workspace currency). */
  currency?: string;
  /** Correlation id for distributed tracing. */
  correlationId?: string;
  /** Arbitrary context metadata. */
  metadata?: Record<string, any>;
}

/**
 * Extended context for movement-based billing (dispense, return, etc.).
 */
export interface MovementBillingContext extends BillingContext {
  /** Type of inventory movement triggering this billing event. */
  movementType: MovementType;
  /** The inventory item being billed. */
  item: InventoryLikeItem;
  /** Quantity involved in the movement. */
  quantity: number;
  /** Batch from which the item is sourced (if batch-tracked). */
  batch?: {
    id: string;
    batchNumber: string;
    expiryDate?: Date;
    availableQuantity?: number;
    costPrice?: number;
  };
  /** Unit selling price (overrides item default when provided). */
  unitPrice?: number;
  /** Original dispense reference for returns and reversals. */
  originalDispenseReference?: string;
  /** Original transaction reference for reversals. */
  originalTransactionReference?: string;
  /** Provider/clinician who ordered or performed the service. */
  providerId?: string;
  /** Service category for service-type movements. */
  serviceCategory?: string;
  /** Reason for the movement (used for returns, adjustments). */
  reason?: string;
  /** Movement-specific metadata. */
  movementMetadata?: Record<string, any>;
}

// ─── Insurance ─────────────────────────────────────────────────────────────────

/**
 * Details about the patient's insurance coverage relevant to a billing event.
 */
export interface InsuranceCoverageDetails {
  /** Insurance provider entity id. */
  providerId: string;
  /** Provider display name. */
  providerName: string;
  /** Patient insurance record id. */
  patientInsuranceId: string;
  /** Insurance scheme id. */
  schemeId?: string;
  /** Coverage percentage (0-100). */
  coveragePercentage: number;
  /** Patient co-pay percentage (0-100). */
  copayPercentage: number;
  /** Maximum amount the insurance will pay per claim. */
  maxClaimAmount?: number;
  /** Minimum claim amount required by the provider. */
  minClaimAmount?: number;
  /** Whether pre-authorisation is required. */
  requiresPreAuthorization: boolean;
  /** Pre-authorisation number (when already obtained). */
  preAuthorizationNumber?: string;
  /** Contract / policy number. */
  contractNumber?: string;
  /** Coverage-level metadata. */
  metadata?: Record<string, any>;
}

// ─── Results ───────────────────────────────────────────────────────────────────

/**
 * Outcome of a billing strategy execution.
 */
export interface BillingResult {
  /** Whether the billing operation succeeded. */
  success: boolean;
  /** Transactions created during the operation. */
  billingTransactions: Partial<BillingTransaction>[];
  /** Bill line items created or modified. */
  billItems: Partial<BillItem>[];
  /** Total monetary amount billed. */
  totalAmount: number;
  /** Non-fatal warnings raised during processing. */
  warnings: string[];
  /** Fatal errors that prevented completion. */
  errors: BillingError[];
  /** Patient bill entity (created or updated). */
  bill?: Partial<PatientBill>;
  /** Insurance claim reference if one was created. */
  insuranceClaimId?: string;
  /** Amount covered by insurance. */
  insuranceCoveredAmount?: number;
  /** Amount to be paid by the patient. */
  patientResponsibility?: number;
  /** Current state of the billing lifecycle. */
  billingState: BillingState;
  /** Unique operation reference for tracing. */
  operationReference: string;
  /** Audit trail entries produced by this operation. */
  auditEntries: AuditEntry[];
  /** Arbitrary result metadata. */
  metadata?: Record<string, any>;
}

/**
 * Outcome of a billing reversal operation.
 */
export interface BillingReversalResult {
  /** Whether the reversal succeeded. */
  success: boolean;
  /** Reversal transaction created. */
  reversalTransaction: Partial<BillingTransaction>;
  /** Amount refunded. */
  refundAmount: number;
  /** Amount refunded to insurance. */
  insuranceRefundAmount?: number;
  /** Amount refunded directly to the patient. */
  patientRefundAmount?: number;
  /** Items whose stock was restored. */
  restoredItems: Array<{ itemId: string; quantity: number; batchId?: string }>;
  /** Non-fatal warnings raised during reversal. */
  warnings: string[];
  /** Fatal errors that prevented reversal. */
  errors: BillingError[];
  /** Current lifecycle state after reversal. */
  billingState: BillingState;
  /** Unique operation reference for tracing. */
  operationReference: string;
  /** Audit trail entries produced by the reversal. */
  auditEntries: AuditEntry[];
  /** Arbitrary metadata. */
  metadata?: Record<string, any>;
}

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Result of a billing validation check.
 */
export interface ValidationResult {
  /** Whether all validation rules passed. */
  isValid: boolean;
  /** Individual validation errors. */
  errors: BillingError[];
  /** Non-fatal validation warnings. */
  warnings: string[];
  /** Validation-level metadata. */
  metadata?: Record<string, any>;
}

/**
 * Structured billing error with a machine-readable code.
 */
export interface BillingError {
  /** Machine-readable error code (e.g. INSUFFICIENT_STOCK). */
  code: string;
  /** Human-readable error description. */
  message: string;
  /** Field or component that triggered the error. */
  field?: string;
  /** Error details / stack trace (non-production). */
  details?: Record<string, any>;
}

// ─── Estimates & Previews ──────────────────────────────────────────────────────

/**
 * Monetary estimate of a billing operation before execution.
 */
export interface BillingEstimate {
  /** Estimated subtotal before discounts and taxes. */
  subtotal: number;
  /** Estimated discount amount. */
  discountAmount: number;
  /** Estimated tax amount. */
  taxAmount: number;
  /** Estimated grand total. */
  totalAmount: number;
  /** Estimated insurance coverage. */
  insuranceCoverage?: number;
  /** Estimated patient responsibility. */
  patientResponsibility?: number;
  /** Whether approval will be required. */
  requiresApproval: boolean;
  /** Reason approval is required (when applicable). */
  approvalReason?: string;
  /** Estimate-level metadata. */
  metadata?: Record<string, any>;
}

/**
 * Preview of a complete billing operation.
 */
export interface BillingPreview {
  /** Preview of individual bill items. */
  items: BillItemPreview[];
  /** Estimated totals. */
  estimate: BillingEstimate;
  /** Validation result for the preview context. */
  validation: ValidationResult;
  /** Non-fatal warnings. */
  warnings: string[];
  /** Preview-level metadata. */
  metadata?: Record<string, any>;
}

/**
 * Preview of a single bill line item before creation.
 */
export interface BillItemPreview {
  /** Item description. */
  description: string;
  /** Quantity. */
  quantity: number;
  /** Unit selling price. */
  unitPrice: number;
  /** Line total (quantity * unitPrice). */
  totalPrice: number;
  /** Associated item id. */
  itemId?: string;
  /** Item code. */
  itemCode?: string;
  /** Department originating the charge. */
  department?: string;
  /** Whether insurance covers this item. */
  insuranceCovered?: boolean;
  /** Percentage covered by insurance. */
  insuranceCoveragePercentage?: number;
  /** Preview metadata. */
  metadata?: Record<string, any>;
}

// ─── Audit ─────────────────────────────────────────────────────────────────────

/**
 * Lightweight audit entry produced by billing strategy operations.
 * These are later persisted via the AuditLogService.
 */
export interface AuditEntry {
  /** Action performed. */
  action: string;
  /** Type of resource affected. */
  resourceType: string;
  /** Resource identifier. */
  resourceId?: string;
  /** User who performed the action. */
  userId: string;
  /** Workspace identifier. */
  workspaceId: string;
  /** Timestamp of the action. */
  timestamp: Date;
  /** State before the action. */
  previousState?: Record<string, any>;
  /** State after the action. */
  newState?: Record<string, any>;
  /** Additional audit metadata. */
  metadata?: Record<string, any>;
}

// ─── Transaction Management ────────────────────────────────────────────────────

/**
 * Options for the database transaction wrapping a billing operation.
 */
export interface TransactionContext {
  /** Desired isolation level. */
  isolationLevel?: TransactionIsolation;
  /** Lock mode for critical rows. */
  lockMode?: LockMode;
  /** Transaction timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum retry attempts on transient failures. */
  maxRetries?: number;
  /** Whether to enable deadlock detection heuristics. */
  enableDeadlockDetection?: boolean;
  /** Pre-existing entity manager (for joining an outer transaction). */
  entityManager?: EntityManager;
  /** Transaction-level metadata. */
  metadata?: Record<string, any>;
}

/**
 * Describes a compensating action to undo part of a failed transaction.
 */
export interface CompensationAction {
  /** Human-readable description of the compensation. */
  description: string;
  /** Function that executes the compensation. */
  execute: (manager: EntityManager) => Promise<void>;
  /** Execution order (lower = first). */
  order: number;
  /** Whether this compensation is critical (must succeed). */
  isCritical: boolean;
  /** Compensation metadata. */
  metadata?: Record<string, any>;
}

/**
 * Information about a deadlock encountered during processing.
 */
export interface DeadlockInfo {
  /** Tables involved in the deadlock. */
  tables: string[];
  /** ISO timestamp of detection. */
  detectedAt: string;
  /** Number of retry attempts made. */
  retryCount: number;
  /** Whether the deadlock was resolved by retry. */
  resolved: boolean;
  /** Deadlock metadata. */
  metadata?: Record<string, any>;
}

/**
 * Configuration for processing billing items in batches (bulk operations).
 */
export interface BatchTransactionConfig {
  /** Number of items to process per batch. */
  batchSize: number;
  /** Whether to continue processing remaining batches after a failure. */
  continueOnError: boolean;
  /** Maximum level of parallelism for batch processing. */
  maxParallelism: number;
  /** Per-batch timeout in milliseconds. */
  timeoutPerBatchMs?: number;
  /** Batch processing metadata. */
  metadata?: Record<string, any>;
}

// ─── Strategy Interface ────────────────────────────────────────────────────────

/**
 * Core billing strategy interface.
 *
 * Every concrete strategy (dispense, service, return, adjustment) implements
 * this interface to provide a uniform API for billing operations. The factory
 * selects the appropriate strategy at runtime based on movement type and
 * context.
 *
 * Lifecycle:
 *   1. `supports()`        -- determine applicability
 *   2. `validateBilling()`  -- pre-flight checks
 *   3. `estimateBilling()`  -- cost preview (optional)
 *   4. `processBilling()`   -- execute billing
 *   5. `reverseBilling()`   -- undo billing (if needed)
 */
export interface BillingStrategy {
  /** Unique name for this strategy (used in logging and metadata). */
  readonly strategyName: string;

  /** Priority of this strategy relative to others. */
  readonly priority: StrategyPriority;

  /**
   * Determine whether this strategy can handle the given movement type
   * and optional context.
   *
   * @param movementType - Inventory movement type
   * @param context      - Optional billing context for fine-grained checks
   * @returns true if this strategy is applicable
   */
  supports(movementType: MovementType, context?: BillingContext): boolean;

  /**
   * Execute the billing operation.
   *
   * @param context - Full movement billing context
   * @param manager - TypeORM EntityManager (for transactional operations)
   * @returns Billing result
   */
  processBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingResult>;

  /**
   * Reverse a previously processed billing operation.
   *
   * @param context - Movement billing context with original references
   * @param manager - TypeORM EntityManager
   * @returns Reversal result
   */
  reverseBilling(
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<BillingReversalResult>;

  /**
   * Validate a billing context without executing the operation.
   *
   * @param context - Movement billing context to validate
   * @returns Validation result
   */
  validateBilling(context: MovementBillingContext): Promise<ValidationResult>;

  /**
   * Produce a cost estimate / preview for a billing context.
   *
   * @param context - Movement billing context
   * @returns Billing estimate
   */
  estimateBilling(context: MovementBillingContext): Promise<BillingEstimate>;
}
