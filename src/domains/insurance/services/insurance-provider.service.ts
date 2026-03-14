import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { InsuranceProvider, ProviderStatus } from '../entities/insurance-provider.entity';
import { InsuranceProviderRepository } from '../repositories/insurance-provider.repository';
import {
  CreateInsuranceProviderDto,
  UpdateInsuranceProviderDto,
  QueryInsuranceProviderDto,
  InsuranceProviderResponseDto,
} from '../dtos';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

@Injectable()
export class InsuranceProviderService {
  private readonly context = InsuranceProviderService.name;

  constructor(
    private readonly providerRepo: InsuranceProviderRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  async create(dto: CreateInsuranceProviderDto): Promise<InsuranceProviderResponseDto> {
    this.logger.log('Creating insurance provider', { context: this.context, code: dto.providerCode });

    const existing = await this.providerRepo.findByCode(dto.providerCode);
    if (existing) {
      throw new ConflictException(`Insurance provider with code "${dto.providerCode}" already exists`);
    }

    const entity = this.dataSource.getRepository(InsuranceProvider).create({
      ...dto,
      status:     ProviderStatus.ACTIVE,
      isActive:   true,
      isDeleted:  false,
    });

    const saved = await this.dataSource.getRepository(InsuranceProvider).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: 'system',
        userId:      'system',
        action:      `Created insurance provider: ${saved.name}`,
        eventType:   AuditEventType.CREATE,
        outcome:     AuditOutcome.SUCCESS,
        resourceType: 'InsuranceProvider',
        resourceId:  saved.id,
        newState:    { code: dto.providerCode, name: dto.name },
      });
    } catch {
      this.logger.warn('Audit log failed for provider creation', { context: this.context });
    }

    return InsuranceProviderResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async findAll(query: QueryInsuranceProviderDto): Promise<IPaginatedResult<InsuranceProviderResponseDto>> {
    const result = await this.providerRepo.findWithFilters(query);
    return {
      data: result.data.map(InsuranceProviderResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(id: string): Promise<InsuranceProviderResponseDto> {
    const entity = await this.providerRepo.findOne({
      where: { id, isDeleted: false },
    });
    if (!entity) throw new NotFoundException(`Insurance provider ${id} not found`);
    return InsuranceProviderResponseDto.fromEntity(entity);
  }

  async findByCode(code: string): Promise<InsuranceProviderResponseDto> {
    const entity = await this.providerRepo.findByCode(code);
    if (!entity) throw new NotFoundException(`Insurance provider with code "${code}" not found`);
    return InsuranceProviderResponseDto.fromEntity(entity);
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  async update(
    id: string,
    dto: UpdateInsuranceProviderDto,
    userId: string,
  ): Promise<InsuranceProviderResponseDto> {
    const entity = await this.providerRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Insurance provider ${id} not found`);

    const previousState = { name: entity.name, status: entity.status };
    Object.assign(entity, dto);
    const saved = await this.dataSource.getRepository(InsuranceProvider).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: 'system',
        userId,
        action:      `Updated insurance provider: ${entity.name}`,
        eventType:   AuditEventType.UPDATE,
        outcome:     AuditOutcome.SUCCESS,
        resourceType: 'InsuranceProvider',
        resourceId:  id,
        previousState,
        newState:    dto,
      });
    } catch {
      this.logger.warn('Audit log failed for provider update', { context: this.context });
    }

    return InsuranceProviderResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // STATUS MANAGEMENT
  // ==========================================================================

  async updateStatus(
    id: string,
    status: ProviderStatus,
    userId: string,
  ): Promise<InsuranceProviderResponseDto> {
    return this.update(id, { status } as UpdateInsuranceProviderDto, userId);
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  async softDelete(id: string, deletedBy: string): Promise<void> {
    const entity = await this.providerRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Insurance provider ${id} not found`);

    entity.isDeleted  = true;
    entity.isActive   = false;
    entity.deletedBy  = deletedBy;
    entity.deletedAt  = new Date();

    await this.dataSource.getRepository(InsuranceProvider).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId: 'system',
        userId:      deletedBy,
        action:      `Soft-deleted insurance provider: ${entity.name}`,
        eventType:   AuditEventType.DELETE,
        outcome:     AuditOutcome.SUCCESS,
        resourceType: 'InsuranceProvider',
        resourceId:  id,
      });
    } catch {
      this.logger.warn('Audit log failed for provider deletion', { context: this.context });
    }
  }
}
