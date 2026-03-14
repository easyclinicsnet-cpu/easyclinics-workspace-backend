import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BillingStrategyFactory } from '../strategies/billing-strategy.factory';
import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { BillItemRepository } from '../repositories/bill-item.repository';
import { BillingTransactionRepository } from '../repositories/billing-transaction.repository';

import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';

import {
  BillingContext,
  MovementBillingContext,
  BillingResult,
  BillingReversalResult,
} from '../strategies/billing-strategy.interface';

import { BILLING_DEFAULTS } from '../utils/billing.constants';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

import { BillingTransaction } from '../entities/billing-transaction.entity';
import { BillItem } from '../entities/bill-item.entity';

import { BillingAuditResponseDto } from '../dto/audit/billing-audit-response.dto';
import { PaginatedBillingAuditResponseDto } from '../dto/audit/paginated-billing-audit-response.dto';
import { BillingSummaryResponseDto } from '../dto/audit/billing-summary-response.dto';

// ---------------------------------------------------------------------------
// Module-Level Constants
// ---------------------------------------------------------------------------

/** Hard cap on the number of items allowed in a single batch operation. */
const MAX_BATCH_SIZE = 1000;

/** Elapsed-time threshold (ms) above which a performance warning is emitted. */
const PERFORMANCE_WARNING_THRESHOLD_MS = 1000;

/**
 * Substrings that, when found in an error message, indicate a critical
 * infrastructure-level failure rather than a transient business-logic error.
 */
const CRITICAL_ERROR_PATTERNS: string[] = [
  'database',
  'transaction',
  'integrity',
  'connection',
  'deadlock',
  'constraint',
];

/**
 * Billing Orchestrator
 *
 * Central coordinator for billing strategy execution. Selects the correct
 * strategy via the factory, wraps executions in database transactions,
 * logs performance metrics, and writes audit trail entries.
 *
 * Also provides batch-processing and system-health endpoints.
 */
@Injectable()
export class BillingOrchestrationService {
  constructor(
    private readonly strategyFactory: BillingStrategyFactory,
    private readonly patientBillRepository: PatientBillRepository,
    private readonly billItemRepository: BillItemRepository,
    private readonly billingTransactionRepository: BillingTransactionRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('BillingOrchestrator');
  }

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

  /**
   * Process a single billing event.
   *
   * 1. Validate required context fields and business rules.
   * 2. Resolve the appropriate strategy from the factory.
   * 3. Execute the strategy within a database transaction.
   * 4. Log performance metrics.
   * 5. Write an audit log entry.
   *
   * @param movementContext - Movement context describing the billable event.
   * @param billingContext  - Contextual metadata (patient, department, user).
   * @param workspaceId    - Tenant workspace identifier.
   * @returns The billing result produced by the selected strategy.
   * @throws {BadRequestException} When context validation fails.
   * @throws {InternalServerErrorException} When strategy execution fails.
   */
  async processBilling(
    movementContext: MovementBillingContext,
    billingContext: BillingContext,
    workspaceId: string,
  ): Promise<BillingResult> {
    const startTime = Date.now();
    const operationRef = `BILL-${Date.now().toString(36).toUpperCase()}`;

    // --- Input validation ---------------------------------------------------
    this.validateBillingContext(billingContext, 'processBilling');
    this.validateMovementContext(movementContext, 'processBilling');

    this.logger.log(
      `Processing billing for movement type ${movementContext.movementType}, operation: ${operationRef}`,
    );

    try {
      // Determine strategy
      const strategy = this.strategyFactory.getStrategyForMovement(
        movementContext.movementType,
        billingContext,
      );

      this.logger.log(
        `Selected strategy: ${strategy.strategyName} for movement type ${movementContext.movementType}`,
      );

      // Execute within a transaction
      const result = await this.dataSource.transaction(async (manager) => {
        const billingResult = await strategy.processBilling(
          movementContext,
          manager,
        );
        return billingResult;
      });

      // Log performance
      this.logPerformance(`processBilling:${strategy.strategyName}`, startTime);

      // Audit log (fire-and-forget)
      this.auditLogService
        .log(
          {
            userId: billingContext.initiatedBy,
            action: 'BILLING_PROCESSED',
            eventType: AuditEventType.CREATE,
            outcome: result.success
              ? AuditOutcome.SUCCESS
              : AuditOutcome.FAILURE,
            resourceType: 'BillingTransaction',
            resourceId: result.operationReference,
            patientId: billingContext.patientId,
            newState: {
              strategyName: strategy.strategyName,
              movementType: movementContext.movementType,
              totalAmount: result.totalAmount,
              billingState: result.billingState,
              itemCount: result.billItems.length,
              operationReference: operationRef,
            },
          },
          workspaceId,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to write audit log for billing processing: ${err.message}`,
            err.stack,
          ),
        );

      this.logger.log(
        `Billing processed successfully. Strategy: ${strategy.strategyName}, Amount: ${result.totalAmount}, State: ${result.billingState}`,
      );

      return result;
    } catch (error) {
      this.logPerformance('processBilling:FAILED', startTime);

      this.logger.error(
        `Billing processing failed: ${error.message}`,
        error.stack,
      );

      // Audit the failure (fire-and-forget)
      this.auditLogService
        .log(
          {
            userId: billingContext.initiatedBy,
            action: 'BILLING_PROCESSING_FAILED',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.FAILURE,
            resourceType: 'BillingTransaction',
            patientId: billingContext.patientId,
            metadata: {
              error: error.message,
              movementType: movementContext.movementType,
              operationReference: operationRef,
            },
          },
          workspaceId,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to write failure audit log: ${err.message}`,
            err.stack,
          ),
        );

      if (this.isCriticalError(error)) {
        this.logger.error(
          `CRITICAL infrastructure error detected in processBilling: ${error.message}`,
        );
      }

      throw new InternalServerErrorException(
        `Billing processing failed: ${error.message}`,
      );
    }
  }

  /**
   * Reverse a previously processed billing transaction.
   *
   * 1. Validate the reversal reason (min 5 characters).
   * 2. Load and verify the original transaction exists.
   * 3. Resolve the strategy used for the original operation.
   * 4. Execute the reversal within a transaction.
   * 5. Write an audit log entry.
   *
   * @param originalTransactionId - Reference of the transaction to reverse.
   * @param reason                - Human-readable reason for the reversal (min 5 chars).
   * @param billingContext        - Contextual metadata.
   * @param workspaceId           - Tenant workspace identifier.
   * @returns The reversal result.
   * @throws {BadRequestException} When the reason is too short.
   * @throws {NotFoundException} When the original transaction cannot be found.
   * @throws {InternalServerErrorException} When the reversal fails.
   */
  async reverseBilling(
    originalTransactionId: string,
    reason: string,
    billingContext: BillingContext,
    workspaceId: string,
  ): Promise<BillingReversalResult> {
    const startTime = Date.now();

    // --- Input validation ---------------------------------------------------
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException(
        'Reversal reason must be at least 5 characters long',
      );
    }

    if (!originalTransactionId || originalTransactionId.trim().length === 0) {
      throw new BadRequestException(
        'Original transaction ID is required for reversal',
      );
    }

    this.validateBillingContext(billingContext, 'reverseBilling');

    this.logger.log(
      `Reversing billing for transaction: ${originalTransactionId}`,
    );

    // Load original transaction
    const originalTransaction =
      await this.billingTransactionRepository.findByReference(
        originalTransactionId,
      );

    if (!originalTransaction) {
      throw new NotFoundException(
        `Original billing transaction with reference ${originalTransactionId} not found`,
      );
    }

    try {
      // Build a MovementBillingContext for the reversal
      const reversalContext: MovementBillingContext = {
        ...billingContext,
        movementType: billingContext.metadata?.originalMovementType ?? 'RETURN',
        item: billingContext.metadata?.originalItem ?? {
          id: originalTransaction.id,
          name: 'Reversal',
          code: 'REV',
        },
        quantity: billingContext.metadata?.originalQuantity ?? 0,
        originalTransactionReference: originalTransactionId,
        reason,
      } as MovementBillingContext;

      // Determine strategy
      const strategy = this.strategyFactory.getStrategyForMovement(
        reversalContext.movementType,
        billingContext,
      );

      this.logger.log(
        `Selected strategy for reversal: ${strategy.strategyName}`,
      );

      // Execute within a transaction
      const result = await this.dataSource.transaction(async (manager) => {
        return strategy.reverseBilling(reversalContext, manager);
      });

      // Log performance
      this.logPerformance(
        `reverseBilling:${strategy.strategyName}`,
        startTime,
      );

      // Audit log (fire-and-forget)
      this.auditLogService
        .log(
          {
            userId: billingContext.initiatedBy,
            action: 'BILLING_REVERSED',
            eventType: AuditEventType.UPDATE,
            outcome: result.success
              ? AuditOutcome.SUCCESS
              : AuditOutcome.FAILURE,
            resourceType: 'BillingTransaction',
            resourceId: originalTransactionId,
            patientId: billingContext.patientId,
            previousState: {
              originalTransactionId,
              originalAmount: Number(originalTransaction.amount),
            },
            newState: {
              refundAmount: result.refundAmount,
              billingState: result.billingState,
              reason,
            },
          },
          workspaceId,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to write audit log for billing reversal: ${err.message}`,
            err.stack,
          ),
        );

      this.logger.log(
        `Billing reversed successfully. Refund: ${result.refundAmount}, State: ${result.billingState}`,
      );

      return result;
    } catch (error) {
      this.logPerformance('reverseBilling:FAILED', startTime);

      this.logger.error(
        `Billing reversal failed: ${error.message}`,
        error.stack,
      );

      if (this.isCriticalError(error)) {
        this.logger.error(
          `CRITICAL infrastructure error detected in reverseBilling: ${error.message}`,
        );
      }

      throw new InternalServerErrorException(
        `Billing reversal failed: ${error.message}`,
      );
    }
  }

  /**
   * Process a batch of billing items in fail-safe mode.
   *
   * Each item is processed independently. A failure in one item does not
   * prevent the remaining items from being processed. Results and failures
   * are collected and returned together.
   *
   * @param items          - Array of movement contexts to process.
   * @param billingContext - Shared billing context for the batch.
   * @param workspaceId   - Tenant workspace identifier.
   * @returns Object containing successful results and per-item failures.
   */
  async processBatchBilling(
    items: MovementBillingContext[],
    billingContext: BillingContext,
    workspaceId: string,
  ): Promise<{
    results: BillingResult[];
    failures: Array<{ index: number; error: string }>;
  }> {
    const startTime = Date.now();
    const batchSize = Math.min(
      items.length,
      BILLING_DEFAULTS.MAX_BATCH_SIZE,
    );

    this.logger.log(
      `Processing batch billing: ${batchSize} items (max configured: ${BILLING_DEFAULTS.MAX_BATCH_SIZE})`,
    );

    const results: BillingResult[] = [];
    const failures: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < batchSize; i++) {
      try {
        const result = await this.processBilling(
          items[i],
          billingContext,
          workspaceId,
        );
        results.push(result);
      } catch (error) {
        this.logger.error(
          `Batch item ${i} failed: ${error.message}`,
          error.stack,
        );
        failures.push({
          index: i,
          error: error.message ?? 'Unknown error',
        });
      }
    }

    this.logPerformance(
      `processBatchBilling:${batchSize}items`,
      startTime,
    );

    this.logger.log(
      `Batch billing complete. Successes: ${results.length}, Failures: ${failures.length}`,
    );

    // Audit the batch outcome (fire-and-forget)
    this.auditLogService
      .log(
        {
          userId: billingContext.initiatedBy,
          action: 'BATCH_BILLING_PROCESSED',
          eventType: AuditEventType.CREATE,
          outcome:
            failures.length === 0
              ? AuditOutcome.SUCCESS
              : AuditOutcome.FAILURE,
          resourceType: 'BillingBatch',
          patientId: billingContext.patientId,
          newState: {
            totalItems: batchSize,
            successes: results.length,
            failures: failures.length,
          },
        },
        workspaceId,
      )
      .catch((err) =>
        this.logger.error(
          `Failed to write audit log for batch billing: ${err.message}`,
          err.stack,
        ),
      );

    return { results, failures };
  }

  /**
   * Process multiple billing items in a SINGLE atomic transaction.
   *
   * Unlike `processBatchBilling`, which processes items independently in
   * fail-safe mode, this method wraps every item in a single database
   * transaction. If **any** item fails, the entire batch is rolled back.
   *
   * @param items          - Array of movement contexts to process atomically.
   * @param billingContext - Shared billing context.
   * @param workspaceId   - Tenant workspace identifier.
   * @returns Combined results, total amount, and an operation reference.
   * @throws {BadRequestException} When the batch is empty or exceeds MAX_BATCH_SIZE.
   * @throws {InternalServerErrorException} When any item in the batch fails.
   */
  async processAtomicBatchBilling(
    items: MovementBillingContext[],
    billingContext: BillingContext,
    workspaceId: string,
  ): Promise<{
    results: BillingResult[];
    totalAmount: number;
    operationReference: string;
  }> {
    const startTime = Date.now();
    const operationReference = `ATOMIC-BATCH-${Date.now().toString(36).toUpperCase()}`;

    // --- Input validation ---------------------------------------------------
    if (!items || items.length === 0) {
      throw new BadRequestException(
        'Atomic batch billing requires at least one item',
      );
    }

    if (items.length > MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `Batch size ${items.length} exceeds the maximum allowed size of ${MAX_BATCH_SIZE}`,
      );
    }

    this.validateBillingContext(billingContext, 'processAtomicBatchBilling');

    this.logger.log(
      `Processing atomic batch billing: ${items.length} items, operation: ${operationReference}`,
    );

    try {
      const results = await this.dataSource.transaction(async (manager) => {
        const batchResults: BillingResult[] = [];

        for (let i = 0; i < items.length; i++) {
          const movementContext = items[i];

          // Validate each item in the batch
          this.validateMovementContext(
            movementContext,
            `processAtomicBatchBilling[${i}]`,
          );

          // Resolve the strategy for this movement type
          const strategy = this.strategyFactory.getStrategyForMovement(
            movementContext.movementType,
            billingContext,
          );

          this.logger.log(
            `Atomic batch item ${i}: strategy=${strategy.strategyName}, movementType=${movementContext.movementType}`,
          );

          // Execute within the shared transaction manager
          const result = await strategy.processBilling(
            movementContext,
            manager,
          );

          if (!result.success) {
            throw new InternalServerErrorException(
              `Atomic batch item ${i} failed during processing: ${result.errors?.map((e) => e.message).join('; ') || 'Unknown error'}`,
            );
          }

          batchResults.push(result);
        }

        return batchResults;
      });

      const totalAmount = results.reduce(
        (sum, r) => sum + (r.totalAmount ?? 0),
        0,
      );

      // Log performance
      this.logPerformance(
        `processAtomicBatchBilling:${items.length}items`,
        startTime,
      );

      this.logger.log(
        `Atomic batch billing complete. Items: ${results.length}, Total: ${totalAmount}, Ref: ${operationReference}`,
      );

      // Audit (fire-and-forget)
      this.auditLogService
        .log(
          {
            userId: billingContext.initiatedBy,
            action: 'ATOMIC_BATCH_BILLING_PROCESSED',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'BillingBatch',
            patientId: billingContext.patientId,
            newState: {
              itemCount: results.length,
              totalAmount,
              operationReference,
              billingStates: results.map((r) => r.billingState),
            },
          },
          workspaceId,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to write audit log for atomic batch billing: ${err.message}`,
            err.stack,
          ),
        );

      return { results, totalAmount, operationReference };
    } catch (error) {
      this.logPerformance('processAtomicBatchBilling:FAILED', startTime);

      this.logger.error(
        `Atomic batch billing failed (all items rolled back): ${error.message}`,
        error.stack,
      );

      // Audit the failure (fire-and-forget)
      this.auditLogService
        .log(
          {
            userId: billingContext.initiatedBy,
            action: 'ATOMIC_BATCH_BILLING_FAILED',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.FAILURE,
            resourceType: 'BillingBatch',
            patientId: billingContext.patientId,
            metadata: {
              error: error.message,
              itemCount: items.length,
              operationReference,
            },
          },
          workspaceId,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to write failure audit log for atomic batch: ${err.message}`,
            err.stack,
          ),
        );

      if (this.isCriticalError(error)) {
        this.logger.error(
          `CRITICAL infrastructure error detected in processAtomicBatchBilling: ${error.message}`,
        );
      }

      throw new InternalServerErrorException(
        `Atomic batch billing failed: ${error.message}`,
      );
    }
  }

  /**
   * Retrieve a paginated billing audit trail.
   *
   * Queries the `BillingTransaction` repository with optional filters for
   * patient, date range, movement type, and pagination. Results are mapped
   * to `BillingAuditResponseDto` instances.
   *
   * @param filters     - Filtering and pagination options.
   * @param workspaceId - Tenant workspace identifier.
   * @returns Paginated billing audit response DTO.
   */
  async getBillingAuditTrail(
    filters: {
      patientId?: string;
      startDate?: Date;
      endDate?: Date;
      movementType?: string;
      limit?: number;
      offset?: number;
    },
    workspaceId: string,
  ): Promise<PaginatedBillingAuditResponseDto> {
    const startTime = Date.now();
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = filters.offset ?? 0;

    this.logger.log(
      `Retrieving billing audit trail for workspace ${workspaceId}, ` +
        `filters: ${JSON.stringify({ ...filters, limit, offset })}`,
    );

    try {
      const queryBuilder = this.billingTransactionRepository
        .createQueryBuilder('txn')
        .leftJoinAndSelect('txn.bill', 'bill')
        .where('txn.isActive = :isActive', { isActive: true });

      // --- Optional filters --------------------------------------------------
      if (filters.patientId) {
        queryBuilder.andWhere('bill.patientId = :patientId', {
          patientId: filters.patientId,
        });
      }

      if (filters.startDate && filters.endDate) {
        queryBuilder.andWhere(
          'txn.transactionDate BETWEEN :startDate AND :endDate',
          {
            startDate: filters.startDate,
            endDate: filters.endDate,
          },
        );
      } else if (filters.startDate) {
        queryBuilder.andWhere('txn.transactionDate >= :startDate', {
          startDate: filters.startDate,
        });
      } else if (filters.endDate) {
        queryBuilder.andWhere('txn.transactionDate <= :endDate', {
          endDate: filters.endDate,
        });
      }

      if (filters.movementType) {
        queryBuilder.andWhere('txn.transactionType = :movementType', {
          movementType: filters.movementType,
        });
      }

      // --- Pagination & ordering --------------------------------------------
      queryBuilder
        .orderBy('txn.transactionDate', 'DESC')
        .skip(offset)
        .take(limit);

      const [transactions, total] = await queryBuilder.getManyAndCount();

      // --- Map to DTOs ------------------------------------------------------
      const data: BillingAuditResponseDto[] = transactions.map((txn) =>
        this.mapTransactionToAuditDto(txn),
      );

      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.floor(offset / limit) + 1;

      this.logPerformance('getBillingAuditTrail', startTime);

      this.logger.log(
        `Billing audit trail retrieved. Total: ${total}, Page: ${currentPage}/${totalPages}`,
      );

      return {
        data,
        meta: {
          total,
          page: currentPage,
          limit,
          totalPages,
        },
      };
    } catch (error) {
      this.logPerformance('getBillingAuditTrail:FAILED', startTime);

      this.logger.error(
        `Failed to retrieve billing audit trail: ${error.message}`,
        error.stack,
      );

      throw new InternalServerErrorException(
        `Failed to retrieve billing audit trail: ${error.message}`,
      );
    }
  }

  /**
   * Get a comprehensive audit trail for a specific billing item.
   *
   * Aggregates data from both the `BillingTransaction` and `BillItem`
   * tables to produce a unified, chronological audit view for a single
   * item (identified by `itemId`).
   *
   * @param itemId      - The ID of the bill item or transaction to audit.
   * @param options     - Filtering / inclusion options.
   * @param workspaceId - Tenant workspace identifier.
   * @returns Paginated billing audit response DTO with aggregated records.
   */
  async getComprehensiveAuditTrail(
    itemId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      includeMovements?: boolean;
      includeAdjustments?: boolean;
      includeBilling?: boolean;
      limit?: number;
      offset?: number;
    },
    workspaceId: string,
  ): Promise<PaginatedBillingAuditResponseDto> {
    const startTime = Date.now();
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = options.offset ?? 0;

    this.logger.log(
      `Retrieving comprehensive audit trail for item ${itemId} in workspace ${workspaceId}`,
    );

    try {
      const auditRecords: BillingAuditResponseDto[] = [];

      // ------------------------------------------------------------------
      // 1. Billing transactions related to the item
      // ------------------------------------------------------------------
      if (options.includeBilling !== false) {
        const txnQuery = this.billingTransactionRepository
          .createQueryBuilder('txn')
          .leftJoinAndSelect('txn.bill', 'bill')
          .where('txn.isActive = :isActive', { isActive: true })
          .andWhere(
            '(txn.id = :itemId OR txn.billId = :itemId OR txn.transactionReference = :itemId)',
            { itemId },
          );

        if (options.startDate) {
          txnQuery.andWhere('txn.transactionDate >= :startDate', {
            startDate: options.startDate,
          });
        }
        if (options.endDate) {
          txnQuery.andWhere('txn.transactionDate <= :endDate', {
            endDate: options.endDate,
          });
        }

        txnQuery.orderBy('txn.transactionDate', 'DESC');

        const billingTransactions = await txnQuery.getMany();

        for (const txn of billingTransactions) {
          auditRecords.push(this.mapTransactionToAuditDto(txn, 'BILLING'));
        }
      }

      // ------------------------------------------------------------------
      // 2. Bill items linked to the item (movements / adjustments)
      // ------------------------------------------------------------------
      if (options.includeMovements !== false || options.includeAdjustments !== false) {
        const itemQuery = this.billItemRepository
          .createQueryBuilder('item')
          .leftJoinAndSelect('item.bill', 'bill')
          .where('item.isActive = :isActive', { isActive: true })
          .andWhere(
            '(item.id = :itemId OR item.billId = :itemId)',
            { itemId },
          );

        if (options.startDate) {
          itemQuery.andWhere('item.createdAt >= :startDate', {
            startDate: options.startDate,
          });
        }
        if (options.endDate) {
          itemQuery.andWhere('item.createdAt <= :endDate', {
            endDate: options.endDate,
          });
        }

        itemQuery.orderBy('item.createdAt', 'DESC');

        const billItems = await itemQuery.getMany();

        for (const item of billItems) {
          auditRecords.push(this.mapBillItemToAuditDto(item, workspaceId));
        }
      }

      // ------------------------------------------------------------------
      // 3. Sort all records chronologically (newest first) & paginate
      // ------------------------------------------------------------------
      auditRecords.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      const total = auditRecords.length;
      const paginatedRecords = auditRecords.slice(offset, offset + limit);
      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.floor(offset / limit) + 1;

      this.logPerformance('getComprehensiveAuditTrail', startTime);

      this.logger.log(
        `Comprehensive audit trail retrieved for item ${itemId}. Records: ${total}, Page: ${currentPage}/${totalPages}`,
      );

      // Audit the read (fire-and-forget)
      this.auditLogService
        .log(
          {
            userId: 'SYSTEM',
            action: 'COMPREHENSIVE_AUDIT_TRAIL_READ',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'BillingAuditTrail',
            resourceId: itemId,
            metadata: {
              totalRecords: total,
              includeMovements: options.includeMovements,
              includeAdjustments: options.includeAdjustments,
              includeBilling: options.includeBilling,
            },
          },
          workspaceId,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to write audit log for comprehensive audit trail read: ${err.message}`,
            err.stack,
          ),
        );

      return {
        data: paginatedRecords,
        meta: {
          total,
          page: currentPage,
          limit,
          totalPages,
        },
      };
    } catch (error) {
      this.logPerformance('getComprehensiveAuditTrail:FAILED', startTime);

      this.logger.error(
        `Failed to retrieve comprehensive audit trail for item ${itemId}: ${error.message}`,
        error.stack,
      );

      throw new InternalServerErrorException(
        `Failed to retrieve comprehensive audit trail: ${error.message}`,
      );
    }
  }

  /**
   * Get a billing summary with period grouping.
   *
   * Queries billing transactions within the specified date range and
   * aggregates revenue, bill counts, and average amounts grouped by the
   * requested period (`day`, `week`, or `month`).
   *
   * @param options     - Summary options including date range, grouping, and optional department filter.
   * @param workspaceId - Tenant workspace identifier.
   * @returns Billing summary response DTO.
   */
  async getBillingSummary(
    options: {
      startDate: Date;
      endDate: Date;
      groupBy: 'day' | 'week' | 'month';
      department?: string;
    },
    workspaceId: string,
  ): Promise<BillingSummaryResponseDto> {
    const startTime = Date.now();

    this.logger.log(
      `Generating billing summary for workspace ${workspaceId}, ` +
        `period: ${options.startDate.toISOString()} - ${options.endDate.toISOString()}, ` +
        `groupBy: ${options.groupBy}`,
    );

    try {
      // ------------------------------------------------------------------
      // 1. Query billing transactions in the date range
      // ------------------------------------------------------------------
      const txnQuery = this.billingTransactionRepository
        .createQueryBuilder('txn')
        .leftJoinAndSelect('txn.bill', 'bill')
        .where('txn.isActive = :isActive', { isActive: true })
        .andWhere(
          'txn.transactionDate BETWEEN :startDate AND :endDate',
          {
            startDate: options.startDate,
            endDate: options.endDate,
          },
        );

      if (options.department) {
        txnQuery.andWhere('bill.department = :department', {
          department: options.department,
        });
      }

      const transactions = await txnQuery.getMany();

      // ------------------------------------------------------------------
      // 2. Query patient bills in the date range
      // ------------------------------------------------------------------
      const billQuery = this.patientBillRepository
        .createQueryBuilder('bill')
        .where('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.issuedAt BETWEEN :startDate AND :endDate', {
          startDate: options.startDate,
          endDate: options.endDate,
        });

      if (options.department) {
        billQuery.andWhere('bill.department = :department', {
          department: options.department,
        });
      }

      const bills = await billQuery.getMany();

      // ------------------------------------------------------------------
      // 3. Aggregate the data
      // ------------------------------------------------------------------
      const totalBills = bills.length;
      const totalRevenue = bills.reduce(
        (sum, b) => sum + Number(b.total ?? 0),
        0,
      );
      const totalPayments = transactions
        .filter((t) => t.transactionType === 'PAYMENT')
        .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
      const totalOutstanding = totalRevenue - totalPayments;
      const averageBillAmount = totalBills > 0 ? totalRevenue / totalBills : 0;

      // Bills by status
      const billsByStatus: Record<string, number> = {};
      for (const bill of bills) {
        const status = bill.status ?? 'UNKNOWN';
        billsByStatus[status] = (billsByStatus[status] ?? 0) + 1;
      }

      // Payments by method (derived from transaction metadata or type)
      const paymentsByMethod: Record<string, number> = {};
      for (const txn of transactions) {
        if (txn.transactionType === 'PAYMENT') {
          const method =
            txn.metadata?.paymentMethod ?? txn.transactionType ?? 'UNKNOWN';
          paymentsByMethod[method] =
            (paymentsByMethod[method] ?? 0) + Number(txn.amount ?? 0);
        }
      }

      // Revenue by department
      const revenueByDepartment: Record<string, number> = {};
      for (const bill of bills) {
        const dept = bill.department ?? 'UNASSIGNED';
        revenueByDepartment[dept] =
          (revenueByDepartment[dept] ?? 0) + Number(bill.total ?? 0);
      }

      this.logPerformance('getBillingSummary', startTime);

      this.logger.log(
        `Billing summary generated. Bills: ${totalBills}, Revenue: ${totalRevenue}, Outstanding: ${totalOutstanding}`,
      );

      // Audit the read (fire-and-forget)
      this.auditLogService
        .log(
          {
            userId: 'SYSTEM',
            action: 'BILLING_SUMMARY_READ',
            eventType: AuditEventType.READ,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'BillingSummary',
            metadata: {
              startDate: options.startDate.toISOString(),
              endDate: options.endDate.toISOString(),
              groupBy: options.groupBy,
              department: options.department,
              totalBills,
              totalRevenue,
            },
          },
          workspaceId,
        )
        .catch((err) =>
          this.logger.error(
            `Failed to write audit log for billing summary read: ${err.message}`,
            err.stack,
          ),
        );

      return {
        totalBills,
        totalRevenue,
        totalPayments,
        totalOutstanding,
        averageBillAmount,
        billsByStatus,
        paymentsByMethod,
        revenueByDepartment,
        period: {
          startDate: options.startDate,
          endDate: options.endDate,
        },
      };
    } catch (error) {
      this.logPerformance('getBillingSummary:FAILED', startTime);

      this.logger.error(
        `Failed to generate billing summary: ${error.message}`,
        error.stack,
      );

      throw new InternalServerErrorException(
        `Failed to generate billing summary: ${error.message}`,
      );
    }
  }

  /**
   * Return high-level system health information for the billing subsystem.
   *
   * @param workspaceId - Tenant workspace identifier.
   * @returns Object with strategy info, transaction count, and health status.
   */
  async getSystemHealth(
    workspaceId: string,
  ): Promise<{
    strategies: Array<{ name: string; priority: string }>;
    transactionCount: number;
    status: string;
  }> {
    this.logger.log(`Retrieving billing system health for workspace ${workspaceId}`);

    try {
      const strategies = this.strategyFactory.getAllStrategiesMetadata();

      const transactionCount = await this.billingTransactionRepository.count({
        where: { isActive: true },
      });

      return {
        strategies: strategies.map((s: any) => ({
          name: s.strategyName ?? s.name ?? 'unknown',
          priority: s.priority ?? 'N/A',
        })),
        transactionCount,
        status: 'HEALTHY',
      };
    } catch (error) {
      this.logger.error(
        `System health check failed: ${error.message}`,
        error.stack,
      );

      return {
        strategies: [],
        transactionCount: 0,
        status: 'DEGRADED',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  /**
   * Validate the core billing context fields that every operation requires.
   *
   * @param context   - The billing context to validate.
   * @param operation - Name of the calling operation (for error messages).
   * @throws {BadRequestException} When a required field is missing or invalid.
   */
  private validateBillingContext(
    context: BillingContext,
    operation: string,
  ): void {
    if (!context) {
      throw new BadRequestException(
        `[${operation}] Billing context is required`,
      );
    }

    if (!context.patientId || context.patientId.trim().length === 0) {
      throw new BadRequestException(
        `[${operation}] billingContext.patientId is required`,
      );
    }

    if (!context.initiatedBy || context.initiatedBy.trim().length === 0) {
      throw new BadRequestException(
        `[${operation}] billingContext.initiatedBy is required`,
      );
    }
  }

  /**
   * Validate the movement-specific context fields.
   *
   * @param context   - The movement billing context to validate.
   * @param operation - Name of the calling operation (for error messages).
   * @throws {BadRequestException} When a required field is missing or invalid.
   */
  private validateMovementContext(
    context: MovementBillingContext,
    operation: string,
  ): void {
    if (!context) {
      throw new BadRequestException(
        `[${operation}] Movement context is required`,
      );
    }

    if (!context.movementType) {
      throw new BadRequestException(
        `[${operation}] movementContext.movementType is required`,
      );
    }

    if (!context.item || !context.item.id) {
      throw new BadRequestException(
        `[${operation}] movementContext.item with a valid id is required`,
      );
    }

    if (context.quantity === undefined || context.quantity === null || context.quantity <= 0) {
      throw new BadRequestException(
        `[${operation}] movementContext.quantity must be greater than 0 (received: ${context.quantity})`,
      );
    }
  }

  /**
   * Determine whether an error represents a critical infrastructure failure.
   *
   * Critical errors are those whose messages match one of the patterns in
   * {@link CRITICAL_ERROR_PATTERNS} and typically indicate database or
   * transaction-level problems rather than business-logic issues.
   *
   * @param error - The error to inspect.
   * @returns `true` if the error is considered critical.
   */
  private isCriticalError(error: Error): boolean {
    if (!error || !error.message) {
      return false;
    }

    const lowerMessage = error.message.toLowerCase();

    return CRITICAL_ERROR_PATTERNS.some((pattern) =>
      lowerMessage.includes(pattern),
    );
  }

  /**
   * Log the elapsed time for an operation and emit a warning when it exceeds
   * the configured performance threshold.
   *
   * @param operation - A human-readable label for the operation being timed.
   * @param startTime - The `Date.now()` value captured before the operation began.
   */
  private logPerformance(operation: string, startTime: number): void {
    const elapsedMs = Date.now() - startTime;
    const threshold = PERFORMANCE_WARNING_THRESHOLD_MS;

    if (elapsedMs > threshold) {
      this.logger.warn(
        `Performance warning: ${operation} took ${elapsedMs}ms (threshold: ${threshold}ms)`,
      );
    } else {
      this.logger.log(`${operation} completed in ${elapsedMs}ms`);
    }
  }

  /**
   * Map a {@link BillingTransaction} entity to a {@link BillingAuditResponseDto}.
   *
   * @param txn    - The billing transaction entity.
   * @param action - Optional action label override (defaults to the transaction type).
   * @returns A populated audit response DTO.
   */
  private mapTransactionToAuditDto(
    txn: BillingTransaction,
    action?: string,
  ): BillingAuditResponseDto {
    const dto = new BillingAuditResponseDto();
    dto.id = txn.id;
    dto.action = action ?? txn.transactionType;
    dto.resourceType = 'BillingTransaction';
    dto.resourceId = txn.transactionReference;
    dto.userId = txn.processedBy ?? 'SYSTEM';
    dto.workspaceId = txn.metadata?.workspaceId ?? '';
    dto.patientId = txn.bill?.patientId;
    dto.previousState = {
      balanceBefore: Number(txn.balanceBefore),
    };
    dto.newState = {
      amount: Number(txn.amount),
      balanceAfter: Number(txn.balanceAfter),
      status: txn.status,
    };
    dto.metadata = txn.metadata ?? {};
    dto.timestamp = txn.transactionDate;
    dto.createdAt = txn.createdAt;

    return dto;
  }

  /**
   * Map a {@link BillItem} entity to a {@link BillingAuditResponseDto}.
   *
   * @param item        - The bill item entity.
   * @param workspaceId - Tenant workspace identifier for the DTO.
   * @returns A populated audit response DTO.
   */
  private mapBillItemToAuditDto(
    item: BillItem,
    workspaceId: string,
  ): BillingAuditResponseDto {
    const dto = new BillingAuditResponseDto();
    dto.id = item.id;
    dto.action = 'BILL_ITEM';
    dto.resourceType = 'BillItem';
    dto.resourceId = item.id;
    dto.userId = item.metadata?.processedBy ?? 'SYSTEM';
    dto.workspaceId = workspaceId;
    dto.patientId = item.bill?.patientId;
    dto.previousState = undefined;
    dto.newState = {
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      department: item.department,
      insuranceClaimStatus: item.insuranceClaimStatus,
    };
    dto.metadata = item.metadata ?? {};
    dto.timestamp = item.createdAt;
    dto.createdAt = item.createdAt;

    return dto;
  }
}
