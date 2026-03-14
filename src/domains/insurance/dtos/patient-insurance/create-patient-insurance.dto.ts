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
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MemberType } from '../../entities/patient-insurance.entity';

export class CreatePatientInsuranceDto {
  @ApiProperty({ description: 'Patient UUID', format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  @ApiProperty({ description: 'Insurance provider UUID', format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  insuranceProviderId!: string;

  @ApiProperty({ description: 'Insurance scheme UUID', format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  schemeId!: string;

  @ApiProperty({ example: 'MBR-00123456', description: 'Unique membership / member number' })
  @IsString()
  @IsNotEmpty()
  membershipNumber!: string;

  @ApiPropertyOptional({ example: 'POL-2024-001', description: 'Policy number' })
  @IsString()
  @IsOptional()
  policyNumber?: string;

  @ApiPropertyOptional({ enum: MemberType, default: MemberType.PRINCIPAL, description: 'Whether principal or dependent member' })
  @IsEnum(MemberType)
  @IsOptional()
  memberType?: MemberType;

  @ApiPropertyOptional({ description: 'UUID of the principal member if this is a dependent' })
  @IsString()
  @IsOptional()
  principalMemberId?: string;

  @ApiPropertyOptional({ example: 'SPOUSE', description: 'Relationship to principal member (SPOUSE, CHILD, etc.)' })
  @IsString()
  @IsOptional()
  relationshipToPrincipal?: string;

  @ApiPropertyOptional({ default: true, description: 'Whether this is the patient\'s primary insurance' })
  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Priority order when multiple insurances exist (1 = highest)' })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  priority?: number;

  @ApiProperty({ example: '2024-01-01', description: 'Insurance effective date (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  effectiveDate!: string;

  @ApiProperty({ example: '2025-12-31', description: 'Insurance expiry date (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  expiryDate!: string;

  @ApiPropertyOptional({ example: '2024-01-15', description: 'Date of enrollment (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  enrollmentDate?: string;

  @ApiPropertyOptional({ example: 'AUTH-2024-XYZ', description: 'Current pre-authorisation number' })
  @IsString()
  @IsOptional()
  currentAuthorizationNumber?: string;

  @ApiPropertyOptional({ example: '2024-06-30', description: 'Expiry date of the current authorisation (ISO 8601)' })
  @IsDateString()
  @IsOptional()
  authorizationExpiryDate?: string;

  @ApiPropertyOptional({ description: 'Notes about the current authorisation' })
  @IsString()
  @IsOptional()
  authorizationNotes?: string;

  @ApiPropertyOptional({ example: 'Jane Wanjiku', description: 'Insurance contact person name' })
  @IsString()
  @IsOptional()
  insuranceContactPerson?: string;

  @ApiPropertyOptional({ example: '+254-700-000-000', description: 'Insurance contact phone' })
  @IsString()
  @IsOptional()
  insuranceContactPhone?: string;

  @ApiPropertyOptional({ example: 'claims@insurer.ke', description: 'Insurance contact email' })
  @IsEmail()
  @IsOptional()
  insuranceContactEmail?: string;

  @ApiPropertyOptional({ description: 'Arbitrary metadata JSON' })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
