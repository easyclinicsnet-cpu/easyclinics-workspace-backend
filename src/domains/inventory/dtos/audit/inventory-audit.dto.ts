import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsUUID, Min, IsDateString, IsObject } from 'class-validator';
import { ItemType } from '../../../../common/enums';
import { InventoryAudit } from '../../entities/inventory-audit.entity';

export class CreateInventoryAuditDto {
  @IsUUID()
  @IsNotEmpty()
  workspaceId: string;

  @IsUUID()
  @IsNotEmpty()
  itemId: string;

  @IsEnum(ItemType)
  @IsNotEmpty()
  itemType: ItemType;

  @IsUUID()
  @IsOptional()
  batchId?: string;

  @IsNumber()
  @Min(0)
  systemQuantity: number;

  @IsNumber()
  @Min(0)
  physicalQuantity: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsNotEmpty()
  auditedBy: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class QueryInventoryAuditDto {
  @IsUUID()
  @IsOptional()
  workspaceId?: string;

  @IsUUID()
  @IsOptional()
  itemId?: string;

  @IsEnum(ItemType)
  @IsOptional()
  itemType?: ItemType;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  page?: number = 1;
  limit?: number = 25;
  sortBy?: string = 'auditDate';
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class InventoryAuditResponseDto {
  id: string;
  workspaceId: string;
  itemId: string;
  itemType: ItemType;
  batchId?: string;
  systemQuantity: number;
  physicalQuantity: number;
  variance: number;
  notes?: string;
  auditedBy?: string;
  auditDate: string;
  approvedBy?: string;
  approvalDate?: string;
  metadata?: Record<string, any>;
  createdAt: string;

  static fromEntity(entity: InventoryAudit): InventoryAuditResponseDto {
    const dto = new InventoryAuditResponseDto();
    dto.id = entity.id;
    dto.workspaceId = entity.workspaceId;
    dto.itemId = entity.itemId;
    dto.itemType = entity.itemType;
    dto.batchId = entity.batchId;
    dto.systemQuantity = Number(entity.systemQuantity);
    dto.physicalQuantity = Number(entity.physicalQuantity);
    dto.variance = Number(entity.variance);
    dto.notes = entity.notes;
    dto.auditedBy = entity.auditedBy;
    dto.auditDate = entity.auditDate?.toISOString();
    dto.approvedBy = entity.approvedBy;
    dto.approvalDate = entity.approvalDate?.toISOString();
    dto.metadata = entity.metadata;
    dto.createdAt = entity.createdAt?.toISOString();
    return dto;
  }
}
