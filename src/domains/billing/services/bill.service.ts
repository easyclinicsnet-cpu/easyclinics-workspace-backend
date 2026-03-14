import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

// Repositories
import { PatientBillRepository } from '../repositories/patient-bill.repository';
import { BillItemRepository } from '../repositories/bill-item.repository';
import { DiscountRepository } from '../repositories/discount.repository';
import { TaxRepository } from '../repositories/tax.repository';

// Request DTOs
import { CreateBillDto, UpdateBillDto, BillQueryDto } from '../dto/requests/bill.dto';
import { CreateBillItemDto, UpdateBillItemDto } from '../dto/requests/bill-item.dto';

// Response DTOs
import {
  BillResponseDto,
  BillSummaryDto,
  PaginatedBillResponseDto,
  BillAnalyticsDto,
} from '../dto/responses/bill.dto';
import { BillItemResponseDto } from '../dto/responses/bill-item.dto';

// Entities
import { PatientBill } from '../entities/patient-bill.entity';
import { BillItem } from '../entities/bill-item.entity';
import { Discount } from '../entities/discount.entity';
import { Tax } from '../entities/tax.entity';

// Enums
import { BillStatus, AuditEventType, AuditOutcome } from '../../../common/enums';

// Constants
import {
  BILLING_DEFAULTS,
  BILL_STATUS_TRANSITIONS,
  BILLING_ERROR_CODES,
} from '../utils/billing.constants';

// Services
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';

/**
 * BillService
 *
 * Core billing service for patient bill lifecycle management.
 * Handles creation, modification, status transitions, line-item management,
 * discount/tax application, and total recalculation.
 *
 * All operations are multi-tenant (scoped by workspaceId) and produce
 * HIPAA-compliant audit log entries for every mutating action.
 */
@Injectable()
export class BillService {
  constructor(
    private readonly patientBillRepository: PatientBillRepository,
    private readonly billItemRepository: BillItemRepository,
    private readonly discountRepository: DiscountRepository,
    private readonly taxRepository: TaxRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.logger.setContext('BillService');
  }

  // ---------------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------------

  /**
   * Create a new patient bill, optionally with line items, discount, and tax.
   * The entire operation runs inside a database transaction to guarantee atomicity.
   *
   * @param dto       Bill creation payload
   * @param userId    Authenticated user performing the action
   * @param workspaceId  Tenant workspace identifier
   * @returns Fully hydrated bill response DTO
   */
  async createBill(
    dto: CreateBillDto,
    userId: string,
    workspaceId: string,
  ): Promise<BillResponseDto> {
    this.logger.log(
      `Creating bill for patient ${dto.patientId} in workspace ${workspaceId}`,
    );

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // 1. Generate a unique bill number
        const billNumber = await this.patientBillRepository.generateBillNumber();

        // 2. Resolve optional discount
        let discount: Discount | null = null;
        if (dto.discountId) {
          discount = await manager.findOne(Discount, {
            where: { id: dto.discountId, isActive: true },
          });
          if (!discount) {
            throw new NotFoundException(
              `Discount not found: ${dto.discountId}`,
            );
          }
          this.validateDiscount(discount);
        }

        // 3. Resolve optional tax
        let tax: Tax | null = null;
        if (dto.taxId) {
          tax = await manager.findOne(Tax, {
            where: { id: dto.taxId, isActive: true },
          });
          if (!tax) {
            throw new NotFoundException(`Tax not found: ${dto.taxId}`);
          }
        }

        // 4. Build the due date
        const dueDate = dto.dueDate
          ? new Date(dto.dueDate)
          : this.buildDefaultDueDate();

        // 5. Create the PatientBill entity
        const bill = manager.create(PatientBill, {
          workspaceId,
          billNumber,
          patientId: dto.patientId,
          appointmentId: dto.appointmentId,
          department: dto.department,
          discountId: dto.discountId,
          taxId: dto.taxId,
          status: BillStatus.DRAFT,
          issuedAt: new Date(),
          dueDate,
          notes: dto.notes,
          metadata: dto.metadata,
          subtotal: 0,
          discountAmount: 0,
          taxAmount: 0,
          total: 0,
        });

        const savedBill = await manager.save(PatientBill, bill);

        // 6. Create line items if provided
        let items: BillItem[] = [];
        if (dto.items && dto.items.length > 0) {
          if (dto.items.length > BILLING_DEFAULTS.MAX_ITEMS_PER_BILL) {
            throw new BadRequestException(
              `Cannot add more than ${BILLING_DEFAULTS.MAX_ITEMS_PER_BILL} items to a single bill`,
            );
          }

          const itemEntities = dto.items.map((itemDto) => {
            const itemTotal = Number(
              (itemDto.quantity * itemDto.unitPrice).toFixed(2),
            );
            return manager.create(BillItem, {
              workspaceId,
              billId: savedBill.id,
              description: itemDto.description,
              quantity: itemDto.quantity,
              unitPrice: itemDto.unitPrice,
              totalPrice: itemTotal,
              department: itemDto.department,
              medicationItemId: itemDto.medicationItemId,
              consumableItemId: itemDto.consumableItemId,
              batchId: itemDto.batchId,
              actualUnitCost: itemDto.actualUnitCost,
              metadata: itemDto.metadata,
            });
          });

          items = await manager.save(BillItem, itemEntities);
        }

        // 7. Recalculate bill totals
        this.recalculateBillTotals(savedBill, items, discount, tax);
        const finalBill = await manager.save(PatientBill, savedBill);

        // 8. Increment discount usage if applicable
        if (discount) {
          await this.discountRepository.incrementUsage(discount.id);
        }

        return { bill: finalBill, items };
      });

      // Audit log (non-blocking)
      this.emitAuditLog(
        userId,
        'CREATE_BILL',
        AuditEventType.CREATE,
        AuditOutcome.SUCCESS,
        'PatientBill',
        result.bill.id,
        dto.patientId,
        workspaceId,
        undefined,
        {
          billNumber: result.bill.billNumber,
          total: result.bill.total,
          itemCount: result.items.length,
        },
      );

      this.logger.log(
        `Bill created successfully: ${result.bill.billNumber} (${result.bill.id})`,
      );

      return this.mapToBillResponse(result.bill, result.items);
    } catch (error) {
      this.emitAuditLog(
        userId,
        'CREATE_BILL',
        AuditEventType.CREATE,
        AuditOutcome.FAILURE,
        'PatientBill',
        undefined,
        dto.patientId,
        workspaceId,
        undefined,
        { error: error.message },
      );
      throw error;
    }
  }

  /**
   * Retrieve a single bill by ID with all relations.
   *
   * @param id           Bill UUID
   * @param workspaceId  Tenant workspace identifier
   * @returns Bill response DTO
   * @throws NotFoundException when the bill does not exist
   */
  async getBillById(
    id: string,
    workspaceId: string,
  ): Promise<BillResponseDto> {
    this.logger.log(`Fetching bill ${id} for workspace ${workspaceId}`);

    const bill = await this.patientBillRepository.findByIdWithRelations(id);

    if (!bill) {
      this.logger.warn(`Bill not found: ${id}`);
      throw new NotFoundException(BILLING_ERROR_CODES.BILL_NOT_FOUND);
    }

    const items = await this.billItemRepository.findByBill(id);

    return this.mapToBillResponse(bill, items);
  }

  /**
   * List bills with filtering, searching, and pagination.
   *
   * @param query        Query filters (patient, status, department, dates, overdue)
   * @param workspaceId  Tenant workspace identifier
   * @returns Paginated bill response
   */
  async getBills(
    query: BillQueryDto,
    workspaceId: string,
  ): Promise<PaginatedBillResponseDto> {
    this.logger.log(
      `Querying bills for workspace ${workspaceId} with filters: ${JSON.stringify(query)}`,
    );

    const page = query.page || 1;
    const limit = query.limit || 10;

    const qb = this.patientBillRepository
      .createQueryBuilder('bill')
      .leftJoinAndSelect('bill.patient', 'patient')
      .leftJoinAndSelect('bill.appointment', 'appointment')
      .where('bill.isActive = :isActive', { isActive: true });

    // Filter: patient
    if (query.patientId) {
      qb.andWhere('bill.patientId = :patientId', {
        patientId: query.patientId,
      });
    }

    // Filter: status
    if (query.status) {
      qb.andWhere('bill.status = :status', { status: query.status });
    }

    // Filter: department
    if (query.department) {
      qb.andWhere('bill.department = :department', {
        department: query.department,
      });
    }

    // Filter: date range
    if (query.startDate) {
      qb.andWhere('bill.issuedAt >= :startDate', {
        startDate: new Date(query.startDate),
      });
    }
    if (query.endDate) {
      qb.andWhere('bill.issuedAt <= :endDate', {
        endDate: new Date(query.endDate),
      });
    }

    // Filter: overdue
    if (query.overdue) {
      qb.andWhere('bill.dueDate < :now', { now: new Date() })
        .andWhere('bill.status IN (:...overdueStatuses)', {
          overdueStatuses: [BillStatus.PENDING, BillStatus.PARTIALLY_PAID],
        });
    }

    // Search
    if (query.search) {
      qb.andWhere(
        '(bill.billNumber LIKE :search OR patient.firstName LIKE :search OR patient.lastName LIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    // Sorting
    const sortBy = query.sortBy || 'bill.createdAt';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(
      sortBy.includes('.') ? sortBy : `bill.${sortBy}`,
      sortOrder,
    );

    // Pagination
    qb.skip((page - 1) * limit).take(limit);

    const [bills, total] = await qb.getManyAndCount();

    // Load items for each bill
    const data: BillResponseDto[] = await Promise.all(
      bills.map(async (bill) => {
        const items = await this.billItemRepository.findByBill(bill.id);
        return this.mapToBillResponse(bill, items);
      }),
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update an existing bill. Supports partial updates and status transitions.
   *
   * @param id           Bill UUID
   * @param dto          Fields to update
   * @param userId       Authenticated user performing the action
   * @param workspaceId  Tenant workspace identifier
   * @returns Updated bill response DTO
   */
  async updateBill(
    id: string,
    dto: UpdateBillDto,
    userId: string,
    workspaceId: string,
  ): Promise<BillResponseDto> {
    this.logger.log(`Updating bill ${id} in workspace ${workspaceId}`);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const bill = await manager.findOne(PatientBill, {
          where: { id, isActive: true },
        });

        if (!bill) {
          throw new NotFoundException(BILLING_ERROR_CODES.BILL_NOT_FOUND);
        }

        const previousState = {
          status: bill.status,
          department: bill.department,
          discountId: bill.discountId,
          taxId: bill.taxId,
          total: bill.total,
          notes: bill.notes,
        };

        // Validate status transition if status is being changed
        if (dto.status && dto.status !== bill.status) {
          if (!this.validateStatusTransition(bill.status, dto.status)) {
            throw new ConflictException(
              `${BILLING_ERROR_CODES.INVALID_STATUS_TRANSITION}: Cannot transition from ${bill.status} to ${dto.status}`,
            );
          }
          bill.status = dto.status;
        }

        // Apply simple field updates
        if (dto.department !== undefined) bill.department = dto.department;
        if (dto.dueDate !== undefined) bill.dueDate = new Date(dto.dueDate);
        if (dto.notes !== undefined) bill.notes = dto.notes;
        if (dto.metadata !== undefined) bill.metadata = dto.metadata;

        // If discount or tax changed, recalculate totals
        let needsRecalculation = false;

        if (dto.discountId !== undefined && dto.discountId !== bill.discountId) {
          bill.discountId = dto.discountId;
          needsRecalculation = true;
        }
        if (dto.taxId !== undefined && dto.taxId !== bill.taxId) {
          bill.taxId = dto.taxId;
          needsRecalculation = true;
        }

        if (needsRecalculation) {
          const items = await this.billItemRepository.findByBill(id);

          let discount: Discount | null = null;
          if (bill.discountId) {
            discount = await manager.findOne(Discount, {
              where: { id: bill.discountId, isActive: true },
            });
            if (!discount) {
              throw new NotFoundException(
                `Discount not found: ${bill.discountId}`,
              );
            }
          }

          let tax: Tax | null = null;
          if (bill.taxId) {
            tax = await manager.findOne(Tax, {
              where: { id: bill.taxId, isActive: true },
            });
            if (!tax) {
              throw new NotFoundException(`Tax not found: ${bill.taxId}`);
            }
          }

          this.recalculateBillTotals(bill, items, discount, tax);
        }

        const savedBill = await manager.save(PatientBill, bill);

        return { bill: savedBill, previousState };
      });

      const items = await this.billItemRepository.findByBill(id);

      // Audit log (non-blocking)
      this.emitAuditLog(
        userId,
        'UPDATE_BILL',
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'PatientBill',
        id,
        result.bill.patientId,
        workspaceId,
        result.previousState,
        {
          status: result.bill.status,
          total: result.bill.total,
        },
      );

      this.logger.log(`Bill updated successfully: ${id}`);

      return this.mapToBillResponse(result.bill, items);
    } catch (error) {
      this.emitAuditLog(
        userId,
        'UPDATE_BILL',
        AuditEventType.UPDATE,
        AuditOutcome.FAILURE,
        'PatientBill',
        id,
        undefined,
        workspaceId,
        undefined,
        { error: error.message },
      );
      throw error;
    }
  }

  /**
   * Cancel a bill. Only bills that are not already in a terminal state
   * (CANCELLED, VOIDED, REFUNDED) can be cancelled.
   *
   * @param id           Bill UUID
   * @param userId       Authenticated user performing the action
   * @param workspaceId  Tenant workspace identifier
   * @returns Cancelled bill response DTO
   */
  async cancelBill(
    id: string,
    userId: string,
    workspaceId: string,
  ): Promise<BillResponseDto> {
    this.logger.log(`Cancelling bill ${id} in workspace ${workspaceId}`);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const bill = await manager.findOne(PatientBill, {
          where: { id, isActive: true },
        });

        if (!bill) {
          throw new NotFoundException(BILLING_ERROR_CODES.BILL_NOT_FOUND);
        }

        const terminalStatuses: BillStatus[] = [
          BillStatus.CANCELLED,
          BillStatus.VOIDED,
          BillStatus.REFUNDED,
        ];

        if (terminalStatuses.includes(bill.status)) {
          throw new ConflictException(
            `${BILLING_ERROR_CODES.BILL_CANCELLED}: Bill is already in terminal status ${bill.status}`,
          );
        }

        if (!this.validateStatusTransition(bill.status, BillStatus.CANCELLED)) {
          throw new ConflictException(
            `${BILLING_ERROR_CODES.INVALID_STATUS_TRANSITION}: Cannot cancel a bill with status ${bill.status}`,
          );
        }

        const previousStatus = bill.status;
        bill.status = BillStatus.CANCELLED;

        const savedBill = await manager.save(PatientBill, bill);

        return { bill: savedBill, previousStatus };
      });

      const items = await this.billItemRepository.findByBill(id);

      // Audit log (non-blocking)
      this.emitAuditLog(
        userId,
        'CANCEL_BILL',
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'PatientBill',
        id,
        result.bill.patientId,
        workspaceId,
        { status: result.previousStatus },
        { status: BillStatus.CANCELLED },
      );

      this.logger.log(`Bill cancelled successfully: ${id}`);

      return this.mapToBillResponse(result.bill, items);
    } catch (error) {
      this.emitAuditLog(
        userId,
        'CANCEL_BILL',
        AuditEventType.UPDATE,
        AuditOutcome.FAILURE,
        'PatientBill',
        id,
        undefined,
        workspaceId,
        undefined,
        { error: error.message },
      );
      throw error;
    }
  }

  /**
   * Add a line item to an existing bill. The bill must be in an editable
   * state (DRAFT or PENDING). Bill totals are recalculated after insertion.
   *
   * @param billId       Parent bill UUID
   * @param dto          Item creation payload
   * @param userId       Authenticated user
   * @param workspaceId  Tenant workspace identifier
   * @returns Newly created bill item response DTO
   */
  async addBillItem(
    billId: string,
    dto: CreateBillItemDto,
    userId: string,
    workspaceId: string,
  ): Promise<BillResponseDto> {
    this.logger.log(`Adding item to bill ${billId} in workspace ${workspaceId}`);

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // 1. Validate bill exists and is editable
        const bill = await manager.findOne(PatientBill, {
          where: { id: billId, isActive: true },
        });

        if (!bill) {
          throw new NotFoundException(BILLING_ERROR_CODES.BILL_NOT_FOUND);
        }

        const editableStatuses: BillStatus[] = [
          BillStatus.DRAFT,
          BillStatus.PENDING,
        ];
        if (!editableStatuses.includes(bill.status)) {
          throw new BadRequestException(
            `Cannot add items to a bill with status ${bill.status}. Bill must be DRAFT or PENDING.`,
          );
        }

        // 2. Enforce max items limit
        const existingItemCount = await manager.count(BillItem, {
          where: { billId, isActive: true },
        });
        if (existingItemCount >= BILLING_DEFAULTS.MAX_ITEMS_PER_BILL) {
          throw new BadRequestException(
            `Bill has reached the maximum of ${BILLING_DEFAULTS.MAX_ITEMS_PER_BILL} items`,
          );
        }

        // 3. Create the item
        const itemTotal = Number(
          (dto.quantity * dto.unitPrice).toFixed(2),
        );

        const item = manager.create(BillItem, {
          workspaceId,
          billId,
          description: dto.description,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          totalPrice: itemTotal,
          department: dto.department,
          medicationItemId: dto.medicationItemId,
          consumableItemId: dto.consumableItemId,
          batchId: dto.batchId,
          actualUnitCost: dto.actualUnitCost,
          metadata: dto.metadata,
        });

        const savedItem = await manager.save(BillItem, item);

        // 4. Recalculate bill totals
        const allItems = await manager.find(BillItem, {
          where: { billId, isActive: true },
        });

        let discount: Discount | null = null;
        if (bill.discountId) {
          discount = await manager.findOne(Discount, {
            where: { id: bill.discountId, isActive: true },
          });
        }

        let tax: Tax | null = null;
        if (bill.taxId) {
          tax = await manager.findOne(Tax, {
            where: { id: bill.taxId, isActive: true },
          });
        }

        this.recalculateBillTotals(bill, allItems, discount, tax);
        await manager.save(PatientBill, bill);

        return { bill, items: allItems, savedItem };
      });

      // Audit log (non-blocking)
      this.emitAuditLog(
        userId,
        'ADD_BILL_ITEM',
        AuditEventType.CREATE,
        AuditOutcome.SUCCESS,
        'BillItem',
        result.savedItem.id,
        undefined,
        workspaceId,
        undefined,
        {
          billId,
          description: result.savedItem.description,
          total: result.savedItem.totalPrice,
        },
      );

      this.logger.log(`Item added to bill ${billId}: ${result.savedItem.id}`);

      return this.mapToBillResponse(result.bill, result.items);
    } catch (error) {
      this.emitAuditLog(
        userId,
        'ADD_BILL_ITEM',
        AuditEventType.CREATE,
        AuditOutcome.FAILURE,
        'BillItem',
        undefined,
        undefined,
        workspaceId,
        undefined,
        { billId, error: error.message },
      );
      throw error;
    }
  }

  /**
   * Update an existing line item on a bill. Bill totals are recalculated
   * after the update.
   *
   * @param billId       Parent bill UUID
   * @param itemId       Item UUID to update
   * @param dto          Fields to update
   * @param userId       Authenticated user
   * @param workspaceId  Tenant workspace identifier
   * @returns Updated bill item response DTO
   */
  async updateBillItem(
    billId: string,
    itemId: string,
    dto: UpdateBillItemDto,
    userId: string,
    workspaceId: string,
  ): Promise<BillResponseDto> {
    this.logger.log(
      `Updating item ${itemId} on bill ${billId} in workspace ${workspaceId}`,
    );

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // 1. Find the bill
        const bill = await manager.findOne(PatientBill, {
          where: { id: billId, isActive: true },
        });

        if (!bill) {
          throw new NotFoundException(BILLING_ERROR_CODES.BILL_NOT_FOUND);
        }

        const editableStatuses: BillStatus[] = [
          BillStatus.DRAFT,
          BillStatus.PENDING,
        ];
        if (!editableStatuses.includes(bill.status)) {
          throw new BadRequestException(
            `Cannot update items on a bill with status ${bill.status}. Bill must be DRAFT or PENDING.`,
          );
        }

        // 2. Find the item and validate it belongs to this bill
        const item = await manager.findOne(BillItem, {
          where: { id: itemId, billId, isActive: true },
        });

        if (!item) {
          throw new NotFoundException(
            `Bill item ${itemId} not found on bill ${billId}`,
          );
        }

        const previousState = {
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        };

        // 3. Apply updates
        if (dto.description    !== undefined) item.description    = dto.description;
        if (dto.quantity       !== undefined) item.quantity       = dto.quantity;
        if (dto.unitPrice      !== undefined) item.unitPrice      = dto.unitPrice;
        if (dto.department     !== undefined) item.department     = dto.department;
        if (dto.batchId        !== undefined) item.batchId        = dto.batchId;
        if (dto.actualUnitCost !== undefined) item.actualUnitCost = dto.actualUnitCost;
        if (dto.metadata       !== undefined) item.metadata       = dto.metadata;

        // Recalculate item total — total is always derived, never set directly
        item.totalPrice = Number((item.quantity * item.unitPrice).toFixed(2));

        const savedItem = await manager.save(BillItem, item);

        // 4. Recalculate bill totals
        const allItems = await manager.find(BillItem, {
          where: { billId, isActive: true },
        });

        let discount: Discount | null = null;
        if (bill.discountId) {
          discount = await manager.findOne(Discount, {
            where: { id: bill.discountId, isActive: true },
          });
        }

        let tax: Tax | null = null;
        if (bill.taxId) {
          tax = await manager.findOne(Tax, {
            where: { id: bill.taxId, isActive: true },
          });
        }

        this.recalculateBillTotals(bill, allItems, discount, tax);
        await manager.save(PatientBill, bill);

        return { bill, items: allItems, item: savedItem, previousState };
      });

      // Audit log (non-blocking)
      this.emitAuditLog(
        userId,
        'UPDATE_BILL_ITEM',
        AuditEventType.UPDATE,
        AuditOutcome.SUCCESS,
        'BillItem',
        itemId,
        undefined,
        workspaceId,
        result.previousState,
        {
          description: result.item.description,
          quantity: result.item.quantity,
          unitPrice: result.item.unitPrice,
          totalPrice: result.item.totalPrice,
        },
      );

      this.logger.log(`Item ${itemId} updated on bill ${billId}`);

      return this.mapToBillResponse(result.bill, result.items);
    } catch (error) {
      this.emitAuditLog(
        userId,
        'UPDATE_BILL_ITEM',
        AuditEventType.UPDATE,
        AuditOutcome.FAILURE,
        'BillItem',
        itemId,
        undefined,
        workspaceId,
        undefined,
        { billId, error: error.message },
      );
      throw error;
    }
  }

  /**
   * Soft-delete a line item from a bill and recalculate totals.
   *
   * @param billId       Parent bill UUID
   * @param itemId       Item UUID to remove
   * @param userId       Authenticated user
   * @param workspaceId  Tenant workspace identifier
   */
  async removeBillItem(
    billId: string,
    itemId: string,
    userId: string,
    workspaceId: string,
  ): Promise<BillResponseDto> {
    this.logger.log(
      `Removing item ${itemId} from bill ${billId} in workspace ${workspaceId}`,
    );

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // 1. Find the bill
        const bill = await manager.findOne(PatientBill, {
          where: { id: billId, isActive: true },
        });

        if (!bill) {
          throw new NotFoundException(BILLING_ERROR_CODES.BILL_NOT_FOUND);
        }

        const editableStatuses: BillStatus[] = [
          BillStatus.DRAFT,
          BillStatus.PENDING,
        ];
        if (!editableStatuses.includes(bill.status)) {
          throw new BadRequestException(
            `Cannot remove items from a bill with status ${bill.status}. Bill must be DRAFT or PENDING.`,
          );
        }

        // 2. Find and soft-delete the item
        const item = await manager.findOne(BillItem, {
          where: { id: itemId, billId, isActive: true },
        });

        if (!item) {
          throw new NotFoundException(
            `Bill item ${itemId} not found on bill ${billId}`,
          );
        }

        item.isActive = false;
        item.isDeleted = true;
        item.deletedAt = new Date();
        item.deletedBy = userId;
        await manager.save(BillItem, item);

        // 3. Recalculate bill totals with remaining active items
        const remainingItems = await manager.find(BillItem, {
          where: { billId, isActive: true },
        });

        let discount: Discount | null = null;
        if (bill.discountId) {
          discount = await manager.findOne(Discount, {
            where: { id: bill.discountId, isActive: true },
          });
        }

        let tax: Tax | null = null;
        if (bill.taxId) {
          tax = await manager.findOne(Tax, {
            where: { id: bill.taxId, isActive: true },
          });
        }

        this.recalculateBillTotals(bill, remainingItems, discount, tax);
        await manager.save(PatientBill, bill);

        return { bill, items: remainingItems };
      });

      // Audit log (non-blocking)
      this.emitAuditLog(
        userId,
        'REMOVE_BILL_ITEM',
        AuditEventType.DELETE,
        AuditOutcome.SUCCESS,
        'BillItem',
        itemId,
        undefined,
        workspaceId,
        undefined,
        { billId },
      );

      this.logger.log(`Item ${itemId} removed from bill ${billId}`);

      return this.mapToBillResponse(result.bill, result.items);
    } catch (error) {
      this.emitAuditLog(
        userId,
        'REMOVE_BILL_ITEM',
        AuditEventType.DELETE,
        AuditOutcome.FAILURE,
        'BillItem',
        itemId,
        undefined,
        workspaceId,
        undefined,
        { billId, error: error.message },
      );
      throw error;
    }
  }

  /**
   * List bills for a specific patient with pagination.
   *
   * @param patientId    Patient UUID
   * @param page         Page number (1-indexed)
   * @param limit        Items per page
   * @param workspaceId  Tenant workspace identifier
   * @returns Paginated bill response
   */
  async getBillsByPatient(
    patientId: string,
    page: number,
    limit: number,
    workspaceId: string,
  ): Promise<PaginatedBillResponseDto> {
    this.logger.log(
      `Fetching bills for patient ${patientId} in workspace ${workspaceId}`,
    );

    const [bills, total] = await this.patientBillRepository.findByPatient(
      patientId,
      page,
      limit,
    );

    const data: BillResponseDto[] = await Promise.all(
      bills.map(async (bill) => {
        const items = await this.billItemRepository.findByBill(bill.id);
        return this.mapToBillResponse(bill, items);
      }),
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Recalculate and persist the totals for a bill.
   * Loads items, discount, and tax from the database, recalculates, and saves.
   *
   * @param billId       Bill UUID
   * @param workspaceId  Tenant workspace identifier
   * @returns Computed totals breakdown
   */
  async calculateBillTotals(
    billId: string,
    workspaceId: string,
  ): Promise<{
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    total: number;
  }> {
    this.logger.log(`Calculating totals for bill ${billId}`);

    const bill = await this.patientBillRepository.findOne({
      where: { id: billId, isActive: true },
    });

    if (!bill) {
      throw new NotFoundException(BILLING_ERROR_CODES.BILL_NOT_FOUND);
    }

    const items = await this.billItemRepository.findByBill(billId);

    let discount: Discount | null = null;
    if (bill.discountId) {
      discount = await this.discountRepository.findOne({
        where: { id: bill.discountId, isActive: true },
      });
    }

    let tax: Tax | null = null;
    if (bill.taxId) {
      tax = await this.taxRepository.findOne({
        where: { id: bill.taxId, isActive: true },
      });
    }

    this.recalculateBillTotals(bill, items, discount, tax);

    await this.patientBillRepository.save(bill);

    this.logger.log(
      `Totals recalculated for bill ${billId}: subtotal=${bill.subtotal}, discount=${bill.discountAmount}, tax=${bill.taxAmount}, total=${bill.total}`,
    );

    return {
      subtotal: bill.subtotal,
      discountAmount: bill.discountAmount,
      taxAmount: bill.taxAmount,
      total: bill.total,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Recalculate bill financial totals in-place.
   * Mutates the bill entity directly -- caller is responsible for persisting.
   *
   * Calculation order:
   *   1. subtotal = SUM(active item totals)
   *   2. discountAmount = computed from discount entity rules
   *   3. taxAmount = rate applied to (subtotal - discountAmount)
   *   4. total = subtotal - discountAmount + taxAmount
   */
  private recalculateBillTotals(
    bill: PatientBill,
    items: BillItem[],
    discount?: Discount | null,
    tax?: Tax | null,
  ): void {
    // 1. Subtotal from active items
    const subtotal = items
      .filter((item) => item.isActive !== false)
      .reduce((sum, item) => sum + Number(item.totalPrice), 0);

    bill.subtotal = Number(subtotal.toFixed(2));

    // 2. Discount
    let discountAmount = 0;
    if (discount) {
      if (discount.isPercentage) {
        discountAmount = Number(
          ((subtotal * discount.value) / 100).toFixed(2),
        );
        // Cap at max discount amount if specified
        if (
          discount.maxDiscountAmount &&
          discountAmount > discount.maxDiscountAmount
        ) {
          discountAmount = Number(discount.maxDiscountAmount);
        }
      } else {
        discountAmount = Number(discount.value);
      }
      // Never let discount exceed subtotal
      if (discountAmount > subtotal) {
        discountAmount = subtotal;
      }
    }
    bill.discountAmount = Number(discountAmount.toFixed(2));

    // 3. Tax (applied on subtotal after discount)
    const taxableAmount = subtotal - discountAmount;
    let taxAmount = 0;
    if (tax) {
      taxAmount = Number(((taxableAmount * tax.rate) / 100).toFixed(2));
    }
    bill.taxAmount = Number(taxAmount.toFixed(2));

    // 4. Total
    bill.total = Number(
      (subtotal - discountAmount + taxAmount).toFixed(2),
    );
  }

  /**
   * Validate whether a bill status transition is allowed.
   *
   * @param currentStatus  Current bill status
   * @param newStatus      Desired target status
   * @returns true if the transition is permitted
   */
  private validateStatusTransition(
    currentStatus: BillStatus,
    newStatus: BillStatus,
  ): boolean {
    const allowedTransitions = BILL_STATUS_TRANSITIONS[currentStatus];
    if (!allowedTransitions) {
      return false;
    }
    return allowedTransitions.includes(newStatus);
  }

  /**
   * Validate that a discount is currently usable.
   * Checks validity dates and usage limits.
   */
  private validateDiscount(discount: Discount): void {
    const now = new Date();

    if (discount.validFrom && new Date(discount.validFrom) > now) {
      throw new BadRequestException(
        `${BILLING_ERROR_CODES.DISCOUNT_EXPIRED}: Discount is not yet valid`,
      );
    }

    if (discount.validUntil && new Date(discount.validUntil) < now) {
      throw new BadRequestException(
        `${BILLING_ERROR_CODES.DISCOUNT_EXPIRED}: Discount has expired`,
      );
    }

    if (
      discount.usageLimit &&
      discount.usageLimit > 0 &&
      discount.usageCount >= discount.usageLimit
    ) {
      throw new BadRequestException(
        BILLING_ERROR_CODES.DISCOUNT_USAGE_EXCEEDED,
      );
    }
  }

  /**
   * Build a default due date based on BILLING_DEFAULTS.DUE_DATE_DAYS.
   */
  private buildDefaultDueDate(): Date {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + BILLING_DEFAULTS.DUE_DATE_DAYS);
    return dueDate;
  }

  /**
   * Map a PatientBill entity (with optional items) to a BillResponseDto.
   */
  private mapToBillResponse(
    bill: PatientBill,
    items?: BillItem[],
  ): BillResponseDto {
    return new BillResponseDto({
      id: bill.id,
      billNumber: bill.billNumber,
      patientId: bill.patientId,
      appointmentId: bill.appointmentId,
      department: bill.department,
      subtotal: Number(bill.subtotal),
      discountAmount: Number(bill.discountAmount),
      taxAmount: Number(bill.taxAmount),
      total: Number(bill.total),
      status: bill.status,
      issuedAt: bill.issuedAt,
      dueDate: bill.dueDate,
      notes: bill.notes,
      metadata: bill.metadata,
      items: items ? items.map((item) => this.mapToItemResponse(item)) : [],
      payments: [],
      createdAt: bill.createdAt,
      updatedAt: bill.updatedAt,
    });
  }

  /**
   * Map a BillItem entity to a BillItemResponseDto.
   */
  private mapToItemResponse(item: BillItem): BillItemResponseDto {
    return {
      id: item.id,
      billId: item.billId,
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      department: item.department,
      medicationItemId: item.medicationItemId,
      consumableItemId: item.consumableItemId,
      batchId: item.batchId,
      actualUnitCost: item.actualUnitCost
        ? Number(item.actualUnitCost)
        : undefined,
      hasInsuranceClaim: item.hasInsuranceClaim,
      insuranceClaimStatus: item.insuranceClaimStatus,
      totalClaimedAmount: item.totalClaimedAmount
        ? Number(item.totalClaimedAmount)
        : undefined,
      totalApprovedAmount: item.totalApprovedAmount
        ? Number(item.totalApprovedAmount)
        : undefined,
      totalDeniedAmount: item.totalDeniedAmount
        ? Number(item.totalDeniedAmount)
        : undefined,
      metadata: item.metadata,
      createdAt: item.createdAt,
    };
  }

  /**
   * Emit an audit log entry. Failures are caught and logged so they never
   * prevent the primary business operation from succeeding.
   */
  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get billing analytics for a date range.
   *
   * Provides aggregated metrics: total revenue, bill counts by status,
   * average bill amounts, top departments, payment collection rate, etc.
   *
   * @param startDate  Period start (inclusive)
   * @param endDate    Period end (inclusive)
   * @param workspaceId  Workspace scope
   * @returns Analytics DTO with aggregated billing metrics
   */
  async getBillAnalytics(
    startDate: Date,
    endDate: Date,
    workspaceId: string,
  ): Promise<BillAnalyticsDto> {
    this.logger.log(
      `Generating bill analytics from ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const qb = this.patientBillRepository
      .createQueryBuilder('bill')
      .where('bill.isActive = :isActive', { isActive: true })
      .andWhere('bill.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      });

    // ── Revenue summary ────────────────────────────────────────────────
    const revenueSummary = await qb
      .clone()
      .select('SUM(bill.total)', 'totalRevenue')
      .addSelect('COUNT(bill.id)', 'totalBills')
      .addSelect('AVG(bill.total)', 'averageBillAmount')
      .addSelect('MAX(bill.total)', 'highestBill')
      .addSelect('MIN(bill.total)', 'lowestBill')
      .getRawOne();

    // ── Bills by status ────────────────────────────────────────────────
    const statusBreakdown = await qb
      .clone()
      .select('bill.status', 'status')
      .addSelect('COUNT(bill.id)', 'count')
      .addSelect('SUM(bill.total)', 'total')
      .groupBy('bill.status')
      .getRawMany();

    // ── Bills by department ────────────────────────────────────────────
    const departmentBreakdown = await qb
      .clone()
      .select('bill.department', 'department')
      .addSelect('COUNT(bill.id)', 'count')
      .addSelect('SUM(bill.total)', 'total')
      .addSelect('AVG(bill.total)', 'averageAmount')
      .groupBy('bill.department')
      .orderBy('SUM(bill.total)', 'DESC')
      .limit(10)
      .getRawMany();

    // ── Outstanding balance ────────────────────────────────────────────
    const outstanding = await qb
      .clone()
      .andWhere('bill.status IN (:...unpaidStatuses)', {
        unpaidStatuses: [
          BillStatus.PENDING,
          BillStatus.PARTIAL,
          BillStatus.OVERDUE,
        ],
      })
      .select('SUM(bill.total - bill.totalPaid)', 'outstandingBalance')
      .addSelect('COUNT(bill.id)', 'outstandingCount')
      .getRawOne();

    // ── Overdue bills ──────────────────────────────────────────────────
    const overdue = await qb
      .clone()
      .andWhere('bill.status = :overdueStatus', {
        overdueStatus: BillStatus.OVERDUE,
      })
      .select('COUNT(bill.id)', 'overdueCount')
      .addSelect('SUM(bill.total - bill.totalPaid)', 'overdueAmount')
      .getRawOne();

    // ── Collection rate ────────────────────────────────────────────────
    const totalRevenue = Number(revenueSummary?.totalRevenue) || 0;
    const paidTotal = await qb
      .clone()
      .select('SUM(bill.totalPaid)', 'totalPaid')
      .getRawOne();
    const collectionRate =
      totalRevenue > 0
        ? ((Number(paidTotal?.totalPaid) || 0) / totalRevenue) * 100
        : 0;

    return {
      period: { startDate, endDate },
      totalRevenue,
      totalBills: Number(revenueSummary?.totalBills) || 0,
      averageBillAmount: Number(revenueSummary?.averageBillAmount) || 0,
      highestBill: Number(revenueSummary?.highestBill) || 0,
      lowestBill: Number(revenueSummary?.lowestBill) || 0,
      statusBreakdown: statusBreakdown.map((r) => ({
        status: r.status,
        count: Number(r.count),
        total: Number(r.total),
      })),
      departmentBreakdown: departmentBreakdown.map((r) => ({
        department: r.department || 'Unassigned',
        count: Number(r.count),
        total: Number(r.total),
        averageAmount: Number(r.averageAmount),
      })),
      outstandingBalance: Number(outstanding?.outstandingBalance) || 0,
      outstandingCount: Number(outstanding?.outstandingCount) || 0,
      overdueCount: Number(overdue?.overdueCount) || 0,
      overdueAmount: Number(overdue?.overdueAmount) || 0,
      collectionRate: parseFloat(collectionRate.toFixed(2)),
    } as unknown as BillAnalyticsDto;
  }

  // ---------------------------------------------------------------------------
  // Bill Number Generation (with collision retry)
  // ---------------------------------------------------------------------------

  /**
   * Generate a unique bill number with collision retry logic.
   *
   * Format: `BILL-{timestamp}-{random}-{micro}`
   * Retries up to MAX_RETRY_ATTEMPTS if a collision occurs.
   *
   * @param bill  The PatientBill entity to stamp
   * @param maxAttempts  Maximum retry attempts (default 3)
   */
  private async generateBillNumberWithRetry(
    bill: PatientBill,
    maxAttempts: number = 3,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const timestamp = Date.now().toString(36).toUpperCase();
      const random = Math.random().toString(36).substring(2, 7).toUpperCase();
      const micro = process.hrtime.bigint().toString(36).slice(-4).toUpperCase();
      const candidate = `BILL-${timestamp}-${random}-${micro}`;

      const existing = await this.patientBillRepository.findOne({
        where: { billNumber: candidate },
      });

      if (!existing) {
        bill.billNumber = candidate;
        return;
      }

      this.logger.warn(
        `Bill number collision on attempt ${attempt}/${maxAttempts}: ${candidate}`,
      );

      if (attempt < maxAttempts) {
        await this.delay(50 * attempt); // linear backoff
      }
    }

    // Fallback: use UUID suffix for guaranteed uniqueness
    const fallback = `BILL-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    bill.billNumber = fallback;
    this.logger.warn(`Using fallback bill number: ${fallback}`);
  }

  /**
   * Simple delay helper for retry logic.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------

  private emitAuditLog(
    userId: string,
    action: string,
    eventType: AuditEventType,
    outcome: AuditOutcome,
    resourceType: string,
    resourceId: string | undefined,
    patientId: string | undefined,
    workspaceId: string,
    previousState?: Record<string, any>,
    newState?: Record<string, any>,
  ): void {
    this.auditLogService
      .log(
        {
          userId,
          action,
          eventType,
          outcome,
          resourceType,
          resourceId,
          patientId,
          previousState,
          newState,
        },
        workspaceId,
      )
      .catch((auditError) => {
        this.logger.error(
          `Failed to create audit log for ${action}: ${auditError.message}`,
          auditError.stack,
        );
      });
  }
}
