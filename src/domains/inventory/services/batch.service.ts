import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { BatchRepository } from '../repositories/batch.repository';
import { Batch } from '../entities/batch.entity';
import { CreateBatchDto, UpdateBatchDto, QueryBatchDto, BatchResponseDto } from '../dtos/batch';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome, ItemType } from '../../../common/enums';
import { MedicationItem } from '../entities/medication-item.entity';
import { ConsumableItem } from '../entities/consumable-item.entity';

@Injectable()
export class BatchService {
  private readonly context = BatchService.name;

  constructor(
    private readonly batchRepo: BatchRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateBatchDto): Promise<BatchResponseDto> {
    this.logger.log('Creating batch', { context: this.context, batchNumber: dto.batchNumber, workspaceId: dto.workspaceId });

    const existing = await this.batchRepo.findByBatchNumber(dto.workspaceId, dto.batchNumber);
    if (existing) {
      throw new ConflictException(`Batch ${dto.batchNumber} already exists`);
    }

    if (new Date(dto.expiryDate) <= new Date(dto.manufactureDate)) {
      throw new BadRequestException('Expiry date must be after manufacture date');
    }

    const entity = this.dataSource.getRepository(Batch).create({
      ...dto,
      availableQuantity: dto.initialQuantity,
      reservedQuantity: 0,
      openedPacks: 0,
    });

    const saved = await this.dataSource.getRepository(Batch).save(entity);

    await this.updateItemStock(saved);

    try {
      await this.auditLogService.log({
        workspaceId: dto.workspaceId,
        userId: dto.createdBy || 'system',
        action: `Created batch: ${dto.batchNumber}`,
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Batch',
        resourceId: saved.id,
        newState: { batchNumber: dto.batchNumber, quantity: dto.initialQuantity },
      });
    } catch (e) {
      this.logger.warn('Audit log failed for batch creation', this.context);
    }

    return BatchResponseDto.fromEntity(saved);
  }

  async findAll(
    workspaceId: string,
    query: QueryBatchDto,
  ): Promise<IPaginatedResult<BatchResponseDto>> {
    const result = await this.batchRepo.findByWorkspace(workspaceId, query);
    const dtos = result.data.map(BatchResponseDto.fromEntity);

    // If the ORM join didn't hydrate item names (e.g. encrypted repo pipeline),
    // resolve them with a single bulk lookup.
    const needsNames = dtos.filter(d => !d.itemName && (d.medicationItemId || d.consumableItemId));
    if (needsNames.length > 0) {
      const medIds = [...new Set(needsNames.filter(d => d.medicationItemId).map(d => d.medicationItemId!))];
      const conIds = [...new Set(needsNames.filter(d => d.consumableItemId).map(d => d.consumableItemId!))];

      const nameMap = new Map<string, { name: string; code: string }>();

      if (medIds.length > 0) {
        const meds = await this.dataSource.getRepository(MedicationItem)
          .createQueryBuilder('m').select(['m.id', 'm.name', 'm.code'])
          .where('m.id IN (:...ids)', { ids: medIds }).getMany();
        meds.forEach(m => nameMap.set(m.id, { name: m.name, code: m.code }));
      }
      if (conIds.length > 0) {
        const cons = await this.dataSource.getRepository(ConsumableItem)
          .createQueryBuilder('c').select(['c.id', 'c.name', 'c.code'])
          .where('c.id IN (:...ids)', { ids: conIds }).getMany();
        cons.forEach(c => nameMap.set(c.id, { name: c.name, code: c.code }));
      }

      for (const dto of needsNames) {
        const itemId = dto.medicationItemId ?? dto.consumableItemId;
        const info = itemId ? nameMap.get(itemId) : undefined;
        if (info) {
          dto.itemName = info.name;
          dto.itemCode = info.code;
        }
      }
    }

    return { data: dtos, meta: result.meta };
  }

  async findById(workspaceId: string, id: string): Promise<BatchResponseDto> {
    const entity = await this.dataSource.getRepository(Batch).findOne({
      where: { id, workspaceId, isDeleted: false },
      relations: ['medicationItem', 'consumableItem', 'supplier'],
    });
    if (!entity) {
      throw new NotFoundException(`Batch ${id} not found`);
    }
    const dto = BatchResponseDto.fromEntity(entity);

    // Fallback: if relation didn't hydrate name, fetch directly
    if (!dto.itemName) {
      const itemId = entity.medicationItemId ?? entity.consumableItemId;
      if (itemId) {
        const repo = entity.medicationItemId
          ? this.dataSource.getRepository(MedicationItem)
          : this.dataSource.getRepository(ConsumableItem);
        const item = await repo.findOne({ where: { id: itemId } as any, select: ['id', 'name', 'code'] as any });
        if (item) {
          dto.itemName = (item as any).name;
          dto.itemCode = (item as any).code;
        }
      }
    }

    return dto;
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateBatchDto,
  ): Promise<BatchResponseDto> {
    const entity = await this.dataSource.getRepository(Batch).findOne({
      where: { id, workspaceId, isDeleted: false },
    });
    if (!entity) {
      throw new NotFoundException(`Batch ${id} not found`);
    }

    const previousState = { unitCost: entity.unitCost, isQuarantined: entity.isQuarantined };
    Object.assign(entity, dto);
    if (dto.updatedBy) entity.updatedBy = dto.updatedBy;
    const saved = await this.dataSource.getRepository(Batch).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: dto.updatedBy || 'system',
        action: `Updated batch: ${entity.batchNumber}`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Batch',
        resourceId: id,
        previousState,
        newState: dto,
      });
    } catch (e) {
      this.logger.warn('Audit log failed for batch update', this.context);
    }

    return BatchResponseDto.fromEntity(saved);
  }

  async findAvailableForItem(
    workspaceId: string,
    itemId: string,
    itemType: ItemType,
  ): Promise<BatchResponseDto[]> {
    const batches = await this.batchRepo.findAvailableForItem(workspaceId, itemId, itemType);
    return batches.map(BatchResponseDto.fromEntity);
  }

  async findExpiringSoon(workspaceId: string, days?: number): Promise<BatchResponseDto[]> {
    const batches = await this.batchRepo.findExpiringSoon(workspaceId, days);
    return batches.map(BatchResponseDto.fromEntity);
  }

  async findExpired(workspaceId: string): Promise<BatchResponseDto[]> {
    const batches = await this.batchRepo.findExpired(workspaceId);
    return batches.map(BatchResponseDto.fromEntity);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATISTICS
  // ══════════════════════════════════════════════════════════════════════════

  async getStatisticsSummary(workspaceId: string): Promise<Record<string, any>> {
    const repo = this.dataSource.getRepository(Batch);
    const now = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);

    const [total, active, expired, expiringSoon, quarantined, inStock] = await Promise.all([
      repo.count({ where: { workspaceId, isDeleted: false } }),
      repo.count({ where: { workspaceId, isDeleted: false, isActive: true } }),
      repo.createQueryBuilder('b')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.isDeleted = false')
        .andWhere('b.expiryDate < :now', { now: now.toISOString().split('T')[0] })
        .getCount(),
      repo.createQueryBuilder('b')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.isDeleted = false')
        .andWhere('b.expiryDate >= :now', { now: now.toISOString().split('T')[0] })
        .andWhere('b.expiryDate <= :soon', { soon: soon.toISOString().split('T')[0] })
        .getCount(),
      repo.count({ where: { workspaceId, isDeleted: false, isQuarantined: true } }),
      repo.createQueryBuilder('b')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.isDeleted = false')
        .andWhere('b.availableQuantity > 0')
        .getCount(),
    ]);

    const stockValueResult = await repo.createQueryBuilder('b')
      .select('SUM(b.availableQuantity * b.unitCost)', 'totalValue')
      .where('b.workspaceId = :workspaceId', { workspaceId })
      .andWhere('b.isDeleted = false')
      .getRawOne();

    return {
      totalBatches: total,
      activeBatches: active,
      expiredBatches: expired,
      expiringSoonBatches: expiringSoon,
      quarantinedBatches: quarantined,
      batchesInStock: inStock,
      totalStockValue: Number(stockValueResult?.totalValue || 0),
    };
  }

  async getAlertsStatistics(workspaceId: string): Promise<Record<string, any>> {
    const repo = this.dataSource.getRepository(Batch);
    const now = new Date();
    const critical = new Date();
    critical.setDate(critical.getDate() + 15);
    const warning = new Date();
    warning.setDate(warning.getDate() + 30);

    const [expiredCount, criticalCount, warningCount, quarantinedCount, qualityFailedCount, depleted] = await Promise.all([
      repo.createQueryBuilder('b')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.isDeleted = false').andWhere('b.isActive = true')
        .andWhere('b.expiryDate < :now', { now: now.toISOString().split('T')[0] })
        .getCount(),
      repo.createQueryBuilder('b')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.isDeleted = false').andWhere('b.isActive = true')
        .andWhere('b.expiryDate >= :now', { now: now.toISOString().split('T')[0] })
        .andWhere('b.expiryDate <= :critical', { critical: critical.toISOString().split('T')[0] })
        .getCount(),
      repo.createQueryBuilder('b')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.isDeleted = false').andWhere('b.isActive = true')
        .andWhere('b.expiryDate > :critical', { critical: critical.toISOString().split('T')[0] })
        .andWhere('b.expiryDate <= :warning', { warning: warning.toISOString().split('T')[0] })
        .getCount(),
      repo.count({ where: { workspaceId, isDeleted: false, isActive: true, isQuarantined: true } }),
      repo.createQueryBuilder('b')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.isDeleted = false').andWhere('b.isActive = true')
        .andWhere("b.qualityTestResult = 'FAILED'")
        .getCount(),
      repo.createQueryBuilder('b')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.isDeleted = false').andWhere('b.isActive = true')
        .andWhere('b.availableQuantity <= 0')
        .getCount(),
    ]);

    const totalAlerts = expiredCount + criticalCount + quarantinedCount + qualityFailedCount;

    return {
      totalAlerts,
      expired: expiredCount,
      criticalExpiry: criticalCount,
      warningExpiry: warningCount,
      quarantined: quarantinedCount,
      qualityFailed: qualityFailedCount,
      depleted,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DASHBOARD (combined stats + alerts)
  // ══════════════════════════════════════════════════════════════════════════

  async getDashboard(workspaceId: string): Promise<Record<string, any>> {
    const [statistics, alerts] = await Promise.all([
      this.getStatisticsSummary(workspaceId),
      this.getAlertsStatistics(workspaceId),
    ]);
    return { statistics, alerts, timestamp: new Date().toISOString() };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADJUST QUANTITY
  // ══════════════════════════════════════════════════════════════════════════

  async adjustQuantity(
    workspaceId: string,
    batchId: string,
    quantity: number,
    adjustmentType: 'ADD' | 'REMOVE',
    reason: string,
    userId?: string,
  ): Promise<BatchResponseDto> {
    const entity = await this.dataSource.getRepository(Batch).findOne({
      where: { id: batchId, workspaceId, isDeleted: false },
    });
    if (!entity) throw new NotFoundException(`Batch ${batchId} not found`);

    if (quantity <= 0) throw new BadRequestException('Quantity must be positive');

    const previousQty = Number(entity.availableQuantity);

    if (adjustmentType === 'ADD') {
      entity.availableQuantity = previousQty + quantity;
    } else {
      if (previousQty < quantity) {
        throw new ConflictException(`Insufficient stock: available ${previousQty}, requested removal ${quantity}`);
      }
      entity.availableQuantity = previousQty - quantity;
    }

    if (userId) entity.updatedBy = userId;
    const saved = await this.dataSource.getRepository(Batch).save(entity);

    // Update parent item stock
    const delta = adjustmentType === 'ADD' ? quantity : -quantity;
    if (entity.medicationItemId) {
      await this.dataSource.query(
        `UPDATE medication_items SET availableQuantity = availableQuantity + ?, totalQuantity = totalQuantity + ? WHERE id = ?`,
        [delta, delta, entity.medicationItemId],
      );
    }
    if (entity.consumableItemId) {
      await this.dataSource.query(
        `UPDATE consumable_items SET availableQuantity = availableQuantity + ?, totalQuantity = totalQuantity + ? WHERE id = ?`,
        [delta, delta, entity.consumableItemId],
      );
    }

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: userId || 'system',
        action: `Adjusted batch ${entity.batchNumber}: ${adjustmentType} ${quantity} (reason: ${reason})`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Batch',
        resourceId: batchId,
        previousState: { availableQuantity: previousQty },
        newState: { availableQuantity: Number(saved.availableQuantity), adjustmentType, quantity, reason },
      });
    } catch { /* audit failure is non-fatal */ }

    this.logger.log(`Batch ${entity.batchNumber}: ${adjustmentType} ${quantity} — ${reason}`, { context: this.context });
    return BatchResponseDto.fromEntity(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SOFT DELETE
  // ══════════════════════════════════════════════════════════════════════════

  async softDelete(workspaceId: string, batchId: string, userId?: string, reason?: string): Promise<BatchResponseDto> {
    const entity = await this.dataSource.getRepository(Batch).findOne({
      where: { id: batchId, workspaceId, isDeleted: false },
    });
    if (!entity) throw new NotFoundException(`Batch ${batchId} not found`);

    if (Number(entity.availableQuantity) > 0) {
      throw new ConflictException(`Cannot delete batch with ${entity.availableQuantity} available stock. Adjust to zero first.`);
    }

    entity.isDeleted = true;
    entity.isActive = false;
    if (userId) entity.updatedBy = userId;
    const saved = await this.dataSource.getRepository(Batch).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: userId || 'system',
        action: `Soft-deleted batch ${entity.batchNumber}${reason ? ` (${reason})` : ''}`,
        eventType: AuditEventType.DELETE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Batch',
        resourceId: batchId,
      });
    } catch { /* non-fatal */ }

    return BatchResponseDto.fromEntity(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOW STOCK
  // ══════════════════════════════════════════════════════════════════════════

  async findLowStock(
    workspaceId: string,
    thresholdPercent: number,
    page = 1,
    limit = 25,
  ): Promise<IPaginatedResult<BatchResponseDto>> {
    const repo = this.dataSource.getRepository(Batch);
    const qb = repo.createQueryBuilder('b')
      .where('b.workspaceId = :workspaceId', { workspaceId })
      .andWhere('b.isDeleted = false')
      .andWhere('b.isActive = true')
      .andWhere('b.initialQuantity > 0')
      .andWhere('(b.availableQuantity / b.initialQuantity * 100) <= :threshold', { threshold: thresholdPercent })
      .andWhere('b.availableQuantity > 0')
      .orderBy('b.availableQuantity', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [entities, total] = await qb.getManyAndCount();
    return {
      data: entities.map(BatchResponseDto.fromEntity),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private async updateItemStock(batch: Batch): Promise<void> {
    if (batch.medicationItemId) {
      await this.dataSource.query(
        `UPDATE medication_items SET totalQuantity = totalQuantity + ?, availableQuantity = availableQuantity + ?, totalPackCount = totalPackCount + ? WHERE id = ?`,
        [batch.initialQuantity, batch.initialQuantity, batch.totalPacks || 0, batch.medicationItemId],
      );
    }
    if (batch.consumableItemId) {
      await this.dataSource.query(
        `UPDATE consumable_items SET totalQuantity = totalQuantity + ?, availableQuantity = availableQuantity + ?, totalPackCount = totalPackCount + ? WHERE id = ?`,
        [batch.initialQuantity, batch.initialQuantity, batch.totalPacks || 0, batch.consumableItemId],
      );
    }
  }
}
