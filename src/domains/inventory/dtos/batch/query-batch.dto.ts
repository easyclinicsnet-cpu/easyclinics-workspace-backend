import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean, IsUUID, IsDateString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ItemType } from '../../../../common/enums';
import { BatchSortField } from '../../enums';

export class QueryBatchDto {
  @IsUUID()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  batchNumber?: string;

  @IsEnum(ItemType)
  @IsOptional()
  itemType?: ItemType;

  @IsUUID()
  @IsOptional()
  medicationItemId?: string;

  @IsUUID()
  @IsOptional()
  consumableItemId?: string;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isSterile?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isQuarantined?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isExpired?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isExpiringSoon?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  hasStock?: boolean;

  @IsDateString()
  @IsOptional()
  expiryDateFrom?: string;

  @IsDateString()
  @IsOptional()
  expiryDateTo?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 25;

  @IsEnum(BatchSortField)
  @IsOptional()
  sortBy?: BatchSortField = BatchSortField.EXPIRY_DATE;

  @IsString()
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'ASC';
}
