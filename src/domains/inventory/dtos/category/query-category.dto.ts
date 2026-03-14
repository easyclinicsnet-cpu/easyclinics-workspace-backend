import { IsString, IsOptional, IsEnum, IsBoolean, IsUUID, IsNumber, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ItemType } from '../../../../common/enums';

export class QueryCategoryDto {
  @IsUUID()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(ItemType)
  @IsOptional()
  type?: ItemType;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;

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
