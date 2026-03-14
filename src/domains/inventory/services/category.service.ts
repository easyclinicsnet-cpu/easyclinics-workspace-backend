import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { CategoryRepository } from '../repositories/category.repository';
import { InventoryCategory } from '../entities/inventory-category.entity';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  QueryCategoryDto,
  CategoryResponseDto,
} from '../dtos/category';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

@Injectable()
export class CategoryService {
  private readonly context = CategoryService.name;

  constructor(
    private readonly categoryRepo: CategoryRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    this.logger.log('Creating category', { context: this.context, code: dto.code, workspaceId: dto.workspaceId });

    const existing = await this.categoryRepo.findByCode(dto.workspaceId, dto.code);
    if (existing) {
      throw new ConflictException(`Category with code ${dto.code} already exists`);
    }

    const entity = await this.categoryRepo.create({ ...dto });

    try {
      await this.auditLogService.log({
        workspaceId: dto.workspaceId,
        userId: 'system',
        action: `Created category: ${dto.name}`,
        eventType: AuditEventType.CREATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'InventoryCategory',
        resourceId: entity.id,
        newState: { code: dto.code, name: dto.name },
      });
    } catch (e) {
      this.logger.warn('Audit log failed for category creation', this.context);
    }

    return CategoryResponseDto.fromEntity(entity);
  }

  async findAll(
    workspaceId: string,
    query: QueryCategoryDto,
  ): Promise<IPaginatedResult<CategoryResponseDto>> {
    const result = await this.categoryRepo.findByWorkspace(workspaceId, query);
    return {
      data: result.data.map(CategoryResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(workspaceId: string, id: string): Promise<CategoryResponseDto> {
    const entity = await this.categoryRepo.findById(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Category ${id} not found`);
    }
    return CategoryResponseDto.fromEntity(entity);
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const entity = await this.categoryRepo.findById(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Category ${id} not found`);
    }

    Object.assign(entity, dto);
    const saved = await this.categoryRepo.save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId: 'system',
        action: `Updated category: ${entity.name}`,
        eventType: AuditEventType.UPDATE,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'InventoryCategory',
        resourceId: id,
        newState: dto,
      });
    } catch (e) {
      this.logger.warn('Audit log failed for category update', this.context);
    }

    return CategoryResponseDto.fromEntity(saved);
  }

  async findTree(workspaceId: string): Promise<CategoryResponseDto[]> {
    const tree = await this.categoryRepo.findTree(workspaceId);
    return tree.map(CategoryResponseDto.fromEntity);
  }

  async softDelete(workspaceId: string, id: string, deletedBy: string): Promise<void> {
    const entity = await this.categoryRepo.findById(workspaceId, id);
    if (!entity) {
      throw new NotFoundException(`Category ${id} not found`);
    }

    entity.isDeleted = true;
    entity.isActive = false;
    entity.deletedBy = deletedBy;
    entity.deletedAt = new Date();
    await this.categoryRepo.save(entity);
  }
}
