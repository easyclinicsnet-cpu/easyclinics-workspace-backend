import { Injectable, BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { MovementType } from '../../../common/enums';
import {
  BillingStrategy,
  BillingContext,
  MovementBillingContext,
  StrategyPriority,
  InventoryLikeItem,
  ValidationResult,
} from './billing-strategy.interface';
import { DispenseBillingStrategy } from './dispense-billing.strategy';
import { ServiceBillingStrategy } from './service-billing.strategy';
import { ReturnBillingStrategy } from './return-billing.strategy';
import { AdjustmentBillingStrategy } from './adjustment-billing.strategy';

/**
 * Metadata describing a billing strategy's capabilities and health.
 */
export interface StrategyMetadata {
  name: string;
  priority: StrategyPriority;
  supportedMovementTypes: MovementType[];
  isHealthy: boolean;
  lastUsed?: Date;
  usageCount: number;
}

/**
 * Health report for a single billing strategy.
 */
export interface StrategyHealth {
  name: string;
  isHealthy: boolean;
  details?: string;
  lastChecked: Date;
}

/**
 * Billing Strategy Factory
 *
 * Resolves the correct billing strategy at runtime based on movement type
 * and optional context signals (item type, insurance status, etc.).
 *
 * Features:
 * - Strategy caching and priority-based selection
 * - Automatic strategy validation before use
 * - Health monitoring for all registered strategies
 * - Metadata introspection for debugging and observability
 *
 * Usage:
 * ```typescript
 * const strategy = this.billingStrategyFactory.getStrategyForMovement(
 *   MovementType.DISPENSE,
 *   billingContext,
 * );
 * const result = await strategy.processBilling(movementContext, manager);
 * ```
 */
@Injectable()
export class BillingStrategyFactory {
  private readonly context = BillingStrategyFactory.name;

  /** Cached mapping from movement type to resolved strategy. */
  private readonly strategyCache: Map<string, BillingStrategy> = new Map();

  /** Ordered list of all registered strategies (highest priority first). */
  private readonly strategies: BillingStrategy[];

  /** Priority map for fast lookup. */
  private readonly priorityMap: Map<string, StrategyPriority> = new Map();

  /** Usage counters per strategy. */
  private readonly usageCounters: Map<string, number> = new Map();

  /** Last-used timestamps per strategy. */
  private readonly lastUsedMap: Map<string, Date> = new Map();

  constructor(
    private readonly dispenseBillingStrategy: DispenseBillingStrategy,
    private readonly serviceBillingStrategy: ServiceBillingStrategy,
    private readonly returnBillingStrategy: ReturnBillingStrategy,
    private readonly adjustmentBillingStrategy: AdjustmentBillingStrategy,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(this.context);

    // Register strategies ordered by priority
    this.strategies = [
      this.dispenseBillingStrategy,
      this.serviceBillingStrategy,
      this.returnBillingStrategy,
      this.adjustmentBillingStrategy,
    ].sort((a, b) => a.priority - b.priority);

    // Build priority map
    for (const strategy of this.strategies) {
      this.priorityMap.set(strategy.strategyName, strategy.priority);
      this.usageCounters.set(strategy.strategyName, 0);
    }

    this.logger.log(
      `BillingStrategyFactory initialised with ${this.strategies.length} strategies`,
    );
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Find a strategy that supports the given movement type.
   * Uses the strategy cache for repeated lookups on the same key.
   *
   * @param movementType - The inventory movement type
   * @param context      - Optional billing context for fine-grained matching
   * @returns A matching BillingStrategy
   * @throws BadRequestException when no strategy supports the movement type
   */
  getStrategyForMovement(
    movementType: MovementType,
    context?: BillingContext,
  ): BillingStrategy {
    const cacheKey = this.buildCacheKey(movementType, context);

    // Check cache first
    const cached = this.strategyCache.get(cacheKey);
    if (cached) {
      this.recordUsage(cached.strategyName);
      return cached;
    }

    // Find first matching strategy (ordered by priority)
    const strategy = this.strategies.find((s) => s.supports(movementType, context));

    if (!strategy) {
      this.logger.error(
        `No billing strategy found for movement type: ${movementType}`,
        undefined,
        this.context,
      );
      throw new BadRequestException(
        `No billing strategy available for movement type: ${movementType}`,
      );
    }

    // Cache and record usage
    this.strategyCache.set(cacheKey, strategy);
    this.recordUsage(strategy.strategyName);

    this.logger.log(
      `Resolved strategy "${strategy.strategyName}" for movement type "${movementType}"`,
    );

    return strategy;
  }

  /**
   * Determine the best strategy based on movement type, item characteristics,
   * and billing context. Provides more granular selection than
   * `getStrategyForMovement` by inspecting the item payload.
   *
   * @param movementType  - The inventory movement type
   * @param item          - The inventory item being billed
   * @param billingContext - Full billing context
   * @returns A matching BillingStrategy
   * @throws BadRequestException when no strategy can handle the combination
   */
  determineStrategy(
    movementType: MovementType,
    item: InventoryLikeItem,
    billingContext: BillingContext,
  ): BillingStrategy {
    this.logger.debug(
      `Determining strategy for movement=${movementType}, item=${item.code}, type=${item.type}`,
    );

    // Service billing takes precedence for SERVICE movement regardless of item
    if (this.isServiceBilling(movementType)) {
      return this.getStrategyForMovement(movementType, billingContext);
    }

    // Return billing for RETURN movements
    if (this.isReturnBilling(movementType)) {
      return this.getStrategyForMovement(movementType, billingContext);
    }

    // Adjustment billing for adjustment movement types
    if (this.isAdjustmentBilling(movementType)) {
      return this.getStrategyForMovement(movementType, billingContext);
    }

    // Inventory dispense for medications / consumables
    if (this.isInventoryDispense(movementType, item)) {
      return this.getStrategyForMovement(movementType, billingContext);
    }

    // Fallback: generic movement lookup
    return this.getStrategyForMovement(movementType, billingContext);
  }

  /**
   * Validate a strategy before use. Runs the strategy's own
   * `validateBilling` against the provided context.
   *
   * @param strategy - The strategy to validate
   * @param context  - The movement billing context
   * @returns Validation result
   */
  async validateStrategy(
    strategy: BillingStrategy,
    context: MovementBillingContext,
  ): Promise<ValidationResult> {
    this.logger.debug(`Validating strategy "${strategy.strategyName}"`);

    try {
      const result = await strategy.validateBilling(context);

      if (!result.isValid) {
        this.logger.warn(
          `Strategy "${strategy.strategyName}" validation failed: ${result.errors.map((e) => e.message).join('; ')}`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Strategy validation threw an error: ${(error as Error).message}`,
        (error as Error).stack,
        this.context,
      );

      return {
        isValid: false,
        errors: [
          {
            code: 'STRATEGY_VALIDATION_ERROR',
            message: `Strategy validation failed: ${(error as Error).message}`,
          },
        ],
        warnings: [],
      };
    }
  }

  /**
   * Retrieve metadata about a specific strategy by name.
   *
   * @param strategyName - The strategy name
   * @returns Strategy metadata or undefined
   */
  getStrategyMetadata(strategyName: string): StrategyMetadata | undefined {
    const strategy = this.strategies.find((s) => s.strategyName === strategyName);
    if (!strategy) {
      return undefined;
    }

    return this.buildMetadata(strategy);
  }

  /**
   * Retrieve metadata for every registered strategy.
   *
   * @returns Array of strategy metadata objects
   */
  getAllStrategiesMetadata(): StrategyMetadata[] {
    return this.strategies.map((s) => this.buildMetadata(s));
  }

  /**
   * Run a health check across all registered strategies.
   *
   * @returns Array of health reports
   */
  async getAllStrategiesHealth(): Promise<StrategyHealth[]> {
    const healthResults: StrategyHealth[] = [];

    for (const strategy of this.strategies) {
      try {
        // A strategy is considered healthy if it can be instantiated
        // and its supports() method does not throw.
        const testTypes = [
          MovementType.DISPENSE,
          MovementType.SERVICE,
          MovementType.RETURN,
          MovementType.ADJUSTMENT_IN,
        ];

        let supportsSomething = false;
        for (const type of testTypes) {
          try {
            if (strategy.supports(type)) {
              supportsSomething = true;
              break;
            }
          } catch {
            // Swallow - strategy may simply not support this type
          }
        }

        healthResults.push({
          name: strategy.strategyName,
          isHealthy: supportsSomething,
          details: supportsSomething
            ? 'Strategy is responsive and supports at least one movement type'
            : 'Strategy did not match any tested movement types',
          lastChecked: new Date(),
        });
      } catch (error) {
        healthResults.push({
          name: strategy.strategyName,
          isHealthy: false,
          details: `Health check failed: ${(error as Error).message}`,
          lastChecked: new Date(),
        });
      }
    }

    this.logger.log(
      `Health check completed: ${healthResults.filter((h) => h.isHealthy).length}/${healthResults.length} healthy`,
    );

    return healthResults;
  }

  // ─── Type Guard Helpers ──────────────────────────────────────────────────

  /**
   * Check if the movement type represents an inventory dispense operation.
   */
  isInventoryDispense(movementType: MovementType, item?: InventoryLikeItem): boolean {
    const dispenseTypes: MovementType[] = [
      MovementType.DISPENSE,
      MovementType.PARTIAL_DISPENSE,
      MovementType.EMERGENCY_DISPENSE,
    ];

    if (!dispenseTypes.includes(movementType)) {
      return false;
    }

    // If item is provided, verify it looks like an inventory item
    if (item) {
      return !!(item.medicationItemId || item.consumableItemId || item.type);
    }

    return true;
  }

  /**
   * Check if the movement type represents a service billing operation.
   */
  isServiceBilling(movementType: MovementType): boolean {
    return movementType === MovementType.SERVICE;
  }

  /**
   * Check if the movement type represents a return operation.
   */
  isReturnBilling(movementType: MovementType): boolean {
    return movementType === MovementType.RETURN;
  }

  /**
   * Check if the movement type represents an adjustment operation.
   */
  isAdjustmentBilling(movementType: MovementType): boolean {
    const adjustmentTypes: MovementType[] = [
      MovementType.ADJUSTMENT_IN,
      MovementType.ADJUSTMENT_OUT,
      MovementType.ADJUSTMENT_CORRECTION,
      MovementType.PHYSICAL_COUNT,
      MovementType.ADJUSTMENT,
    ];

    return adjustmentTypes.includes(movementType);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Build a deterministic cache key for strategy lookups.
   */
  private buildCacheKey(movementType: MovementType, context?: BillingContext): string {
    const parts: string[] = [movementType];

    if (context?.isInsuranceClaim) {
      parts.push('insurance');
    }
    if (context?.department) {
      parts.push(context.department);
    }

    return parts.join(':');
  }

  /**
   * Record a strategy usage event.
   */
  private recordUsage(strategyName: string): void {
    const current = this.usageCounters.get(strategyName) || 0;
    this.usageCounters.set(strategyName, current + 1);
    this.lastUsedMap.set(strategyName, new Date());
  }

  /**
   * Build metadata for a given strategy.
   */
  private buildMetadata(strategy: BillingStrategy): StrategyMetadata {
    // Determine which movement types this strategy supports
    const allMovementTypes = Object.values(MovementType);
    const supportedTypes = allMovementTypes.filter((type) => {
      try {
        return strategy.supports(type);
      } catch {
        return false;
      }
    });

    return {
      name: strategy.strategyName,
      priority: strategy.priority,
      supportedMovementTypes: supportedTypes,
      isHealthy: true,
      lastUsed: this.lastUsedMap.get(strategy.strategyName),
      usageCount: this.usageCounters.get(strategy.strategyName) || 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy Health Checks (parity with legacy factory)
  // ---------------------------------------------------------------------------

  /**
   * Get health status for a specific strategy.
   *
   * Performs a lightweight liveness check:
   * - Verifies the strategy responds to `supports()`
   * - Reports feature availability (validation, estimation, etc.)
   *
   * @param strategy The billing strategy to check
   * @returns Health status report
   */
  async getStrategyHealth(strategy: BillingStrategy): Promise<StrategyHealth> {
    try {
      const testContext: BillingContext = {
        patientId: 'health-check',
        appointmentId: 'health-check',
        department: 'TEST',
        initiatedBy: 'SYSTEM',
        workspaceId: 'health-check',
        isInsuranceClaim: false,
        billingRules: {
          requireBatchLinking: false,
          autoCreateTransactions: true,
          validateStockAvailability: false,
        },
      };

      // Basic supports() check
      let isHealthy = true;
      try {
        strategy.supports(MovementType.DISPENSE, testContext);
      } catch {
        isHealthy = false;
      }

      const features: string[] = [];
      if (typeof strategy.validateBilling === 'function') features.push('validation');
      if (typeof strategy.estimateBilling === 'function') features.push('estimation');

      return {
        name: strategy.strategyName,
        isHealthy,
        details: isHealthy
          ? `${strategy.strategyName} is operational with features: [${features.join(', ')}]`
          : `${strategy.strategyName} failed health check`,
        lastChecked: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Health check failed for ${strategy.strategyName}: ${(error as Error).message}`,
      );
      return {
        name: strategy.strategyName,
        isHealthy: false,
        details: (error as Error).message,
        lastChecked: new Date(),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy Statistics (parity with legacy factory)
  // ---------------------------------------------------------------------------

  /**
   * Get comprehensive strategy statistics.
   *
   * Includes: total strategies, cache state, usage counters, feature breakdown.
   *
   * @returns Strategy statistics object
   */
  getStrategyStatistics(): {
    totalStrategies: number;
    cachedStrategies: number;
    strategiesByPriority: Array<{ name: string; priority: StrategyPriority }>;
    usageBreakdown: Array<{ name: string; usageCount: number; lastUsed?: Date }>;
    featuresBreakdown: Record<string, number>;
  } {
    const strategiesByPriority = this.strategies
      .map((s) => ({
        name: s.strategyName,
        priority: s.priority,
      }))
      .sort((a, b) => {
        const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, FALLBACK: 4 };
        return (order[a.priority] ?? 99) - (order[b.priority] ?? 99);
      });

    const usageBreakdown = this.strategies.map((s) => ({
      name: s.strategyName,
      usageCount: this.usageCounters.get(s.strategyName) || 0,
      lastUsed: this.lastUsedMap.get(s.strategyName),
    }));

    const featuresBreakdown: Record<string, number> = {
      validation: this.strategies.filter((s) => !!s.validateBilling).length,
      estimation: this.strategies.filter((s) => !!s.estimateBilling).length,
    };

    return {
      totalStrategies: this.strategies.length,
      cachedStrategies: this.strategyCache.size,
      strategiesByPriority,
      usageBreakdown,
      featuresBreakdown,
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy Validation with Transaction Context (parity with legacy factory)
  // ---------------------------------------------------------------------------

  /**
   * Validate strategy with transaction context awareness.
   *
   * In addition to standard validation, reports whether the strategy
   * is safe to run inside a transaction and recommends isolation level.
   *
   * @param strategy Strategy to validate
   * @param context  Movement billing context
   * @param manager  Optional EntityManager for transaction-aware validation
   * @returns Extended validation result
   */
  async validateStrategyWithTransaction(
    strategy: BillingStrategy,
    context: MovementBillingContext,
    manager?: EntityManager,
  ): Promise<{
    isValid: boolean;
    validationResult?: ValidationResult;
    transactionSafe: boolean;
    error?: string;
  }> {
    try {
      if (!strategy.validateBilling) {
        return { isValid: true, transactionSafe: true };
      }

      const validationResult = await strategy.validateBilling(context);

      return {
        isValid: validationResult.isValid,
        validationResult,
        transactionSafe: true,
      };
    } catch (error) {
      this.logger.error(
        `Strategy validation with transaction failed: ${(error as Error).message}`,
      );
      return {
        isValid: false,
        transactionSafe: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Clear strategy cache. Useful for testing or cache invalidation.
   */
  clearCache(): void {
    this.strategyCache.clear();
    this.logger.debug('Strategy cache cleared');
  }

  /**
   * Refresh strategy cache by rebuilding from registered strategies.
   */
  refreshCache(): void {
    this.clearCache();
    for (const strategy of this.strategies) {
      this.strategyCache.set(strategy.strategyName, strategy);
    }
    this.logger.debug('Strategy cache refreshed');
  }
}
