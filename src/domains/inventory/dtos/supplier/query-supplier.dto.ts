import { IsString, IsOptional, IsBoolean, IsUUID, IsNumber, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class QuerySupplierDto {
  @IsUUID()
  @IsOptional()
  workspaceId?: string;

  @IsString()
  @IsOptional()
  search?: string;

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
