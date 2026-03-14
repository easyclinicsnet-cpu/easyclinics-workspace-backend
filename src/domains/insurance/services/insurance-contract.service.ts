import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../../common/logger/logger.service';
import { AuditLogService } from '../../audit/services/audit-log.service';
import { InsuranceContract } from '../entities/insurance-contract.entity';
import { ProviderStatus } from '../entities/insurance-provider.entity';
import { InsuranceContractRepository } from '../repositories/insurance-contract.repository';
import { InsuranceProviderRepository } from '../repositories/insurance-provider.repository';
import {
  CreateInsuranceContractDto,
  UpdateInsuranceContractDto,
  QueryInsuranceContractDto,
  InsuranceContractResponseDto,
} from '../dtos';
import { IPaginatedResult } from '../interfaces';
import { AuditEventType, AuditOutcome } from '../../../common/enums';

@Injectable()
export class InsuranceContractService {
  private readonly context = InsuranceContractService.name;

  constructor(
    private readonly contractRepo: InsuranceContractRepository,
    private readonly providerRepo: InsuranceProviderRepository,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ==========================================================================
  // CREATE
  // ==========================================================================

  async create(
    dto: CreateInsuranceContractDto,
    userId: string,
    workspaceId: string,
  ): Promise<InsuranceContractResponseDto> {
    this.logger.log('Creating insurance contract', {
      context:        this.context,
      workspaceId,
      contractNumber: dto.contractNumber,
    });

    // Validate provider exists
    const provider = await this.providerRepo.findOne({
      where: { id: dto.insuranceProviderId, isDeleted: false },
    });
    if (!provider) {
      throw new NotFoundException(`Insurance provider ${dto.insuranceProviderId} not found`);
    }

    // Check uniqueness within workspace
    const existing = await this.contractRepo.findByContractNumber(dto.contractNumber, workspaceId);
    if (existing) {
      throw new ConflictException(
        `Contract with number "${dto.contractNumber}" already exists in this workspace`,
      );
    }

    const entity = this.dataSource.getRepository(InsuranceContract).create({
      ...dto,
      workspaceId,
      createdByUserId: userId,
      status:          ProviderStatus.ACTIVE,
      isActive:        true,
      isDeleted:       false,
    });

    const saved = await this.dataSource.getRepository(InsuranceContract).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId,
        userId,
        action:       `Created insurance contract: ${saved.contractName}`,
        eventType:    AuditEventType.CREATE,
        outcome:      AuditOutcome.SUCCESS,
        resourceType: 'InsuranceContract',
        resourceId:   saved.id,
        newState:     { contractNumber: dto.contractNumber, name: dto.contractName },
      });
    } catch {
      this.logger.warn('Audit log failed for contract creation', { context: this.context });
    }

    return InsuranceContractResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async findAll(
    query: QueryInsuranceContractDto,
    workspaceId: string,
  ): Promise<IPaginatedResult<InsuranceContractResponseDto>> {
    const result = await this.contractRepo.findWithFilters(query, workspaceId);
    return {
      data: result.data.map(InsuranceContractResponseDto.fromEntity),
      meta: result.meta,
    };
  }

  async findById(id: string): Promise<InsuranceContractResponseDto> {
    const entity = await this.contractRepo.findOne({
      where: { id, isDeleted: false },
      relations: ['insuranceProvider', 'scheme'],
    });
    if (!entity) throw new NotFoundException(`Insurance contract ${id} not found`);
    return InsuranceContractResponseDto.fromEntity(entity);
  }

  async findByProvider(
    providerId: string,
    workspaceId: string,
  ): Promise<InsuranceContractResponseDto[]> {
    const entities = await this.contractRepo.findByProvider(providerId, workspaceId);
    return entities.map(InsuranceContractResponseDto.fromEntity);
  }

  async findExpiringSoon(
    workspaceId: string,
    days?: number,
  ): Promise<InsuranceContractResponseDto[]> {
    const entities = await this.contractRepo.findExpiringSoon(days, workspaceId);
    return entities.map(InsuranceContractResponseDto.fromEntity);
  }

  // ==========================================================================
  // UPDATE
  // ==========================================================================

  async update(
    id: string,
    dto: UpdateInsuranceContractDto,
    userId: string,
  ): Promise<InsuranceContractResponseDto> {
    const entity = await this.contractRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Insurance contract ${id} not found`);

    const previousState = { contractName: entity.contractName, status: entity.status };
    Object.assign(entity, dto);
    const saved = await this.dataSource.getRepository(InsuranceContract).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId:  entity.workspaceId,
        userId,
        action:       `Updated insurance contract: ${entity.contractName}`,
        eventType:    AuditEventType.UPDATE,
        outcome:      AuditOutcome.SUCCESS,
        resourceType: 'InsuranceContract',
        resourceId:   id,
        previousState,
        newState:     dto,
      });
    } catch {
      this.logger.warn('Audit log failed for contract update', { context: this.context });
    }

    return InsuranceContractResponseDto.fromEntity(saved);
  }

  // ==========================================================================
  // DELETE
  // ==========================================================================

  async softDelete(id: string, deletedBy: string): Promise<void> {
    const entity = await this.contractRepo.findOne({ where: { id, isDeleted: false } });
    if (!entity) throw new NotFoundException(`Insurance contract ${id} not found`);

    entity.isDeleted = true;
    entity.isActive  = false;
    entity.deletedBy = deletedBy;
    entity.deletedAt = new Date();

    await this.dataSource.getRepository(InsuranceContract).save(entity);

    try {
      await this.auditLogService.log({
        workspaceId:  entity.workspaceId,
        userId:       deletedBy,
        action:       `Soft-deleted insurance contract: ${entity.contractName}`,
        eventType:    AuditEventType.DELETE,
        outcome:      AuditOutcome.SUCCESS,
        resourceType: 'InsuranceContract',
        resourceId:   id,
      });
    } catch {
      this.logger.warn('Audit log failed for contract deletion', { context: this.context });
    }
  }
}
