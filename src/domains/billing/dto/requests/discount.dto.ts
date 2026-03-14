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

export class CreateDiscountDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  discountType: string;

  @IsNumber()
  @Min(0)
  value: number;

  @IsBoolean()
  @IsOptional()
  isPercentage?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxDiscountAmount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  minPurchaseAmount?: number;

  @IsDateString()
  @IsOptional()
  validFrom?: string;

  @IsDateString()
  @IsOptional()
  validUntil?: string;

  @IsOptional()
  applicableServices?: any;

  @IsOptional()
  applicableDepartments?: any;

  @IsNumber()
  @IsOptional()
  @Min(0)
  usageLimit?: number;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateDiscountDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  discountType?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  value?: number;

  @IsBoolean()
  @IsOptional()
  isPercentage?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxDiscountAmount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  minPurchaseAmount?: number;

  @IsDateString()
  @IsOptional()
  validFrom?: string;

  @IsDateString()
  @IsOptional()
  validUntil?: string;

  @IsOptional()
  applicableServices?: any;

  @IsOptional()
  applicableDepartments?: any;

  @IsNumber()
  @IsOptional()
  @Min(0)
  usageLimit?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class DiscountQueryDto extends PaginationDto {
  @IsString()
  @IsOptional()
  discountType?: string;

  @IsOptional()
  isActive?: boolean;
}
