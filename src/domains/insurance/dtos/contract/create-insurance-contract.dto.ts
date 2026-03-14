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
  IsEmail,
  IsInt,
  IsUrl,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContractType, PaymentTerms } from '../../entities/insurance-contract.entity';

export class CreateInsuranceContractDto {
  @ApiProperty({ example: 'CONTRACT-2024-JUBILEE-001', description: 'Unique contract reference number' })
  @IsString()
  @IsNotEmpty()
  contractNumber!: string;

  @ApiProperty({ description: 'UUID of the insurance provider this contract is with', format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  insuranceProviderId!: string;

  @ApiPropertyOptional({ description: 'UUID of the specific scheme this contract covers (null = all schemes)', format: 'uuid' })
  @IsUUID()
  @IsOptional()
  schemeId?: string;

  @ApiProperty({ example: 'Jubilee 2024 HMO Master Agreement', description: 'Human-readable contract name' })
  @IsString()
  @IsNotEmpty()
  contractName!: string;

  @ApiPropertyOptional({ enum: ContractType, default: ContractType.STANDARD, description: 'Contract type / category' })
  @IsEnum(ContractType)
  @IsOptional()
  contractType?: ContractType;

  @ApiProperty({ example: '2024-01-01', description: 'Contract start date (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @ApiProperty({ example: '2026-12-31', description: 'Contract end date (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  endDate!: string;

  @ApiPropertyOptional({ example: '2023-12-01', description: 'Date on which the contract was signed (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  signedDate?: string;

  @ApiPropertyOptional({ example: 'Dr. Jane Doe', description: 'Name of the signatory' })
  @IsString()
  @IsOptional()
  signedBy?: string;

  @ApiPropertyOptional({ example: 365, description: 'Renewal period in days (e.g. 365 for annual)' })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  renewalPeriodDays?: number;

  @ApiPropertyOptional({ default: true, description: 'Whether the contract renews automatically' })
  @IsBoolean()
  @IsOptional()
  autoRenew?: boolean;

  @ApiPropertyOptional({ example: 30, description: 'Notice period in days required before termination / non-renewal' })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  noticePeriodDays?: number;

  @ApiPropertyOptional({ description: 'Contract description / scope of services' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Full terms and conditions text' })
  @IsString()
  @IsOptional()
  termsAndConditions?: string;

  @ApiPropertyOptional({ example: 80, minimum: 0, maximum: 100, description: 'Default coverage % under this contract' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  defaultCoveragePercentage?: number;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 100, description: 'Facility discount % on billed amounts' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  discountPercentage?: number;

  @ApiPropertyOptional({ description: 'Coverage details JSON — service categories and coverage rates' })
  @IsObject()
  @IsOptional()
  coverageDetails?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Exclusions JSON — services not covered under this contract' })
  @IsObject()
  @IsOptional()
  exclusions?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Service rates JSON — negotiated rates per service code' })
  @IsObject()
  @IsOptional()
  serviceRates?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Benefit limits JSON — caps per benefit category' })
  @IsObject()
  @IsOptional()
  benefitLimits?: Record<string, any>;

  @ApiPropertyOptional({ enum: PaymentTerms, default: PaymentTerms.NET_30, description: 'Payment terms' })
  @IsEnum(PaymentTerms)
  @IsOptional()
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ example: 45, description: 'Custom payment days (only for PaymentTerms.CUSTOM)' })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  customPaymentDays?: number;

  @ApiPropertyOptional({ example: 500, description: 'Minimum claim amount accepted under this contract' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  minimumClaimAmount?: number;

  @ApiPropertyOptional({ example: 1000000, description: 'Maximum claim amount accepted under this contract' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  maximumClaimAmount?: number;

  @ApiPropertyOptional({ example: 5000000, description: 'Total annual contract value' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  annualContractValue?: number;

  @ApiPropertyOptional({ example: 250000, description: 'Monthly capitation amount (for CAPITATION type)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  monthlyCapitationAmount?: number;

  @ApiPropertyOptional({ example: 500, description: 'Estimated number of enrolled members' })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  estimatedEnrollees?: number;

  @ApiPropertyOptional({ default: false, description: 'Whether pre-authorisation is required for claims' })
  @IsBoolean()
  @IsOptional()
  requiresPreAuthorization?: boolean;

  @ApiPropertyOptional({ example: 30, description: 'Number of days a pre-authorisation is valid' })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  preAuthorizationValidityDays?: number;

  @ApiPropertyOptional({ default: true, description: 'Whether electronic claim submission is supported' })
  @IsBoolean()
  @IsOptional()
  supportsElectronicClaims?: boolean;

  @ApiPropertyOptional({ example: 'HL7 FHIR', description: 'Claims submission format' })
  @IsString()
  @IsOptional()
  claimsSubmissionFormat?: string;

  @ApiPropertyOptional({ example: 'claims@jubilee.ke', description: 'Claims submission email' })
  @IsEmail()
  @IsOptional()
  claimsSubmissionEmail?: string;

  @ApiPropertyOptional({ example: 'https://claims.jubilee.ke/submit', description: 'Claims submission portal URL' })
  @IsUrl()
  @IsOptional()
  claimsSubmissionUrl?: string;

  @ApiPropertyOptional({ example: 5, description: 'Number of business days to process a standard claim' })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  claimProcessingDays?: number;

  @ApiPropertyOptional({ example: 'John Mwangi', description: 'Primary contract contact person' })
  @IsString()
  @IsOptional()
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'john@jubilee.ke', description: 'Primary contact email' })
  @IsEmail()
  @IsOptional()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+254-700-100-200', description: 'Primary contact phone' })
  @IsString()
  @IsOptional()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'Mary Njeri', description: 'Billing contact person' })
  @IsString()
  @IsOptional()
  billingContactPerson?: string;

  @ApiPropertyOptional({ example: 'billing@jubilee.ke', description: 'Billing contact email' })
  @IsEmail()
  @IsOptional()
  billingContactEmail?: string;

  @ApiPropertyOptional({ example: '+254-700-200-300', description: 'Billing contact phone' })
  @IsString()
  @IsOptional()
  billingContactPhone?: string;

  @ApiPropertyOptional({ description: 'Special provisions or addenda' })
  @IsString()
  @IsOptional()
  specialProvisions?: string;

  @ApiPropertyOptional({ description: 'Internal notes about the contract' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
