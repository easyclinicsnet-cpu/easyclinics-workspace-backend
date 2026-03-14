import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsDateString,
  IsObject,
  IsNotEmpty,
  IsEnum,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SchemeType } from '../../entities/insurance-scheme.entity';

export class CreateInsuranceSchemeDto {
  @ApiProperty({ description: 'UUID of the parent insurance provider', format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  providerId!: string;

  @ApiProperty({ example: 'SCH-JUBILEE-HMO-001', description: 'Unique scheme code' })
  @IsString()
  @IsNotEmpty()
  schemeCode!: string;

  @ApiProperty({ example: 'Jubilee Premier HMO', description: 'Full scheme name' })
  @IsString()
  @IsNotEmpty()
  schemeName!: string;

  @ApiPropertyOptional({ enum: SchemeType, default: SchemeType.OTHER, description: 'Scheme / plan type' })
  @IsEnum(SchemeType)
  @IsOptional()
  schemeType?: SchemeType;

  @ApiPropertyOptional({ description: 'Scheme description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 80, minimum: 0, maximum: 100, description: 'Default coverage percentage for services' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  defaultCoveragePercentage?: number;

  @ApiPropertyOptional({ description: 'Coverage rules JSON — per service category coverage rates' })
  @IsObject()
  @IsOptional()
  coverageRules?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Benefit limits JSON — annual/lifetime caps per benefit type' })
  @IsObject()
  @IsOptional()
  benefitLimits?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Authorisation requirements JSON — required docs per service type' })
  @IsObject()
  @IsOptional()
  authorizationRequirements?: Record<string, any>;

  @ApiPropertyOptional({ default: false, description: 'Whether pre-authorisation is required under this scheme' })
  @IsBoolean()
  @IsOptional()
  requiresPreAuthorization?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Whether coverage is restricted to network providers' })
  @IsBoolean()
  @IsOptional()
  restrictedToNetwork?: boolean;

  @ApiPropertyOptional({ description: 'Comma-separated or JSON list of network providers' })
  @IsString()
  @IsOptional()
  networkProviders?: string;

  @ApiPropertyOptional({ example: 20, minimum: 0, maximum: 100, description: 'Out-of-network penalty percentage' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  outOfNetworkPenalty?: number;

  @ApiPropertyOptional({ example: 2500, minimum: 0, description: 'Monthly premium amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  monthlyPremium?: number;

  @ApiPropertyOptional({ example: 50000, minimum: 0, description: 'Annual deductible amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  annualDeductible?: number;

  @ApiPropertyOptional({ example: 500, minimum: 0, description: 'Fixed copayment amount per visit' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  copaymentAmount?: number;

  @ApiPropertyOptional({ example: '2024-01-01', description: 'Scheme effective date (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  effectiveDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Scheme expiry date (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
