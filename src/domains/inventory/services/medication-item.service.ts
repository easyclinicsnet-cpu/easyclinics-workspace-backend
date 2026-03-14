import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { MedicationItemRepository } from '../repositories/medication-item.repository';
import { MedicationItem } from '../entities/medication-item.entity';
import {
  CreateMedicationItemDto,
  UpdateMedicationItemDto,
  QueryMedicationItemDto,
  MedicationItemResponseDto,
} from '../dtos/medication-item';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome, ItemType } from '../../../common/enums';

@Injectable()
export class MedicationItemService {
  private readonly context = MedicationItemService.name;

  constructor(
    private readonly medicationRepo: MedicationItemRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateMedicationItemDto): Promise<MedicationItemResponseDto> {
    this.logger.log('Creating medication item', { context: this.context, code: dto.code, workspaceId: dto.workspaceId });

    const existing = await this.medicationRepo.findByCode(dto.workspaceId, dto.code);
    if (existing) {
      throw new ConflictException(`Medication with code ${dto.code} already exists`);
    }

    const entity = this.dataSource.getRepository(MedicationItem).create({
      ...dto,
      type: dto.type || ItemType.MEDICATION,
      totalQuantity: 0,
      availableQuantity: 0,
      reservedQuantity: 0,
      totalPackCount: 0,
    });

    const saved = await this.dataSource.getRepository(MedicationItem).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: dto.workspaceId,
        userId: 'system',
        action: `Created medication item: ${dto.name}`,
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'MedicationItem',
        resourceId: saved.id,
        newState: { code: dto.code, name: dto.name },
      });
    } catch (e) {
      this.logger.warn('Audit log failed for medication creation', this.context);
    }

    return MedicationItemResponseDto.fromEntity(saved);
  }

  async findAll(
    workspaceId: string,
    query: QueryMedicationItemDto,
  ): Promise<IPaginatedResult<MedicationItemResponseDto>> {
    const result = await this.medicationRepo.findByWorkspace(workspaceId, query);
    return {
      data: result.data.map(MedicationItemResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(workspaceId: string, id: string): Promise<MedicationItemResponseDto> {
    const entity = await this.medicationRepo.findWithBatches(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Medication item ${id} not found`);
    }
    return MedicationItemResponseDto.fromEntity(entity);
  }

  async findByCode(workspaceId: string, code: string): Promise<MedicationItemResponseDto> {
    const entity = await this.medicationRepo.findByCode(workspaceId, code);
    if (!entity) {
      throw new NotFoundException(`Medication item with code ${code} not found`);
    }
    return MedicationItemResponseDto.fromEntity(entity);
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateMedicationItemDto,
  ): Promise<MedicationItemResponseDto> {
    const entity = await this.medicationRepo.findWithBatches(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Medication item ${id} not found`);
    }

    const previousState = { ...entity };
    Object.assign(entity, dto);
    const saved = await this.dataSource.getRepository(MedicationItem).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: 'system',
        action: `Updated medication item: ${entity.name}`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'MedicationItem',
        resourceId: id,
        previousState: { name: previousState.name, unitCost: previousState.unitCost },
        newState: dto,
      });
    } catch (e) {
      this.logger.warn('Audit log failed for medication update', this.context);
    }

    return MedicationItemResponseDto.fromEntity(saved);
  }

  async softDelete(workspaceId: string, id: string, deletedBy: string): Promise<void> {
    const entity = await this.medicationRepo.findWithBatches(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Medication item ${id} not found`);
    }

    entity.isDeleted = true;
    entity.isActive = false;
    entity.deletedBy = deletedBy;
    entity.deletedAt = new Date();
    await this.dataSource.getRepository(MedicationItem).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: deletedBy,
        action: `Soft deleted medication item: ${entity.name}`,
        eventType: AuditEventType.DELETE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'MedicationItem',
        resourceId: id,
      });
    } catch (e) {
      this.logger.warn('Audit log failed for medication deletion', this.context);
    }
  }

  async findLowStock(workspaceId: string): Promise<MedicationItemResponseDto[]> {
    const items = await this.medicationRepo.findLowStock(workspaceId);
    return items.map(MedicationItemResponseDto.fromEntity);
  }

  async findOutOfStock(workspaceId: string): Promise<MedicationItemResponseDto[]> {
    const items = await this.medicationRepo.findOutOfStock(workspaceId);
    return items.map(MedicationItemResponseDto.fromEntity);
  }

  async findPrescriptionItems(workspaceId: string): Promise<MedicationItemResponseDto[]> {
    const items = await this.medicationRepo.findPrescriptionItems(workspaceId);
    return items.map(MedicationItemResponseDto.fromEntity);
  }

  async findControlledSubstances(workspaceId: string): Promise<MedicationItemResponseDto[]> {
    const items = await this.medicationRepo.findControlledSubstances(workspaceId);
    return items.map(MedicationItemResponseDto.fromEntity);
  }
}
