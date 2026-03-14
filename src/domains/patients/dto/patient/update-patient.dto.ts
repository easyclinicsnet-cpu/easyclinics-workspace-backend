import {
  IsString,
  IsOptional,
  IsDateString,
  IsEnum,
  IsBoolean,
  IsUUID,
  ValidateIf,
  Matches,
  IsEmail,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '../../constants/patient.constants';

/**
 * Update Patient DTO
 * Used for partial updates to existing patient records with full validation
 *
 * Multi-tenancy: workspaceId is required for validation
 * Encryption: firstName, lastName, gender, birthDate, phoneNumber, email, city, address, nationalId are encrypted
 * Insurance: Optional insurance update support with conditional validation
 * Pattern: All fields optional except workspaceId (for tenant validation)
 */
export class UpdatePatientDto {
  // ===== MULTI-TENANCY =====
  // workspaceId is injected from the JWT token by the controller (req.workspaceId),
  // NOT from the request body. Validation must be optional here because the
  // global ValidationPipe runs before the controller can assign it.
  @ApiPropertyOptional({
    description: 'Workspace ID for multi-tenant validation (injected from JWT, do not send in body)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Workspace ID must be a valid UUID' })
  workspaceId?: string;

  // ===== PATIENT DEMOGRAPHICS (ALL OPTIONAL, ENCRYPTED) =====
  @ApiPropertyOptional({
    description: 'Patient first name (will be transformed to UPPERCASE, encrypted)',
    example: 'JOHN',
    maxLength: 255,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsString({ message: 'First name must be a string' })
  @IsOptional()
  @MaxLength(255, { message: 'First name cannot exceed 255 characters' })
  firstName?: string;

  @ApiPropertyOptional({
    description: 'Patient last name (will be transformed to UPPERCASE, encrypted)',
    example: 'DOE',
    maxLength: 255,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsString({ message: 'Last name must be a string' })
  @IsOptional()
  @MaxLength(255, { message: 'Last name cannot exceed 255 characters' })
  lastName?: string;

  @ApiPropertyOptional({
    description: 'Patient gender (encrypted)',
    enum: Gender,
    example: Gender.MALE,
  })
  @IsEnum(Gender, { message: 'Gender must be one of: MALE, FEMALE, OTHER, UNSPECIFIED' })
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional({
    description: 'Patient birth date in ISO 8601 format (encrypted)',
    example: '1990-05-15',
    format: 'date',
  })
  @IsDateString({}, { message: 'Birth date must be a valid ISO 8601 date string' })
  @IsOptional()
  birthDate?: string;

  // ===== CONTACT INFORMATION (ALL OPTIONAL, ENCRYPTED) =====
  @ApiPropertyOptional({
    description: 'Patient phone number — E.164 preferred (e.g. +27821234567) or local format (e.g. 0821234567) (encrypted)',
    example: '+27821234567',
    maxLength: 255,
  })
  @IsOptional()
  @IsString({ message: 'Phone number must be a string' })
  @Matches(/^\+?[\d\s\-\(\)]{6,20}$/, {
    message: 'Phone number must contain only digits, spaces, hyphens, or parentheses (6–20 characters)',
  })
  @MaxLength(255, { message: 'Phone number cannot exceed 255 characters' })
  phoneNumber?: string;

  @ApiPropertyOptional({
    description: 'Patient email address (encrypted)',
    example: 'john.doe@example.com',
    format: 'email',
    maxLength: 255,
  })
  @Transform(({ value }) => value?.toString().trim().toLowerCase())
  @IsOptional()
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(255, { message: 'Email cannot exceed 255 characters' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Patient city or town (encrypted)',
    example: 'CAPE TOWN',
    maxLength: 255,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsOptional()
  @IsString({ message: 'City must be a string' })
  @MaxLength(255, { message: 'City cannot exceed 255 characters' })
  city?: string;

  @ApiPropertyOptional({
    description: 'Patient physical address (encrypted)',
    example: '123 MAIN STREET, GARDENS',
    maxLength: 255,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsOptional()
  @IsString({ message: 'Address must be a string' })
  @MaxLength(255, { message: 'Address cannot exceed 255 characters' })
  address?: string;

  @ApiPropertyOptional({
    description: 'Patient national ID or passport number (encrypted)',
    example: '9005155800088',
    maxLength: 255,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsOptional()
  @IsString({ message: 'National ID must be a string' })
  @MaxLength(255, { message: 'National ID cannot exceed 255 characters' })
  nationalId?: string;

  // ===== IDENTIFIERS (ALL OPTIONAL) =====
  @ApiPropertyOptional({
    description: 'External system ID for integration purposes',
    example: 'EXT-12345',
    maxLength: 255,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsOptional()
  @IsString({ message: 'External ID must be a string' })
  @MaxLength(255, { message: 'External ID cannot exceed 255 characters' })
  externalId?: string;

  @ApiPropertyOptional({
    description: 'Patient file number (unique within workspace)',
    example: 'PAT-2024-001',
    maxLength: 255,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsOptional()
  @IsString({ message: 'File number must be a string' })
  @MaxLength(255, { message: 'File number cannot exceed 255 characters' })
  fileNumber?: string;

  // ===== STATUS FLAGS =====
  @ApiPropertyOptional({
    description: 'Patient active status',
    example: true,
    default: true,
  })
  @IsBoolean({ message: 'Is active must be a boolean' })
  @IsOptional()
  isActive?: boolean;

  // ===== DEPRECATED INSURANCE FIELDS (ENCRYPTED) =====
  @ApiPropertyOptional({
    description: 'DEPRECATED: Legacy medical aid field (encrypted). Use new insurance fields instead.',
    example: 'DISCOVERY HEALTH',
    maxLength: 255,
    deprecated: true,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsOptional()
  @IsString({ message: 'Medical aid must be a string' })
  @MaxLength(255, { message: 'Medical aid cannot exceed 255 characters' })
  medicalAid?: string;

  @ApiPropertyOptional({
    description: 'DEPRECATED: Legacy membership number (encrypted). Use insuranceMembershipNumber instead.',
    example: 'MEM-123456',
    maxLength: 255,
    deprecated: true,
  })
  @Transform(({ value }) => value?.toString().trim().toUpperCase())
  @IsOptional()
  @IsString({ message: 'Membership number must be a string' })
  @MaxLength(255, { message: 'Membership number cannot exceed 255 characters' })
  membershipNumber?: string;

  // ===== NEW INSURANCE FIELDS (CONDITIONAL VALIDATION) =====
  @ApiPropertyOptional({
    description: 'Flag to update patient insurance record',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Update patient insurance must be a boolean' })
  updatePatientInsurance?: boolean;

  @ApiPropertyOptional({
    description: 'Insurance provider ID (required when updatePatientInsurance is true)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @ValidateIf((o) => o.updatePatientInsurance === true)
  @IsNotEmpty({ message: 'Insurance provider ID is required when updating insurance' })
  @IsUUID('all', { message: 'Insurance provider ID must be a valid UUID' })
  insuranceProviderId?: string;

  @ApiPropertyOptional({
    description: 'Insurance scheme ID (required when updatePatientInsurance is true)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @ValidateIf((o) => o.updatePatientInsurance === true)
  @IsNotEmpty({ message: 'Insurance scheme ID is required when updating insurance' })
  @IsUUID('all', { message: 'Insurance scheme ID must be a valid UUID' })
  schemeId?: string;

  @ApiPropertyOptional({
    description: 'Insurance membership number (required when updatePatientInsurance is true). Also accepted as legacy field "membershipNumber".',
    example: 'INS-2024-001',
    maxLength: 255,
  })
  // Accept both `insuranceMembershipNumber` and the legacy `membershipNumber` field.
  @Transform(({ value, obj }) => value ?? (obj as any).membershipNumber)
  @ValidateIf((o) => o.updatePatientInsurance === true)
  @IsNotEmpty({ message: 'Insurance membership number is required when updating insurance' })
  @IsString({ message: 'Insurance membership number must be a string' })
  @MaxLength(255, { message: 'Insurance membership number cannot exceed 255 characters' })
  insuranceMembershipNumber?: string;

  @ApiPropertyOptional({
    description: 'Member type (required when updatePatientInsurance is true)',
    enum: ['PRINCIPAL', 'DEPENDENT'],
    example: 'PRINCIPAL',
  })
  @ValidateIf((o) => o.updatePatientInsurance === true)
  @IsNotEmpty({ message: 'Member type is required when updating insurance' })
  @IsEnum(['PRINCIPAL', 'DEPENDENT'], {
    message: 'Member type must be either PRINCIPAL or DEPENDENT',
  })
  memberType?: 'PRINCIPAL' | 'DEPENDENT';
}
