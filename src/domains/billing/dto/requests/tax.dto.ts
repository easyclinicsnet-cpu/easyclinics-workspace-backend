import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

export class CreateTaxDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  taxType: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  rate: number;

  @IsBoolean()
  @IsOptional()
  isCompound?: boolean;

  @IsOptional()
  applicableServices?: any;

  @IsOptional()
  applicableDepartments?: any;

  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @IsDateString()
  @IsOptional()
  effectiveUntil?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateTaxDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  taxType?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  rate?: number;

  @IsBoolean()
  @IsOptional()
  isCompound?: boolean;

  @IsOptional()
  applicableServices?: any;

  @IsOptional()
  applicableDepartments?: any;

  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @IsDateString()
  @IsOptional()
  effectiveUntil?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class TaxQueryDto extends PaginationDto {
  @IsString()
  @IsOptional()
  taxType?: string;

  @IsOptional()
  isActive?: boolean;
}
