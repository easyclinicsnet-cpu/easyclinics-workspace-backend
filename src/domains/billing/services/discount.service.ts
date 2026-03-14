import { IsNull } from 'typeorm';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DiscountRepository } from '../repositories/discount.repository';
import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { BillItemRepository } from '../repositories/bill-item.repository';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import {
  CreateDiscountDto,
  UpdateDiscountDto,
  DiscountQueryDto,
} from '../dto/requests/discount.dto';
import { DiscountResponseDto } from '../dto/responses/discount.dto';
import { PaginatedResponseMetaDto } from '../dto/common/pagination.dto';
import { Discount } from '../entities/discount.entity';
import { PatientBill } from '../entities/patient-bill.entity';
import { AuditEventType, AuditOutcome, BillStatus } from '../../../common/enums';

/**
 * Context for evaluating auto-applicable discounts.
 * Captures the billing scenario attributes used to match eligibility criteria.
 */
export interface AutoApplicableDiscountContext {
  /** Patient classification (e.g., 'regular', 'vip', 'insurance') */
  patientType?: string;
  /** Department originating the bill */
  department?: string;
  /** Pre-discount subtotal of the bill */
  subtotal?: number;
  /** Types of items on the bill (e.g., 'medication', 'consumable', 'service') */
  itemTypes?: string[];
  /** Insurance plan identifier for plan-specific discounts */
  insurancePlanId?: string;
}

/**
 * Analytics result for discount usage within a date range.
 */
export interface DiscountUsageAnalytics {
  /** Total number of times any discount was used */
  totalUsageCount: number;
  /** Aggregate monetary value of all discounts applied */
  totalDiscountAmount: number;
  /** Mean discount value per application */
  averageDiscountPerUse: number;
  /** Ordered list of the most-used discounts with aggregated totals */
  topDiscountsByUsage: Array<{
    discountId: string;
    name: string;
    usageCount: number;
    totalAmount: number;
  }>;
}

/**
 * Result summary for a bulk discount status update operation.
 */
export interface BulkUpdateResult {
  /** Count of discounts successfully updated */
  updated: number;
  /** Count of discounts that could not be updated */
  failed: number;
  /** Per-discount outcome details */
  results: Array<{
    id: string;
    success: boolean;
    message?: string;
  }>;
}

/**
 * Result of a discount eligibility evaluation against a specific bill.
 */
export interface DiscountEligibilityResult {
  /** Whether the discount is eligible for the bill */
  isEligible: boolean;
  /** Human-readable explanation when ineligible */
  reason?: string;
}

/**
 * Service for managing discounts in the billing domain
 * Handles CRUD operations, discount validation, application to bills,
 * and discount calculations with HIPAA-compliant audit logging
 */
@Injectable()
export class DiscountService {
  constructor(
    private readonly discountRepository: DiscountRepository,
    private readonly patientBillRepository: PatientBillRepository,
    private readonly billItemRepository: BillItemRepository,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('DiscountService');
  }

  /**
   * Create a new discount configuration
   * @param dto Discount creation data
   * @param userId User ID creating the discount
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Created discount response
   */
  async createDiscount(
    dto: CreateDiscountDto,
    userId: string,
    workspaceId: string,
  ): Promise<DiscountResponseDto> {
    this.logger.log(`Creating discount: ${dto.name}, workspace: ${workspaceId}`);

    try {
      // Validate percentage value if applicable
      if (dto.isPercentage && dto.value > 100) {
        throw new BadRequestException('Percentage discount value cannot exceed 100');
      }

      // Validate date range if both dates are provided
      if (dto.validFrom && dto.validUntil) {
        const from = new Date(dto.validFrom);
        const until = new Date(dto.validUntil);
        if (from >= until) {
          throw new BadRequestException('validFrom must be before validUntil');
        }
      }

      const discount = this.discountRepository.create({
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      });

      const savedDiscount = await this.discountRepository.save(discount);

      this.logger.log(`Discount created successfully - ID: ${savedDiscount.id}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'CREATE_DISCOUNT',
            eventType: AuditEventType.CREATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Discount',
            resourceId: savedDiscount.id,
            metadata: {
              name: dto.name,
              discountType: dto.discountType,
              value: dto.value,
              isPercentage: dto.isPercentage,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for discount creation - ID: ${savedDiscount.id}`,
          auditError.stack,
        );
      }

      return this.mapToDiscountResponse(savedDiscount);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Failed to create discount: ${dto.name}`, error.stack);
      throw error;
    }
  }

  /**
   * Update an existing discount
   * @param id Discount ID
   * @param dto Update data
   * @param userId User ID performing the update
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Updated discount response
   */
  async updateDiscount(
    id: string,
    dto: UpdateDiscountDto,
    userId: string,
    workspaceId: string,
  ): Promise<DiscountResponseDto> {
    this.logger.log(`Updating discount: ${id}, workspace: ${workspaceId}`);

    try {
      const discount = await this.discountRepository.findOne({
        where: { id, isActive: true, deletedAt: IsNull() },
      });

      if (!discount) {
        this.logger.error(`Discount not found: ${id}`);
        throw new NotFoundException(`Discount with ID ${id} not found`);
      }

      // Validate percentage value if applicable
      const isPercentage = dto.isPercentage ?? discount.isPercentage;
      const value = dto.value ?? discount.value;
      if (isPercentage && value > 100) {
        throw new BadRequestException('Percentage discount value cannot exceed 100');
      }

      // Validate date range if both dates are provided
      const validFrom = dto.validFrom
        ? new Date(dto.validFrom)
        : discount.validFrom;
      const validUntil = dto.validUntil
        ? new Date(dto.validUntil)
        : discount.validUntil;
      if (validFrom && validUntil && validFrom >= validUntil) {
        throw new BadRequestException('validFrom must be before validUntil');
      }

      const previousState = { ...discount };

      // Apply updates
      Object.assign(discount, {
        ...dto,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : discount.validFrom,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : discount.validUntil,
      });

      const updatedDiscount = await this.discountRepository.save(discount);

      this.logger.log(`Discount updated successfully - ID: ${id}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'UPDATE_DISCOUNT',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Discount',
            resourceId: id,
            previousState: {
              name: previousState.name,
              value: previousState.value,
              isPercentage: previousState.isPercentage,
            },
            metadata: {
              updates: Object.keys(dto),
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for discount update - ID: ${id}`,
          auditError.stack,
        );
      }

      return this.mapToDiscountResponse(updatedDiscount);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Failed to update discount: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Get a single discount by ID
   * @param id Discount ID
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Discount response
   */
  async getDiscountById(
    id: string,
    workspaceId: string,
  ): Promise<DiscountResponseDto> {
    this.logger.log(`Finding discount by ID: ${id}, workspace: ${workspaceId}`);

    try {
      const discount = await this.discountRepository.findOne({
        where: { id, isActive: true, deletedAt: IsNull() },
      });

      if (!discount) {
        this.logger.error(`Discount not found: ${id}`);
        throw new NotFoundException(`Discount with ID ${id} not found`);
      }

      return this.mapToDiscountResponse(discount);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find discount by ID: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all discounts with filtering and pagination
   * @param query Query parameters with filters
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns Paginated discount list
   */
  async getDiscounts(
    query: DiscountQueryDto,
    workspaceId: string,
  ): Promise<{ data: DiscountResponseDto[]; meta: PaginatedResponseMetaDto }> {
    this.logger.log(`Finding discounts for workspace: ${workspaceId}`);

    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 10, 100);

      const qb = this.discountRepository
        .createQueryBuilder('discount')
        .where('discount.isActive = :isActive', { isActive: true })
        .andWhere('discount.deletedAt IS NULL');

      // Apply filters
      if (query.discountType) {
        qb.andWhere('discount.discountType = :discountType', {
          discountType: query.discountType,
        });
      }

      if (query.search) {
        qb.andWhere('(discount.name LIKE :search OR discount.description LIKE :search)', {
          search: `%${query.search}%`,
        });
      }

      // Apply sorting
      const sortBy = query.sortBy || 'createdAt';
      const sortOrder = query.sortOrder || 'DESC';
      qb.orderBy(`discount.${sortBy}`, sortOrder);

      // Apply pagination
      qb.skip((page - 1) * limit).take(limit);

      const [discounts, total] = await qb.getManyAndCount();

      return {
        data: discounts.map((discount) => this.mapToDiscountResponse(discount)),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to find discounts for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Soft delete a discount
   * @param id Discount ID
   * @param userId User ID performing the deletion
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async deleteDiscount(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(`Deleting discount: ${id}, workspace: ${workspaceId}`);

    try {
      const discount = await this.discountRepository.findOne({
        where: { id, isActive: true, deletedAt: IsNull() },
      });

      if (!discount) {
        this.logger.error(`Discount not found: ${id}`);
        throw new NotFoundException(`Discount with ID ${id} not found`);
      }

      // Soft delete
      discount.isActive = false;
      discount.isDeleted = true;
      discount.deletedAt = new Date();
      discount.deletedBy = userId;
      await this.discountRepository.save(discount);

      this.logger.log(`Discount deleted successfully - ID: ${id}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'DELETE_DISCOUNT',
            eventType: AuditEventType.DELETE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'Discount',
            resourceId: id,
            metadata: {
              name: discount.name,
              discountType: discount.discountType,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for discount deletion - ID: ${id}`,
          auditError.stack,
        );
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete discount: ${id}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all active discounts (non-deleted, active status)
   * @param workspaceId Workspace ID for multi-tenancy
   * @returns List of active discount responses
   */
  async getActiveDiscounts(workspaceId: string): Promise<DiscountResponseDto[]> {
    this.logger.log(`Finding active discounts for workspace: ${workspaceId}`);

    try {
      const discounts = await this.discountRepository.findAllActive();

      return discounts.map((discount) => this.mapToDiscountResponse(discount));
    } catch (error) {
      this.logger.error(
        `Failed to find active discounts for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get discounts applicable to a given amount, department, and workspace
   * Filters by valid dates, usage limits, minimum purchase amount, and applicable departments
   * @param amount Purchase amount to check against minimum purchase requirements
   * @param department Optional department filter
   * @param workspaceId Optional workspace ID for multi-tenancy
   * @returns List of applicable discount responses
   */
  async getApplicableDiscounts(
    amount: number,
    department?: string,
    workspaceId?: string,
  ): Promise<DiscountResponseDto[]> {
    this.logger.log(
      `Finding applicable discounts for amount: ${amount}, department: ${department || 'all'}`,
    );

    try {
      // Fetch all currently valid discounts (active, within date range, within usage limits)
      const validDiscounts = await this.discountRepository.findValidDiscounts();

      // Further filter by business rules
      const applicableDiscounts = validDiscounts.filter((discount) => {
        // Check minimum purchase amount
        if (
          discount.minPurchaseAmount &&
          amount < Number(discount.minPurchaseAmount)
        ) {
          return false;
        }

        // Check applicable departments
        if (department && discount.applicableDepartments) {
          const departments = Array.isArray(discount.applicableDepartments)
            ? discount.applicableDepartments
            : [];
          if (departments.length > 0 && !departments.includes(department)) {
            return false;
          }
        }

        return true;
      });

      return applicableDiscounts.map((discount) =>
        this.mapToDiscountResponse(discount),
      );
    } catch (error) {
      this.logger.error(
        `Failed to find applicable discounts for amount: ${amount}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Calculate the discount amount for a given discount applied to a purchase amount
   * Handles both percentage and flat discounts with maxDiscountAmount cap
   * @param discountId Discount ID
   * @param amount Purchase amount to apply the discount to
   * @returns Calculated discount amount
   */
  async calculateDiscountAmount(
    discountId: string,
    amount: number,
  ): Promise<number> {
    this.logger.log(
      `Calculating discount amount for discount: ${discountId}, amount: ${amount}`,
    );

    try {
      const discount = await this.discountRepository.findOne({
        where: { id: discountId, isActive: true, deletedAt: IsNull() },
      });

      if (!discount) {
        this.logger.error(`Discount not found: ${discountId}`);
        throw new NotFoundException(`Discount with ID ${discountId} not found`);
      }

      let discountAmount: number;

      if (discount.isPercentage) {
        // Percentage-based discount
        discountAmount = (amount * Number(discount.value)) / 100;
      } else {
        // Flat amount discount
        discountAmount = Number(discount.value);
      }

      // Apply maximum discount cap if configured
      if (
        discount.maxDiscountAmount &&
        discountAmount > Number(discount.maxDiscountAmount)
      ) {
        discountAmount = Number(discount.maxDiscountAmount);
      }

      // Discount cannot exceed the original amount
      discountAmount = Math.min(discountAmount, amount);

      // Round to 2 decimal places
      discountAmount = Math.round(discountAmount * 100) / 100;

      this.logger.log(
        `Calculated discount amount: ${discountAmount} for discount: ${discountId}`,
      );

      return discountAmount;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to calculate discount amount for discount: ${discountId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Apply a discount to an existing bill
   * Validates both bill and discount, calculates discount amount on the bill subtotal,
   * updates bill totals, and increments discount usage count
   * @param billId Bill ID to apply the discount to
   * @param discountId Discount ID to apply
   * @param userId User ID performing the action
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async applyDiscountToBill(
    billId: string,
    discountId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(
      `Applying discount ${discountId} to bill ${billId}, workspace: ${workspaceId}`,
    );

    try {
      // Load and validate bill
      const bill = await this.patientBillRepository.findOne({
        where: { id: billId, isActive: true, deletedAt: IsNull() },
      });

      if (!bill) {
        this.logger.error(`Bill not found: ${billId}`);
        throw new NotFoundException(`Bill with ID ${billId} not found`);
      }

      // Load and validate discount
      const discount = await this.discountRepository.findOne({
        where: { id: discountId, isActive: true, deletedAt: IsNull() },
      });

      if (!discount) {
        this.logger.error(`Discount not found: ${discountId}`);
        throw new NotFoundException(`Discount with ID ${discountId} not found`);
      }

      // Validate discount is still valid
      if (!this.isDiscountValid(discount)) {
        throw new BadRequestException(
          `Discount "${discount.name}" is no longer valid or has exceeded its usage limit`,
        );
      }

      // Check minimum purchase amount
      if (
        discount.minPurchaseAmount &&
        Number(bill.subtotal) < Number(discount.minPurchaseAmount)
      ) {
        throw new BadRequestException(
          `Bill subtotal (${bill.subtotal}) is below the minimum purchase amount (${discount.minPurchaseAmount}) for this discount`,
        );
      }

      // Calculate discount amount on bill subtotal
      const discountAmount = await this.calculateDiscountAmount(
        discountId,
        Number(bill.subtotal),
      );

      // Update bill with discount
      bill.discountId = discountId;
      bill.discountAmount = discountAmount;
      bill.total = Number(bill.subtotal) - discountAmount + Number(bill.taxAmount);

      // Round total to 2 decimal places
      bill.total = Math.round(bill.total * 100) / 100;

      await this.patientBillRepository.save(bill);

      // Increment discount usage count
      await this.discountRepository.incrementUsage(discountId);

      this.logger.log(
        `Discount ${discountId} applied to bill ${billId} - discount amount: ${discountAmount}`,
      );

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'APPLY_DISCOUNT_TO_BILL',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'PatientBill',
            resourceId: billId,
            metadata: {
              discountId,
              discountName: discount.name,
              discountAmount,
              billSubtotal: bill.subtotal,
              newTotal: bill.total,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for discount application - bill: ${billId}`,
          auditError.stack,
        );
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to apply discount ${discountId} to bill ${billId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Remove an applied discount from a bill
   * Clears discount fields and recalculates the bill total
   * @param billId Bill ID to remove the discount from
   * @param userId User ID performing the action
   * @param workspaceId Workspace ID for multi-tenancy
   */
  async removeDiscountFromBill(
    billId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    this.logger.log(
      `Removing discount from bill ${billId}, workspace: ${workspaceId}`,
    );

    try {
      const bill = await this.patientBillRepository.findOne({
        where: { id: billId, isActive: true, deletedAt: IsNull() },
      });

      if (!bill) {
        this.logger.error(`Bill not found: ${billId}`);
        throw new NotFoundException(`Bill with ID ${billId} not found`);
      }

      if (!bill.discountId) {
        throw new BadRequestException(
          `Bill with ID ${billId} does not have an applied discount`,
        );
      }

      const previousDiscountId = bill.discountId;
      const previousDiscountAmount = bill.discountAmount;

      // Clear discount fields and recalculate total
      bill.discountId = undefined;
      bill.discountAmount = 0;
      bill.total = Number(bill.subtotal) + Number(bill.taxAmount);
      bill.total = Math.round(bill.total * 100) / 100;

      await this.patientBillRepository.save(bill);

      this.logger.log(`Discount removed from bill ${billId}`);

      // Audit log (non-blocking)
      try {
        await this.auditLogService.log(
          {
            userId,
            action: 'REMOVE_DISCOUNT_FROM_BILL',
            eventType: AuditEventType.UPDATE,
            outcome: AuditOutcome.SUCCESS,
            resourceType: 'PatientBill',
            resourceId: billId,
            previousState: {
              discountId: previousDiscountId,
              discountAmount: previousDiscountAmount,
            },
            metadata: {
              newTotal: bill.total,
              billSubtotal: bill.subtotal,
            },
          },
          workspaceId,
        );
      } catch (auditError) {
        this.logger.error(
          `Failed to create audit log for discount removal - bill: ${billId}`,
          auditError.stack,
        );
      }
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to remove discount from bill ${billId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Map a Discount entity to a DiscountResponseDto
   * @param discount Discount entity
   * @returns DiscountResponseDto
   */
  private mapToDiscountResponse(discount: Discount): DiscountResponseDto {
    const response = new DiscountResponseDto();
    response.id = discount.id;
    response.name = discount.name;
    response.description = discount.description;
    response.discountType = discount.discountType;
    response.value = Number(discount.value);
    response.isPercentage = discount.isPercentage;
    response.maxDiscountAmount = discount.maxDiscountAmount
      ? Number(discount.maxDiscountAmount)
      : undefined;
    response.minPurchaseAmount = discount.minPurchaseAmount
      ? Number(discount.minPurchaseAmount)
      : undefined;
    response.validFrom = discount.validFrom;
    response.validUntil = discount.validUntil;
    response.applicableServices = discount.applicableServices;
    response.applicableDepartments = discount.applicableDepartments;
    response.usageLimit = discount.usageLimit;
    response.usageCount = discount.usageCount;
    response.isActive = discount.isActive;
    response.metadata = discount.metadata;
    response.createdAt = discount.createdAt;
    response.updatedAt = discount.updatedAt;
    return response;
  }

  /**
   * Check if a discount is currently valid based on dates and usage limits
   * @param discount Discount entity to validate
   * @returns Boolean indicating whether the discount is valid
   */
  private isDiscountValid(discount: Discount): boolean {
    const now = new Date();

    // Check active status
    if (!discount.isActive) {
      return false;
    }

    // Check valid date range
    if (discount.validFrom && now < discount.validFrom) {
      return false;
    }

    if (discount.validUntil && now > discount.validUntil) {
      return false;
    }

    // Check usage limit (0 means unlimited)
    if (
      discount.usageLimit &&
      discount.usageLimit > 0 &&
      discount.usageCount >= discount.usageLimit
    ) {
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Auto-applicable discounts
  // ---------------------------------------------------------------------------

  /**
   * Retrieve discounts that should be automatically applied based on the
   * provided billing context. Only returns discounts where the entity-level
   * `isAutoApplicable` metadata flag is `true` AND all eligibility criteria
   * (patient type, department, subtotal threshold, item types, insurance plan)
   * are satisfied.
   *
   * @param context - Billing context attributes used for eligibility matching
   * @param workspaceId - Workspace identifier for multi-tenancy isolation
   * @returns Promise resolving to an array of matching discount DTOs
   */
  async getAutoApplicableDiscounts(
    context: AutoApplicableDiscountContext,
    workspaceId: string,
  ): Promise<DiscountResponseDto[]> {
    this.logger.log(
      `Fetching auto-applicable discounts for workspace: ${workspaceId}`,
    );

    try {
      // Retrieve all currently valid (active, within date range, within usage caps) discounts
      const validDiscounts = await this.discountRepository.findValidDiscounts();

      const autoApplicable = validDiscounts.filter((discount) => {
        // Gate: discount must opt-in to auto-application via metadata flag
        const isAutoApplicable =
          discount.metadata && discount.metadata.isAutoApplicable === true;
        if (!isAutoApplicable) {
          return false;
        }

        // --- Patient type eligibility ---
        if (context.patientType && discount.metadata?.eligiblePatientTypes) {
          const eligible: string[] = Array.isArray(
            discount.metadata.eligiblePatientTypes,
          )
            ? discount.metadata.eligiblePatientTypes
            : [];
          if (eligible.length > 0 && !eligible.includes(context.patientType)) {
            return false;
          }
        }

        // --- Department eligibility ---
        if (context.department && discount.applicableDepartments) {
          const departments: string[] = Array.isArray(
            discount.applicableDepartments,
          )
            ? discount.applicableDepartments
            : [];
          if (
            departments.length > 0 &&
            !departments.includes(context.department)
          ) {
            return false;
          }
        }

        // --- Minimum subtotal threshold ---
        if (
          context.subtotal !== undefined &&
          discount.minPurchaseAmount &&
          context.subtotal < Number(discount.minPurchaseAmount)
        ) {
          return false;
        }

        // --- Item type eligibility ---
        if (
          context.itemTypes &&
          context.itemTypes.length > 0 &&
          discount.metadata?.eligibleItemTypes
        ) {
          const eligibleItems: string[] = Array.isArray(
            discount.metadata.eligibleItemTypes,
          )
            ? discount.metadata.eligibleItemTypes
            : [];
          if (eligibleItems.length > 0) {
            const hasMatchingType = context.itemTypes.some((type) =>
              eligibleItems.includes(type),
            );
            if (!hasMatchingType) {
              return false;
            }
          }
        }

        // --- Insurance plan eligibility ---
        if (
          context.insurancePlanId &&
          discount.metadata?.eligibleInsurancePlanIds
        ) {
          const eligiblePlans: string[] = Array.isArray(
            discount.metadata.eligibleInsurancePlanIds,
          )
            ? discount.metadata.eligibleInsurancePlanIds
            : [];
          if (
            eligiblePlans.length > 0 &&
            !eligiblePlans.includes(context.insurancePlanId)
          ) {
            return false;
          }
        }

        return true;
      });

      this.logger.log(
        `Found ${autoApplicable.length} auto-applicable discounts for workspace: ${workspaceId}`,
      );

      return autoApplicable.map((d) => this.mapToDiscountResponse(d));
    } catch (error) {
      this.logger.error(
        `Failed to fetch auto-applicable discounts for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Discount usage analytics
  // ---------------------------------------------------------------------------

  /**
   * Produce aggregated analytics on discount usage within a date range.
   * Joins `patient_bills` with `discounts` to compute total usage count,
   * total monetary discount value, per-discount breakdowns, and the average
   * discount per application.
   *
   * @param startDate - Inclusive start of the analytics window
   * @param endDate   - Inclusive end of the analytics window
   * @param workspaceId - Workspace identifier for multi-tenancy isolation
   * @returns Promise resolving to the analytics summary
   */
  async getDiscountUsageAnalytics(
    startDate: Date,
    endDate: Date,
    workspaceId: string,
  ): Promise<DiscountUsageAnalytics> {
    this.logger.log(
      `Generating discount usage analytics from ${startDate.toISOString()} to ${endDate.toISOString()}, workspace: ${workspaceId}`,
    );

    try {
      // Validate date range
      if (startDate >= endDate) {
        throw new BadRequestException('startDate must be before endDate');
      }

      // Aggregate per-discount usage via QueryBuilder
      const perDiscountRows: Array<{
        discountId: string;
        discountName: string;
        usageCount: string;
        totalAmount: string;
      }> = await this.patientBillRepository
        .createQueryBuilder('bill')
        .innerJoin(Discount, 'discount', 'discount.id = bill.discountId')
        .select('bill.discountId', 'discountId')
        .addSelect('discount.name', 'discountName')
        .addSelect('COUNT(bill.id)', 'usageCount')
        .addSelect('COALESCE(SUM(bill.discountAmount), 0)', 'totalAmount')
        .where('bill.discountId IS NOT NULL')
        .andWhere('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.issuedAt BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .groupBy('bill.discountId')
        .addGroupBy('discount.name')
        .orderBy('usageCount', 'DESC')
        .getRawMany();

      // Derive top-level aggregates from per-discount rows
      let totalUsageCount = 0;
      let totalDiscountAmount = 0;

      const topDiscountsByUsage = perDiscountRows.map((row) => {
        const usageCount = Number(row.usageCount);
        const totalAmount =
          Math.round(Number(row.totalAmount) * 100) / 100;

        totalUsageCount += usageCount;
        totalDiscountAmount += totalAmount;

        return {
          discountId: row.discountId,
          name: row.discountName,
          usageCount,
          totalAmount,
        };
      });

      // Round aggregate monetary value
      totalDiscountAmount =
        Math.round(totalDiscountAmount * 100) / 100;

      const averageDiscountPerUse =
        totalUsageCount > 0
          ? Math.round((totalDiscountAmount / totalUsageCount) * 100) / 100
          : 0;

      this.logger.log(
        `Discount analytics complete - ${totalUsageCount} uses totalling ${totalDiscountAmount}, workspace: ${workspaceId}`,
      );

      return {
        totalUsageCount,
        totalDiscountAmount,
        averageDiscountPerUse,
        topDiscountsByUsage,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Failed to generate discount usage analytics for workspace: ${workspaceId}`,
        error.stack,
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk status update
  // ---------------------------------------------------------------------------

  /**
   * Activate or deactivate multiple discounts in a single operation.
   * Each discount is individually validated: it must exist in the workspace,
   * and deactivation is blocked when the discount is referenced by active
   * (non-cancelled, non-voided) bills.
   *
   * @param discountIds  - Array of discount IDs to update
   * @param isActive     - Target active state (`true` = activate, `false` = deactivate)
   * @param userId       - User performing the bulk operation
   * @param workspaceId  - Workspace identifier for multi-tenancy isolation
   * @returns Promise resolving to a summary of successes and failures
   */
  async bulkUpdateDiscountStatus(
    discountIds: string[],
    isActive: boolean,
    userId: string,
    workspaceId: string,
  ): Promise<BulkUpdateResult> {
    this.logger.log(
      `Bulk updating ${discountIds.length} discounts to isActive=${isActive}, workspace: ${workspaceId}`,
    );

    const results: Array<{ id: string; success: boolean; message?: string }> =
      [];
    let updated = 0;
    let failed = 0;

    for (const discountId of discountIds) {
      try {
        // Verify discount exists
        const discount = await this.discountRepository.findOne({
          where: { id: discountId, deletedAt: IsNull() },
        });

        if (!discount) {
          failed++;
          results.push({
            id: discountId,
            success: false,
            message: `Discount with ID ${discountId} not found`,
          });
          continue;
        }

        // Guard: prevent deactivation of discounts currently in use on open bills
        if (!isActive) {
          const inUse = await this.isDiscountInUse(discountId, workspaceId);
          if (inUse) {
            failed++;
            results.push({
              id: discountId,
              success: false,
              message: `Discount "${discount.name}" is currently referenced by active bills and cannot be deactivated`,
            });
            continue;
          }
        }

        // Skip redundant updates
        if (discount.isActive === isActive) {
          updated++;
          results.push({
            id: discountId,
            success: true,
            message: `Discount already ${isActive ? 'active' : 'inactive'}`,
          });
          continue;
        }

        // Apply status change
        discount.isActive = isActive;
        await this.discountRepository.save(discount);

        updated++;
        results.push({ id: discountId, success: true });

        // Fire-and-forget audit log per discount
        this.auditLogService
          .log(
            {
              userId,
              action: isActive
                ? 'ACTIVATE_DISCOUNT'
                : 'DEACTIVATE_DISCOUNT',
              eventType: AuditEventType.UPDATE,
              outcome: AuditOutcome.SUCCESS,
              resourceType: 'Discount',
              resourceId: discountId,
              metadata: {
                name: discount.name,
                bulkOperation: true,
                newStatus: isActive,
              },
            },
            workspaceId,
          )
          .catch((auditError) => {
            this.logger.error(
              `Failed to create audit log for bulk discount status update - ID: ${discountId}`,
              auditError.stack,
            );
          });
      } catch (error) {
        failed++;
        results.push({
          id: discountId,
          success: false,
          message:
            error instanceof Error ? error.message : 'Unknown error occurred',
        });
        this.logger.error(
          `Error updating discount ${discountId} in bulk operation`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    this.logger.log(
      `Bulk discount status update complete - updated: ${updated}, failed: ${failed}, workspace: ${workspaceId}`,
    );

    // Fire-and-forget summary audit log for the bulk operation
    this.auditLogService
      .log(
        {
          userId,
          action: 'BULK_UPDATE_DISCOUNT_STATUS',
          eventType: AuditEventType.UPDATE,
          outcome:
            failed === 0 ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
          resourceType: 'Discount',
          resourceId: 'bulk',
          metadata: {
            totalRequested: discountIds.length,
            updated,
            failed,
            targetStatus: isActive,
          },
        },
        workspaceId,
      )
      .catch((auditError) => {
        this.logger.error(
          'Failed to create audit log for bulk discount status update summary',
          auditError.stack,
        );
      });

    return { updated, failed, results };
  }

  // ---------------------------------------------------------------------------
  // Private helpers — eligibility & in-use checks
  // ---------------------------------------------------------------------------

  /**
   * Determine whether a discount is currently referenced by any active
   * (non-cancelled, non-voided, non-refunded) patient bills.
   *
   * @param discountId  - The discount ID to check
   * @param workspaceId - Workspace identifier for multi-tenancy isolation
   * @returns `true` if at least one open bill references the discount
   */
  private async isDiscountInUse(
    discountId: string,
    workspaceId: string,
  ): Promise<boolean> {
    this.logger.log(
      `Checking if discount ${discountId} is in use, workspace: ${workspaceId}`,
    );

    try {
      const count = await this.patientBillRepository
        .createQueryBuilder('bill')
        .where('bill.discountId = :discountId', { discountId })
        .andWhere('bill.isActive = :isActive', { isActive: true })
        .andWhere('bill.deletedAt IS NULL')
        .andWhere('bill.status NOT IN (:...terminalStatuses)', {
          terminalStatuses: [
            BillStatus.CANCELLED,
            BillStatus.VOIDED,
            BillStatus.REFUNDED,
          ],
        })
        .getCount();

      return count > 0;
    } catch (error) {
      this.logger.error(
        `Failed to check if discount ${discountId} is in use`,
        error.stack,
      );
      // Default to "in use" when the check itself fails to protect data integrity
      return true;
    }
  }

  /**
   * Evaluate whether a discount satisfies all eligibility criteria for a
   * specific patient bill. Checks include:
   *  - Minimum purchase amount vs. bill subtotal
   *  - Maximum discount amount cap
   *  - Patient type (via bill metadata)
   *  - Department match
   *  - Applicable item types (via bill metadata)
   *
   * @param discount - The Discount entity to evaluate
   * @param bill     - The PatientBill entity to evaluate against
   * @returns An object with `isEligible` and an optional human-readable `reason`
   */
  private validateDiscountEligibility(
    discount: Discount,
    bill: PatientBill,
  ): DiscountEligibilityResult {
    // --- Temporal & usage validity ---
    if (!this.isDiscountValid(discount)) {
      return {
        isEligible: false,
        reason: `Discount "${discount.name}" is expired, inactive, or has exceeded its usage limit`,
      };
    }

    // --- Minimum purchase amount ---
    if (
      discount.minPurchaseAmount &&
      Number(bill.subtotal) < Number(discount.minPurchaseAmount)
    ) {
      return {
        isEligible: false,
        reason: `Bill subtotal (${bill.subtotal}) is below the minimum purchase amount (${discount.minPurchaseAmount})`,
      };
    }

    // --- Maximum discount amount vs. bill subtotal sanity check ---
    if (
      discount.maxDiscountAmount &&
      Number(discount.maxDiscountAmount) <= 0
    ) {
      return {
        isEligible: false,
        reason: 'Discount has an invalid maximum discount amount configuration',
      };
    }

    // --- Patient type eligibility (stored in discount metadata) ---
    if (discount.metadata?.eligiblePatientTypes) {
      const eligiblePatientTypes: string[] = Array.isArray(
        discount.metadata.eligiblePatientTypes,
      )
        ? discount.metadata.eligiblePatientTypes
        : [];

      if (eligiblePatientTypes.length > 0) {
        const billPatientType =
          bill.metadata?.patientType as string | undefined;

        if (
          !billPatientType ||
          !eligiblePatientTypes.includes(billPatientType)
        ) {
          return {
            isEligible: false,
            reason: `Patient type "${billPatientType || 'unknown'}" is not eligible for discount "${discount.name}". Eligible types: ${eligiblePatientTypes.join(', ')}`,
          };
        }
      }
    }

    // --- Department eligibility ---
    if (discount.applicableDepartments) {
      const departments: string[] = Array.isArray(
        discount.applicableDepartments,
      )
        ? discount.applicableDepartments
        : [];

      if (departments.length > 0 && bill.department) {
        if (!departments.includes(bill.department)) {
          return {
            isEligible: false,
            reason: `Department "${bill.department}" is not eligible for discount "${discount.name}". Eligible departments: ${departments.join(', ')}`,
          };
        }
      } else if (departments.length > 0 && !bill.department) {
        return {
          isEligible: false,
          reason: `Bill does not specify a department, but discount "${discount.name}" is restricted to: ${departments.join(', ')}`,
        };
      }
    }

    // --- Item type eligibility (stored in discount metadata) ---
    if (discount.metadata?.eligibleItemTypes) {
      const eligibleItemTypes: string[] = Array.isArray(
        discount.metadata.eligibleItemTypes,
      )
        ? discount.metadata.eligibleItemTypes
        : [];

      if (eligibleItemTypes.length > 0) {
        const billItemTypes = bill.metadata?.itemTypes as
          | string[]
          | undefined;

        if (!billItemTypes || billItemTypes.length === 0) {
          return {
            isEligible: false,
            reason: `Bill does not specify item types, but discount "${discount.name}" is restricted to: ${eligibleItemTypes.join(', ')}`,
          };
        }

        const hasMatchingType = billItemTypes.some((type) =>
          eligibleItemTypes.includes(type),
        );
        if (!hasMatchingType) {
          return {
            isEligible: false,
            reason: `None of the bill item types (${billItemTypes.join(', ')}) match the eligible types for discount "${discount.name}": ${eligibleItemTypes.join(', ')}`,
          };
        }
      }
    }

    return { isEligible: true };
  }
}
