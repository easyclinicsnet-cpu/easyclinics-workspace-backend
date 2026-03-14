import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { InsuranceScheme } from '../entities/insurance-scheme.entity';
import { ProviderStatus } from '../entities/insurance-provider.entity';
import { InsuranceSchemeRepository } from '../repositories/insurance-scheme.repository';
import { InsuranceProviderRepository } from '../repositories/insurance-provider.repository';
import {
  CreateInsuranceSchemeDto,
  UpdateInsuranceSchemeDto,
  QueryInsuranceSchemeDto,
  InsuranceSchemeResponseDto,
} from '../dtos';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

@Injectable()
export class InsuranceSchemeService {
  private readonly context = InsuranceSchemeService.name;

  constructor(
    private readonly schemeRepo: InsuranceSchemeRepository,
    private readonly providerRepo: InsuranceProviderRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  async create(dto: CreateInsuranceSchemeDto): Promise<InsuranceSchemeResponseDto> {
    this.logger.log('Creating insurance scheme', { context: this.context, code: dto.schemeCode });

    // Validate provider exists
    const provider = await this.providerRepo.findOne({ where: { id: dto.providerId, isDeleted: false } });
    if (!provider) {
      throw new NotFoundException(`Insurance provider ${dto.providerId} not found`);
    }

    // Check uniqueness
    const existing = await this.schemeRepo.findByCode(dto.schemeCode);
    if (existing) {
      throw new ConflictException(`Insurance scheme with code "${dto.schemeCode}" already exists`);
    }

    const entity = this.dataSource.getRepository(InsuranceScheme).create({
      ...dto,
      status:    ProviderStatus.ACTIVE,
      isActive:  true,
      isDeleted: false,
    });

    const saved = await this.dataSource.getRepository(InsuranceScheme).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: 'system',
        userId:      'system',
        action:      `Created insurance scheme: ${saved.schemeName}`,
        eventType:   AuditEventType.CREATE,
        outcome:     AuditOutcome.SUCCESS,
        resourceType: 'InsuranceScheme',
        resourceId:  saved.id,
        newState:    { code: dto.schemeCode, name: dto.schemeName, providerId: dto.providerId },
      });
    } catch {
      this.logger.warn('Audit log failed for scheme creation', { context: this.context });
    }

    return InsuranceSchemeResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async findAll(query: QueryInsuranceSchemeDto): Promise<IPaginatedResult<InsuranceSchemeResponseDto>> {
    const result = await this.schemeRepo.findWithFilters(query);
    return {
      data: result.data.map(InsuranceSchemeResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(id: string): Promise<InsuranceSchemeResponseDto> {
    const entity = await this.schemeRepo.findOne({
      where: { id, isDeleted: false },
      relations: ['provider'],
    });
    if (!entity) throw new NotFoundException(`Insurance scheme ${id} not found`);
    return InsuranceSchemeResponseDto.fromEntity(entity);
  }

  async findByCode(code: string): Promise<InsuranceSchemeResponseDto> {
    const entity = await this.schemeRepo.findByCode(code);
    if (!entity) throw new NotFoundException(`Insurance scheme with code "${code}" not found`);
    return InsuranceSchemeResponseDto.fromEntity(entity);
  }

  async findByProvider(providerId: string): Promise<InsuranceSchemeResponseDto[]> {
    const entities = await this.schemeRepo.findByProvider(providerId);
    return entities.map(InsuranceSchemeResponseDto.fromEntity);
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  async update(
    id: string,
    dto: UpdateInsuranceSchemeDto,
    userId: string,
  ): Promise<InsuranceSchemeResponseDto> {
    const entity = await this.schemeRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Insurance scheme ${id} not found`);

    const previousState = { schemeName: entity.schemeName, status: entity.status };
    Object.assign(entity, dto);
    const saved = await this.dataSource.getRepository(InsuranceScheme).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: 'system',
        userId,
        action:      `Updated insurance scheme: ${entity.schemeName}`,
        eventType:   AuditEventType.UPDATE,
        outcome:     AuditOutcome.SUCCESS,
        resourceType: 'InsuranceScheme',
        resourceId:  id,
        previousState,
        newState:    dto,
      });
    } catch {
      this.logger.warn('Audit log failed for scheme update', { context: this.context });
    }

    return InsuranceSchemeResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  async softDelete(id: string, deletedBy: string): Promise<void> {
    const entity = await this.schemeRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Insurance scheme ${id} not found`);

    entity.isDeleted  = true;
    entity.isActive   = false;
    entity.deletedBy  = deletedBy;
    entity.deletedAt  = new Date();

    await this.dataSource.getRepository(InsuranceScheme).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: 'system',
        userId:      deletedBy,
        action:      `Soft-deleted insurance scheme: ${entity.schemeName}`,
        eventType:   AuditEventType.DELETE,
        outcome:     AuditOutcome.SUCCESS,
        resourceType: 'InsuranceScheme',
        resourceId:  id,
      });
    } catch {
      this.logger.warn('Audit log failed for scheme deletion', { context: this.context });
    }
  }
}
