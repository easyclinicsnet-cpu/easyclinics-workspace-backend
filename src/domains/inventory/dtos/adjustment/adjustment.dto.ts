import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsUUID, Min, IsObject } from 'class-validator';
import { ItemType, AdjustmentType } from '../../../../common/enums';

export class CreateAdjustmentDto {
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
  @Min(0.0001)
  quantity: number;

  @IsEnum(AdjustmentType)
  @IsNotEmpty()
  adjustmentType: AdjustmentType;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsNotEmpty()
  initiatedBy: string;

  @IsString()
  @IsOptional()
  approvedBy?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class QueryAdjustmentDto {
  @IsUUID()
  @IsOptional()
  workspaceId?: string;

  @IsUUID()
  @IsOptional()
  itemId?: string;

  @IsEnum(ItemType)
  @IsOptional()
  itemType?: ItemType;

  @IsEnum(AdjustmentType)
  @IsOptional()
  adjustmentType?: AdjustmentType;

  @IsString()
  @IsOptional()
  dateFrom?: string;

  @IsString()
  @IsOptional()
  dateTo?: string;

  page?: number = 1;
  limit?: number = 25;
  sortBy?: string = 'createdAt';
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
