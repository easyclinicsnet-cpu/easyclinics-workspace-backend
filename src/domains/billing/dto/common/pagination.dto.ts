import { IsNumber, IsOptional, Min, IsString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class PaginatedResponseMetaDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class BaseResponseDto {
  success: boolean;
  message?: string;
  error?: string;
}
