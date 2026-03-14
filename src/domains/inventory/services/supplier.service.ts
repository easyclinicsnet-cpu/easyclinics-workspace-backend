import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { SupplierRepository } from '../repositories/supplier.repository';
import { Supplier } from '../entities/supplier.entity';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  QuerySupplierDto,
  SupplierResponseDto,
} from '../dtos/supplier';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

@Injectable()
export class SupplierService {
  private readonly context = SupplierService.name;

  constructor(
    private readonly supplierRepo: SupplierRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateSupplierDto): Promise<SupplierResponseDto> {
    this.logger.log('Creating supplier', { context: this.context, code: dto.code, workspaceId: dto.workspaceId });

    const existing = await this.supplierRepo.findByCode(dto.workspaceId, dto.code);
    if (existing) {
      throw new ConflictException(`Supplier with code ${dto.code} already exists`);
    }

    const entity = this.dataSource.getRepository(Supplier).create({ ...dto });
    const saved = await this.dataSource.getRepository(Supplier).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: dto.workspaceId,
        userId: 'system',
        action: `Created supplier: ${dto.name}`,
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Supplier',
        resourceId: saved.id,
        newState: { code: dto.code, name: dto.name },
      });
    } catch (e) {
      this.logger.warn('Audit log failed for supplier creation', this.context);
    }

    return SupplierResponseDto.fromEntity(saved);
  }

  async findAll(
    workspaceId: string,
    query: QuerySupplierDto,
  ): Promise<IPaginatedResult<SupplierResponseDto>> {
    const result = await this.supplierRepo.findByWorkspace(workspaceId, query);
    return {
      data: result.data.map(SupplierResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(workspaceId: string, id: string): Promise<SupplierResponseDto> {
    const entity = await this.dataSource.getRepository(Supplier).findOne({
      where: { id, workspaceId, isDeleted: false },
    });
    if (!entity) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }
    return SupplierResponseDto.fromEntity(entity);
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierResponseDto> {
    const entity = await this.dataSource.getRepository(Supplier).findOne({
      where: { id, workspaceId, isDeleted: false },
    });
    if (!entity) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }

    Object.assign(entity, dto);
    const saved = await this.dataSource.getRepository(Supplier).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: 'system',
        action: `Updated supplier: ${entity.name}`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'Supplier',
        resourceId: id,
        newState: dto,
      });
    } catch (e) {
      this.logger.warn('Audit log failed for supplier update', this.context);
    }

    return SupplierResponseDto.fromEntity(saved);
  }

  async softDelete(workspaceId: string, id: string, deletedBy: string): Promise<void> {
    const entity = await this.dataSource.getRepository(Supplier).findOne({
      where: { id, workspaceId, isDeleted: false },
    });
    if (!entity) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }

    entity.isDeleted = true;
    entity.isActive = false;
    entity.deletedBy = deletedBy;
    entity.deletedAt = new Date();
    await this.dataSource.getRepository(Supplier).save(entity);
  }
}
