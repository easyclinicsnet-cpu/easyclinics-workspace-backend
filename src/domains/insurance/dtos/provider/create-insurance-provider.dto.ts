import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsDateString,
  IsObject,
  IsNotEmpty,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInsuranceProviderDto {
  @ApiProperty({ example: 'PROV-001', description: 'Unique provider code' })
  @IsString()
  @IsNotEmpty()
  providerCode!: string;

  @ApiProperty({ example: 'Jubilee Insurance Company', description: 'Full legal name of the insurance provider' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Jubilee', description: 'Short display name used in dropdowns' })
  @IsString()
  @IsOptional()
  shortName?: string;

  @ApiPropertyOptional({ description: 'Description / overview of the insurance provider' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Contact information JSON — phone, email, fax, website, etc.',
    example: { phone: '+254-700-000-000', email: 'claims@jubilee.ke' },
  })
  @IsObject()
  @IsOptional()
  contactInfo?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Processing time configuration JSON — turnaround days per claim type',
    example: { standard: 5, complex: 15 },
  })
  @IsObject()
  @IsOptional()
  processingTimes?: Record<string, any>;

  @ApiPropertyOptional({ default: false, description: 'Whether prior authorisation is required for claims' })
  @IsBoolean()
  @IsOptional()
  requiresPreAuthorization?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Whether the provider accepts electronic claim submission' })
  @IsBoolean()
  @IsOptional()
  supportsElectronicClaims?: boolean;

  @ApiPropertyOptional({ example: 'HL7 FHIR', description: 'Electronic claim format (HL7, X12 837, etc.)' })
  @IsString()
  @IsOptional()
  claimsSubmissionFormat?: string;

  @ApiPropertyOptional({ example: 20, minimum: 0, maximum: 100, description: 'Default patient copayment percentage' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  defaultCopaymentPercentage?: number;

  @ApiPropertyOptional({ example: 500000, description: 'Maximum single-claim amount accepted by this provider' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  maximumClaimAmount?: number;

  @ApiPropertyOptional({ example: 100, description: 'Minimum single-claim amount (below this, claim is rejected)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  minimumClaimAmount?: number;

  @ApiPropertyOptional({ example: 'CONTRACT-2024-001', description: 'Current active contract reference number' })
  @IsString()
  @IsOptional()
  contractNumber?: string;

  @ApiPropertyOptional({ example: '2024-01-01', description: 'Contract start date (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  contractStartDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Contract end date (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  contractEndDate?: string;

  @ApiPropertyOptional({ description: 'Terms and conditions text' })
  @IsString()
  @IsOptional()
  termsAndConditions?: string;

  @ApiPropertyOptional({ example: '123 Insurance Ave, Nairobi', description: 'Physical address of the provider' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON for custom integrations' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
