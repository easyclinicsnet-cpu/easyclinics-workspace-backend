import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, IsUUID, Min, IsObject } from 'class-validator';
import { ItemType, MovementType } from '../../../../common/enums';

export class CreateMovementDto {
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

  @IsEnum(MovementType)
  @IsNotEmpty()
  movementType: MovementType;

  @IsString()
  @IsNotEmpty()
  department: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  initiatedBy?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class QueryMovementDto {
  @IsUUID()
  @IsOptional()
  workspaceId?: string;

  @IsUUID()
  @IsOptional()
  itemId?: string;

  @IsEnum(ItemType)
  @IsOptional()
  itemType?: ItemType;

  @IsEnum(MovementType)
  @IsOptional()
  movementType?: MovementType;

  @IsString()
  @IsOptional()
  department?: string;

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
