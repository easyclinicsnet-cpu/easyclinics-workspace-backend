import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { BatchRepository } from '../repositories/batch.repository';
import { BatchSelectionService } from '../strategies/batch-selection/batch-selection.service';
import { MovementStrategyContext } from '../strategies/movement/movement-strategy.context';
import { MedicationItem } from '../entities/medication-item.entity';
import { ConsumableItem } from '../entities/consumable-item.entity';
import { MedicationSale } from '../entities/medication-sale.entity';
import { MedicationPartialSale } from '../entities/medication-partial-sale.entity';
import { ConsumableUsage } from '../entities/consumable-usage.entity';
import { ConsumablePartialUsage } from '../entities/consumable-partial-usage.entity';
import { PatientBill } from '../../billing/entities/patient-bill.entity';
import { BillItem } from '../../billing/entities/bill-item.entity';
import {
  DispenseRequestDto,
  EmergencyDispenseRequestDto,
  DispenseResponseDto,
  DispensedItemResponseDto,
  DispenseItemDto,
  QueryDispenseHistoryDto,
  DispenseHistoryItemDto,
  PaginatedDispenseHistoryDto,
} from '../dtos/dispense';
import { IBatchSelectionCriteria, IEmergencyBatchSelectionCriteria, IMovementData } from '../interfaces';
import { BatchPriority, DispenseType, EmergencyLevel } from '../enums';
import {
  ItemType,
  MovementType,
  AuditEventType,
  AuditOutcome,
} from '../../../common/enums';
import { INVENTORY_CONSTANTS } from '../constants';

@Injectable()
export class DispenseService {
  private readonly context = DispenseService.name;
  private readonly idempotencyCache = new Map<string, { result: DispenseResponseDto; expiry: number }>();

  constructor(
    private readonly batchRepo: BatchRepository,
    private readonly batchSelectionService: BatchSelectionService,
    private readonly movementContext: MovementStrategyContext,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async dispense(dto: DispenseRequestDto): Promise<DispenseResponseDto> {
    this.logger.log('Processing dispense request', { context: this.context, workspaceId: dto.workspaceId, itemCount: dto.items.length, type: dto.dispenseType });

    // Idempotency check
    if (dto.idempotencyKey) {
      const cached = this.idempotencyCache.get(dto.idempotencyKey);
      if (cached && cached.expiry > Date.now()) {
        this.logger.log('Returning cached dispense result', this.context);
        return cached.result;
      }
    }

    const dispensedItems: DispensedItemResponseDto[] = [];
    let totalCost = 0;
    const allWarnings: string[] = [];
    const pendingMovements: IMovementData[] = [];

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let affectedBillId: string | undefined;

      for (const item of dto.items) {
        const result = await this.dispenseItem(
          dto,
          item,
          queryRunner.manager,
        );
        dispensedItems.push(result.dispensedItem);
        totalCost += result.totalPrice;
        allWarnings.push(...result.warnings);
        pendingMovements.push(result.movement);
        if (result.billId) affectedBillId = result.billId;
      }

      // Recalculate PatientBill totals if any bill items were added
      if (affectedBillId) {
        const bill = await queryRunner.manager.findOne(PatientBill, {
          where: { id: affectedBillId },
        });
        if (bill) {
          const allItems = await queryRunner.manager.find(BillItem, {
            where: { billId: affectedBillId, isActive: true },
          });
          const subtotal = allItems.reduce(
            (sum, i) => sum + Number(i.totalPrice),
            0,
          );
          bill.subtotal = Number(subtotal.toFixed(2));
          bill.total = Number((subtotal - Number(bill.discountAmount) + Number(bill.taxAmount)).toFixed(2));
          await queryRunner.manager.save(PatientBill, bill);
        }
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Dispense transaction failed', this.context, error);
      throw error;
    } finally {
      await queryRunner.release();
    }

    // Record movements AFTER the transaction is committed to avoid lock contention
    for (const movement of pendingMovements) {
      try {
        await this.movementContext.recordMovement(movement);
      } catch (e) {
        this.logger.warn('Failed to record movement after dispense commit', this.context);
      }
    }

    const response: DispenseResponseDto = {
      success: true,
      dispensedItems,
      totalCost,
      warnings: allWarnings,
      metadata: dto.metadata,
    };

    // Cache idempotency result
    if (dto.idempotencyKey) {
      this.idempotencyCache.set(dto.idempotencyKey, {
        result: response,
        expiry: Date.now() + INVENTORY_CONSTANTS.CACHE.IDEMPOTENCY_TTL_MS,
      });
    }

    // Audit
    try {
      await this.auditLogService.log({
        workspaceId: dto.workspaceId,
        userId: dto.dispensedBy || 'system',
        action: `Dispensed ${dto.items.length} item(s) to ${dto.department}`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Dispense',
        resourceId: dto.idempotencyKey || 'N/A',
        newState: {
          department: dto.department,
          patientId: dto.patientId,
          itemCount: dto.items.length,
          totalCost,
        },
      });
    } catch (e) {
      this.logger.warn('Audit log failed for dispense', this.context);
    }

    return response;
  }

  async emergencyDispense(dto: EmergencyDispenseRequestDto): Promise<DispenseResponseDto> {
    this.logger.log('Processing EMERGENCY dispense', { context: this.context, workspaceId: dto.workspaceId, emergencyLevel: dto.emergencyLevel, authorizedBy: dto.authorizedBy });

    dto.dispenseType = DispenseType.EMERGENCY;
    const result = await this.dispense(dto);

    // Additional emergency audit
    try {
      await this.auditLogService.log({
        workspaceId: dto.workspaceId,
        userId: dto.authorizedBy,
        action: `EMERGENCY dispense authorized: Level ${dto.emergencyLevel}`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'EmergencyDispense',
        resourceId: dto.idempotencyKey || 'N/A',
        newState: {
          emergencyLevel: dto.emergencyLevel,
          justification: dto.justification,
          authorizedBy: dto.authorizedBy,
          overrideExpiry: dto.overrideExpiry,
          overrideQuality: dto.overrideQuality,
        },
      });
    } catch (e) {
      this.logger.warn('Audit log failed for emergency dispense', this.context);
    }

    return result;
  }

  private async dispenseItem(
    dto: DispenseRequestDto,
    item: DispenseItemDto,
    manager: any,
  ): Promise<{
    dispensedItem: DispensedItemResponseDto;
    totalPrice: number;
    warnings: string[];
    movement: IMovementData;
    billId?: string;
  }> {
    // Fetch the item entity
    const itemEntity = await this.getItemEntity(dto.workspaceId!, item.itemId, item.itemType, manager);

    // Get available batches
    const batches = await this.batchRepo.findAvailableForItem(
      dto.workspaceId!,
      item.itemId,
      item.itemType,
    );

    if (batches.length === 0) {
      throw new BadRequestException(`No available batches for item ${itemEntity.name}`);
    }

    // Select batches using strategy
    const criteria: IBatchSelectionCriteria = {
      workspaceId: dto.workspaceId!,
      itemId: item.itemId,
      itemType: item.itemType,
      quantity: item.quantity,
      priority: this.getPriority(dto),
      excludeQuarantined: true,
      excludeExpired: true,
      department: dto.department,
    };

    if (dto instanceof EmergencyDispenseRequestDto) {
      const emergencyDto = dto as EmergencyDispenseRequestDto;
      (criteria as IEmergencyBatchSelectionCriteria).emergencyLevel = emergencyDto.emergencyLevel;
      (criteria as IEmergencyBatchSelectionCriteria).authorizedBy = emergencyDto.authorizedBy;
      (criteria as IEmergencyBatchSelectionCriteria).justification = emergencyDto.justification;
      (criteria as IEmergencyBatchSelectionCriteria).overrideExpiry = emergencyDto.overrideExpiry;
      (criteria as IEmergencyBatchSelectionCriteria).overrideQuality = emergencyDto.overrideQuality;
    }

    const selection = this.batchSelectionService.selectBatches(batches, item.quantity, criteria);

    if (!selection.fullyAllocated) {
      throw new BadRequestException(
        `Insufficient stock for ${itemEntity.name}. Required: ${item.quantity}, Available: ${selection.totalQuantity}`,
      );
    }

    const unitPrice = item.priceOverride ?? selection.items[0]?.unitPrice ?? 0;
    const totalPrice = item.priceOverride
      ? item.priceOverride * item.quantity
      : selection.totalCost;

    const isPartial = dto.dispenseType === DispenseType.PARTIAL || itemEntity.isSplittable;

    // Update batch quantities
    for (const selItem of selection.items) {
      await manager.query(
        `UPDATE batches SET availableQuantity = availableQuantity - ? WHERE id = ?`,
        [selItem.allocatedQuantity, selItem.batch.id],
      );
    }

    // Update item stock
    const tableName = item.itemType === ItemType.MEDICATION ? 'medication_items' : 'consumable_items';
    await manager.query(
      `UPDATE ${tableName} SET availableQuantity = availableQuantity - ? WHERE id = ?`,
      [item.quantity, item.itemId],
    );

    // Record sale/usage
    const primaryBatch = selection.items[0]?.batch;
    if (item.itemType === ItemType.MEDICATION) {
      await this.recordMedicationSale(dto, item, primaryBatch, unitPrice, totalPrice, isPartial, manager);
    } else {
      await this.recordConsumableUsage(dto, item, primaryBatch, isPartial, manager);
    }

    // Build movement record — will be persisted after the transaction commits
    const movementType = dto.dispenseType === DispenseType.EMERGENCY
      ? MovementType.EMERGENCY_DISPENSE
      : isPartial
        ? MovementType.PARTIAL_DISPENSE
        : MovementType.DISPENSE;

    const movement: Parameters<typeof this.movementContext.recordMovement>[0] = {
      workspaceId: dto.workspaceId!,
      itemId: item.itemId,
      itemType: item.itemType,
      batchId: primaryBatch?.id,
      quantity: item.quantity,
      movementType,
      department: dto.department,
      reference: dto.prescriptionId,
      initiatedBy: dto.dispensedBy,
      metadata: dto.metadata,
    };

    const dispensedItem: DispensedItemResponseDto = {
      itemId: item.itemId,
      itemName: itemEntity.name,
      itemType: item.itemType,
      quantity: item.quantity,
      unitPrice,
      totalPrice,
      batchId: primaryBatch?.id,
      batchNumber: primaryBatch?.batchNumber,
      isPartial,
      dispenseType: dto.dispenseType || DispenseType.FULL,
    };

    // --- Billing integration ---
    // If this dispense is tied to an appointment that has a DRAFT bill, add a BillItem
    let billId: string | undefined;
    if (dto.appointmentId) {
      const bill = await manager.findOne(PatientBill, {
        where: { appointmentId: dto.appointmentId },
        select: ['id', 'status'],
      });

      if (bill && bill.status === 'DRAFT') {
        const billItem = manager.create(BillItem, {
          workspaceId: dto.workspaceId,
          billId: bill.id,
          description: itemEntity.name,
          quantity: item.quantity,
          unitPrice,
          totalPrice: Number(totalPrice.toFixed(2)),
          department: dto.department,
          medicationItemId: item.itemType === ItemType.MEDICATION ? item.itemId : undefined,
          consumableItemId: item.itemType === ItemType.CONSUMABLE ? item.itemId : undefined,
          batchId: primaryBatch?.id,
          actualUnitCost: selection.items[0]?.batch?.unitCost,
          dispensedBy: dto.dispensedBy,
        });
        await manager.save(BillItem, billItem);
        billId = bill.id;
      }
    }

    return { dispensedItem, totalPrice, warnings: selection.warnings, movement, billId };
  }

  private async getItemEntity(
    workspaceId: string,
    itemId: string,
    itemType: ItemType,
    manager: any,
  ): Promise<MedicationItem | ConsumableItem> {
    if (itemType === ItemType.MEDICATION) {
      const entity = await manager.findOne(MedicationItem, {
        where: { id: itemId, workspaceId, isDeleted: false },
      });
      if (!entity) throw new NotFoundException(`Medication item ${itemId} not found`);
      return entity;
    }

    const entity = await manager.findOne(ConsumableItem, {
      where: { id: itemId, workspaceId, isDeleted: false },
    });
    if (!entity) throw new NotFoundException(`Consumable item ${itemId} not found`);
    return entity;
  }

  private getPriority(dto: DispenseRequestDto): BatchPriority {
    if (dto.dispenseType === DispenseType.EMERGENCY) return BatchPriority.EMERGENCY;
    return BatchPriority.FEFO;
  }

  private async recordMedicationSale(
    dto: DispenseRequestDto,
    item: DispenseItemDto,
    batch: any,
    unitPrice: number,
    totalPrice: number,
    isPartial: boolean,
    manager: any,
  ): Promise<void> {
    if (isPartial) {
      const partialSale = manager.create(MedicationPartialSale, {
        workspaceId: dto.workspaceId,
        medicationItemId: item.itemId,
        batchId: batch?.id,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        patientId: dto.patientId,
        prescriptionId: dto.prescriptionId,
        soldBy: dto.dispensedBy,
        saleDate: new Date(),
        metadata: dto.metadata,
      });
      await manager.save(MedicationPartialSale, partialSale);
    } else {
      const sale = manager.create(MedicationSale, {
        workspaceId: dto.workspaceId,
        medicationItemId: item.itemId,
        batchId: batch?.id,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        patientId: dto.patientId,
        prescriptionId: dto.prescriptionId,
        soldBy: dto.dispensedBy,
        saleDate: new Date(),
        metadata: dto.metadata,
      });
      await manager.save(MedicationSale, sale);
    }
  }

  private async recordConsumableUsage(
    dto: DispenseRequestDto,
    item: DispenseItemDto,
    batch: any,
    isPartial: boolean,
    manager: any,
  ): Promise<void> {
    if (isPartial) {
      const partialUsage = manager.create(ConsumablePartialUsage, {
        workspaceId: dto.workspaceId,
        consumableItemId: item.itemId,
        batchId: batch?.id,
        quantity: item.quantity,
        patientId: dto.patientId,
        usedBy: dto.dispensedBy,
        department: dto.department,
        usageDate: new Date(),
        metadata: dto.metadata,
      });
      await manager.save(ConsumablePartialUsage, partialUsage);
    } else {
      const usage = manager.create(ConsumableUsage, {
        workspaceId: dto.workspaceId,
        consumableItemId: item.itemId,
        batchId: batch?.id,
        quantity: item.quantity,
        patientId: dto.patientId,
        usedBy: dto.dispensedBy,
        department: dto.department,
        usageDate: new Date(),
        metadata: dto.metadata,
      });
      await manager.save(ConsumableUsage, usage);
    }
  }

  // ─── History ────────────────────────────────────────────────────────────────

  async getDispenseHistory(
    workspaceId: string,
    query: QueryDispenseHistoryDto,
  ): Promise<PaginatedDispenseHistoryDto> {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;
    const skip  = (page - 1) * limit;
    const order = { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'DESC' } as any;

    const [medSales, partialSales, conUsages, partialUsages] = await Promise.all([
      this.queryRecords(MedicationSale,        workspaceId, query, skip, limit, order),
      this.queryRecords(MedicationPartialSale, workspaceId, query, skip, limit, order),
      this.queryRecords(ConsumableUsage,       workspaceId, query, skip, limit, order),
      this.queryRecords(ConsumablePartialUsage,workspaceId, query, skip, limit, order),
    ]);

    const pricing = query.billItemPricing;
    const allRows = [
      ...medSales.rows.map(r => this.toHistoryItem(r, 'MEDICATION_SALE')),
      ...partialSales.rows.map(r => this.toHistoryItem(r, 'PARTIAL_SALE')),
      ...conUsages.rows.map(r => this.toHistoryItem(r, 'CONSUMABLE_USAGE', pricing)),
      ...partialUsages.rows.map(r => this.toHistoryItem(r, 'PARTIAL_USAGE', pricing)),
    ].sort((a, b) => {
      const dir = (query.sortOrder ?? 'DESC') === 'DESC' ? -1 : 1;
      return dir * (a.timestamp.getTime() - b.timestamp.getTime());
    }).slice(0, limit);

    const total = medSales.count + partialSales.count + conUsages.count + partialUsages.count;

    return {
      data: allRows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getPatientDispenseHistory(
    workspaceId: string,
    patientId: string,
    query: QueryDispenseHistoryDto,
  ): Promise<PaginatedDispenseHistoryDto> {
    return this.getDispenseHistory(workspaceId, { ...query, patientId });
  }

  async getAppointmentDispenseHistory(
    workspaceId: string,
    appointmentId: string,
    query: QueryDispenseHistoryDto,
  ): Promise<PaginatedDispenseHistoryDto> {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 20;
    const skip  = (page - 1) * limit;

    const bill = await this.dataSource.getRepository(PatientBill).findOne({
      where: { appointmentId },
      select: ['id'],
    });

    if (!bill) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    const qb = this.dataSource
      .getRepository(BillItem)
      .createQueryBuilder('bi')
      .where('bi.billId = :billId', { billId: bill.id })
      .andWhere('bi.isActive = :isActive', { isActive: true });

    if (query.startDate) {
      qb.andWhere('bi.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    }
    if (query.endDate) {
      qb.andWhere('bi.createdAt <= :endDate', { endDate: new Date(query.endDate) });
    }
    if (query.department) {
      qb.andWhere('bi.department = :department', { department: query.department });
    }
    if (query.itemId) {
      qb.andWhere(
        '(bi.medicationItemId = :itemId OR bi.consumableItemId = :itemId)',
        { itemId: query.itemId },
      );
    }

    const sortField = query.sortBy ?? 'createdAt';
    qb.orderBy(`bi.${sortField}`, query.sortOrder ?? 'DESC')
      .skip(skip)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    const data: DispenseHistoryItemDto[] = items.map((bi) => {
      const isMedication = !!bi.medicationItemId;
      const item = new DispenseHistoryItemDto();
      item.id           = bi.id;
      item.recordType   = isMedication ? 'MEDICATION_SALE' : 'CONSUMABLE_USAGE';
      item.itemId       = bi.medicationItemId ?? bi.consumableItemId ?? '';
      item.itemName     = bi.description;
      item.itemType     = isMedication ? ItemType.MEDICATION : ItemType.CONSUMABLE;
      item.quantity     = Number(bi.quantity);
      item.unitPrice    = Number(bi.unitPrice);
      item.totalAmount  = Number(bi.totalPrice);
      item.batchId      = bi.batchId;
      item.department   = bi.department ?? '';
      item.dispensedBy  = bi.dispensedBy ?? '';
      item.dispenseType = DispenseType.FULL;
      item.timestamp    = bi.createdAt;
      item.metadata     = bi.metadata;
      return item;
    });

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getItemDispenseHistory(
    workspaceId: string,
    itemId: string,
    query: QueryDispenseHistoryDto,
  ): Promise<PaginatedDispenseHistoryDto> {
    return this.getDispenseHistory(workspaceId, { ...query, itemId });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async queryRecords(
    entity: any,
    workspaceId: string,
    query: QueryDispenseHistoryDto,
    skip: number,
    take: number,
    order: any,
  ): Promise<{ rows: any[]; count: number }> {
    const isConsumable = entity === ConsumableUsage || entity === ConsumablePartialUsage;

    const repo = this.dataSource.getRepository(entity);
    const itemRelation = isConsumable ? 'consumableItem' : 'medicationItem';
    const qb = repo.createQueryBuilder('r')
      .leftJoinAndSelect(`r.${itemRelation}`, 'item')
      .where('r.workspaceId = :workspaceId', { workspaceId });

    if (query.patientId) qb.andWhere('r.patientId = :patientId', { patientId: query.patientId });

    if (!isConsumable) {
      // Medication entities have a direct billId column
      if (query.billId) {
        qb.andWhere('r.billId = :billId', { billId: query.billId });
      }
    } else {
      // Consumable entities have no billId — filter by consumableItemId values resolved from BillItem
      if (query.billConsumableItemIds) {
        if (query.billConsumableItemIds.length === 0) {
          return { rows: [], count: 0 };
        }
        qb.andWhere('r.consumableItemId IN (:...billConsumableItemIds)', {
          billConsumableItemIds: query.billConsumableItemIds,
        });
      }
    }
    // appointmentId does not exist as a column on any sale/usage entity — filter is intentionally skipped
    if (query.itemId) {
      // works for both medicationItemId and consumableItemId column names
      qb.andWhere('(r.medicationItemId = :itemId OR r.consumableItemId = :itemId)', { itemId: query.itemId });
    }
    // department column only exists on consumable entities
    if (query.department && isConsumable) {
      qb.andWhere('r.department = :department', { department: query.department });
    }
    if (query.startDate) qb.andWhere('r.createdAt >= :startDate', { startDate: new Date(query.startDate) });
    if (query.endDate)   qb.andWhere('r.createdAt <= :endDate',   { endDate: new Date(query.endDate) });

    qb.orderBy(`r.${query.sortBy ?? 'createdAt'}`, query.sortOrder ?? 'DESC')
      .skip(skip)
      .take(take);

    const [rows, count] = await qb.getManyAndCount();
    return { rows, count };
  }

  private toHistoryItem(
    record: any,
    recordType: DispenseHistoryItemDto['recordType'],
    billItemPricing?: Map<string, { unitPrice: number; total: number }>,
  ): DispenseHistoryItemDto {
    const isPartial   = recordType === 'PARTIAL_SALE' || recordType === 'PARTIAL_USAGE';
    const isMedication = recordType === 'MEDICATION_SALE' || recordType === 'PARTIAL_SALE';
    const quantity    = isPartial ? (record.soldQuantity ?? record.usedQuantity ?? record.quantity) : record.quantity;

    // For consumables, unitPrice/totalAmount come from BillItem since ConsumableUsage has no price columns
    const billedPricing = !isMedication && record.consumableItemId
      ? billItemPricing?.get(record.consumableItemId)
      : undefined;
    const unitPrice   = billedPricing?.unitPrice ?? record.unitPrice ?? record.unitCost ?? 0;
    const totalAmount = billedPricing?.total ?? record.totalPrice ?? record.totalCost ?? (quantity * unitPrice);

    const item = new DispenseHistoryItemDto();
    item.id            = record.id;
    item.recordType    = recordType;
    item.itemId        = record.medicationItemId ?? record.consumableItemId ?? '';
    item.itemName      = record.medicationItem?.name ?? record.consumableItem?.name ?? '';
    item.itemType      = isMedication ? ItemType.MEDICATION : ItemType.CONSUMABLE;
    item.quantity      = quantity ?? 0;
    item.unitPrice     = unitPrice;
    item.totalAmount   = totalAmount ?? 0;
    item.batchId       = record.batchId;
    item.batchNumber   = record.batchNumber;
    item.patientId     = record.patientId;
    item.prescriptionId = record.prescriptionId;
    item.appointmentId  = record.appointmentId;
    item.department    = record.department ?? '';
    item.dispensedBy   = record.soldBy ?? record.usedBy ?? record.dispensedBy ?? '';
    item.dispenseType  = isPartial ? DispenseType.PARTIAL : DispenseType.FULL;
    item.timestamp     = record.saleDate ?? record.usageDate ?? record.createdAt;
    item.metadata      = record.metadata;
    return item;
  }
}
