import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { ConsumableItemRepository } from '../repositories/consumable-item.repository';
import { ConsumableItem } from '../entities/consumable-item.entity';
import {
  CreateConsumableItemDto,
  UpdateConsumableItemDto,
  QueryConsumableItemDto,
  ConsumableItemResponseDto,
} from '../dtos/consumable-item';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome, ItemType } from '../../../common/enums';

@Injectable()
export class ConsumableItemService {
  private readonly context = ConsumableItemService.name;

  constructor(
    private readonly consumableRepo: ConsumableItemRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateConsumableItemDto): Promise<ConsumableItemResponseDto> {
    this.logger.log('Creating consumable item', { context: this.context, code: dto.code, workspaceId: dto.workspaceId });

    const existing = await this.consumableRepo.findByCode(dto.workspaceId, dto.code);
    if (existing) {
      throw new ConflictException(`Consumable with code ${dto.code} already exists`);
    }

    const entity = this.dataSource.getRepository(ConsumableItem).create({
      ...dto,
      type: dto.type || ItemType.CONSUMABLE,
      totalQuantity: 0,
      availableQuantity: 0,
      reservedQuantity: 0,
      totalPackCount: 0,
    });

    const saved = await this.dataSource.getRepository(ConsumableItem).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: dto.workspaceId,
        userId: 'system',
        action: `Created consumable item: ${dto.name}`,
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'ConsumableItem',
        resourceId: saved.id,
        newState: { code: dto.code, name: dto.name },
      });
    } catch (e) {
      this.logger.warn('Audit log failed for consumable creation', this.context);
    }

    return ConsumableItemResponseDto.fromEntity(saved);
  }

  async findAll(
    workspaceId: string,
    query: QueryConsumableItemDto,
  ): Promise<IPaginatedResult<ConsumableItemResponseDto>> {
    const result = await this.consumableRepo.findByWorkspace(workspaceId, query);
    return {
      data: result.data.map(ConsumableItemResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(workspaceId: string, id: string): Promise<ConsumableItemResponseDto> {
    const entity = await this.consumableRepo.findWithBatches(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Consumable item ${id} not found`);
    }
    return ConsumableItemResponseDto.fromEntity(entity);
  }

  async findByCode(workspaceId: string, code: string): Promise<ConsumableItemResponseDto> {
    const entity = await this.consumableRepo.findByCode(workspaceId, code);
    if (!entity) {
      throw new NotFoundException(`Consumable item with code ${code} not found`);
    }
    return ConsumableItemResponseDto.fromEntity(entity);
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateConsumableItemDto,
  ): Promise<ConsumableItemResponseDto> {
    const entity = await this.consumableRepo.findWithBatches(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Consumable item ${id} not found`);
    }

    const previousState = { ...entity };
    Object.assign(entity, dto);
    const saved = await this.dataSource.getRepository(ConsumableItem).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: 'system',
        action: `Updated consumable item: ${entity.name}`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'ConsumableItem',
        resourceId: id,
        previousState: { name: previousState.name, unitCost: previousState.unitCost },
        newState: dto,
      });
    } catch (e) {
      this.logger.warn('Audit log failed for consumable update', this.context);
    }

    return ConsumableItemResponseDto.fromEntity(saved);
  }

  async softDelete(workspaceId: string, id: string, deletedBy: string): Promise<void> {
    const entity = await this.consumableRepo.findWithBatches(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Consumable item ${id} not found`);
    }

    entity.isDeleted = true;
    entity.isActive = false;
    entity.deletedBy = deletedBy;
    entity.deletedAt = new Date();
    await this.dataSource.getRepository(ConsumableItem).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: deletedBy,
        action: `Soft deleted consumable item: ${entity.name}`,
        eventType: AuditEventType.DELETE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'ConsumableItem',
        resourceId: id,
      });
    } catch (e) {
      this.logger.warn('Audit log failed for consumable deletion', this.context);
    }
  }

  async findLowStock(workspaceId: string): Promise<ConsumableItemResponseDto[]> {
    const items = await this.consumableRepo.findLowStock(workspaceId);
    return items.map(ConsumableItemResponseDto.fromEntity);
  }

  async findOutOfStock(workspaceId: string): Promise<ConsumableItemResponseDto[]> {
    const items = await this.consumableRepo.findOutOfStock(workspaceId);
    return items.map(ConsumableItemResponseDto.fromEntity);
  }
}
