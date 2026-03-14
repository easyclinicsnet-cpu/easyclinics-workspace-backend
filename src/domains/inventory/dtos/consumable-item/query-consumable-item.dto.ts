import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean, IsUUID, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ConsumableForm, ConsumableUnit } from '../../entities/consumable-item.entity';
import { StockStatus } from '../../enums';

export class QueryConsumableItemDto {
  @IsUUID()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(ConsumableForm)
  @IsOptional()
  form?: ConsumableForm;

  @IsEnum(ConsumableUnit)
  @IsOptional()
  unitOfMeasure?: ConsumableUnit;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isSterile?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isSingleUse?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isDisposable?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isReusable?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isSplittable?: boolean;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;

  @IsEnum(StockStatus)
  @IsOptional()
  stockStatus?: StockStatus;

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

  @IsString()
  @IsOptional()
  sortBy?: string = 'name';

  @IsString()
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'ASC';
}
