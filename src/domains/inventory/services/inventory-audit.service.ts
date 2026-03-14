import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { InventoryAuditRepository } from '../repositories/inventory-audit.repository';
import {
  CreateInventoryAuditDto,
  QueryInventoryAuditDto,
  InventoryAuditResponseDto,
} from '../dtos/audit';
import { IPaginatedResult } from '../interfaces';

@Injectable()
export class InventoryAuditService {
  private readonly context = InventoryAuditService.name;

  constructor(
    private readonly auditRepo: InventoryAuditRepository,
    private readonly logger: LoggerService,
  ) {}

  async create(dto: CreateInventoryAuditDto): Promise<InventoryAuditResponseDto> {
    this.logger.log('Creating inventory audit record', { context: this.context, itemId: dto.itemId });

    const entity = await this.auditRepo.save({
      ...dto,
      variance: dto.physicalQuantity - dto.systemQuantity,
      auditDate: new Date(),
    });

    return InventoryAuditResponseDto.fromEntity(entity);
  }

  async findAll(
    workspaceId: string,
    query: QueryInventoryAuditDto,
  ): Promise<IPaginatedResult<InventoryAuditResponseDto>> {
    const result = await this.auditRepo.findByWorkspace(workspaceId, query);
    return {
      data: result.data.map(InventoryAuditResponseDto.fromEntity),
      meta: result.meta,
    };
  }
}
