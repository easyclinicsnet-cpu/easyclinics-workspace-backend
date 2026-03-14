import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { BatchRepository } from '../repositories/batch.repository';
import { Batch } from '../entities/batch.entity';
import { CreateBatchDto, UpdateBatchDto, QueryBatchDto, BatchResponseDto } from '../dtos/batch';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome, ItemType } from '../../../common/enums';

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
    return {
      data: result.data.map(BatchResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(workspaceId: string, id: string): Promise<BatchResponseDto> {
    const entity = await this.dataSource.getRepository(Batch).findOne({
      where: { id, workspaceId, isDeleted: false },
      relations: ['medicationItem', 'consumableItem', 'supplier'],
    });
    if (!entity) {
      throw new NotFoundException(`Batch ${id} not found`);
    }
    return BatchResponseDto.fromEntity(entity);
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
