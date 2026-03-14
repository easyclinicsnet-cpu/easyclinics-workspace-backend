import {
  IsOptional,
  IsPositive,
  IsString,
  IsBoolean,
  IsEnum,
  IsUUID,
  Min,
  Max,
  ValidateNested,
  IsInt,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '../../constants/patient.constants';

/**
 * Age Range Filter DTO
 * Nested DTO for filtering by age range
 */
export class AgeRangeDto {
  @ApiPropertyOptional({
    description: 'Minimum age in years',
    example: 18,
    minimum: 0,
    maximum: 150,
  })
  @IsOptional()
  @IsInt({ message: 'Minimum age must be an integer' })
  @Min(0, { message: 'Minimum age must be at least 0' })
  @Max(150, { message: 'Minimum age cannot exceed 150' })
  @Transform(({ value }) => parseInt(value, 10))
  min?: number;

  @ApiPropertyOptional({
    description: 'Maximum age in years',
    example: 65,
    minimum: 0,
    maximum: 150,
  })
  @IsOptional()
  @IsInt({ message: 'Maximum age must be an integer' })
  @Min(0, { message: 'Maximum age must be at least 0' })
  @Max(150, { message: 'Maximum age cannot exceed 150' })
  @Transform(({ value }) => parseInt(value, 10))
  max?: number;
}

// Assuming AppointmentStatus enum exists in appointments domain
enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  MISSED = 'MISSED',
  RESCHEDULED = 'RESCHEDULED',
}

/**
 * Query Patients DTO
 * Comprehensive filtering, sorting, and pagination for patient search
 *
 * Features:
 * - Multi-tenant filtering (required workspaceId)
 * - Full-text search across name and file number
 * - Multiple filter criteria (gender, city, phone, etc.)
 * - Age range filtering
 * - Appointment status filtering
 * - Insurance migration status
 * - Pagination support
 * - Flexible sorting
 */
export class QueryPatientsDto {
  // ===== MULTI-TENANCY =====
  // workspaceId is injected from the JWT token by the controller (req.workspaceId),
  // NOT from the request body/query. Validation must be optional here because the
  // global ValidationPipe runs before the controller can assign it.
  @ApiPropertyOptional({
    description: 'Workspace ID for multi-tenant filtering (injected from JWT, do not send in query)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Workspace ID must be a valid UUID' })
  workspaceId?: string;

  // ===== SEARCH =====
  @ApiPropertyOptional({
    description: 'Search by first name, last name, or file number (case-insensitive)',
    example: 'John',
  })
  @IsOptional()
  @IsString({ message: 'Search must be a string' })
  @Transform(({ value }) => value?.trim())
  search?: string;

  // ===== FILTERS =====
  @ApiPropertyOptional({
    description: 'Filter by specific file number',
    example: 'PAT-2024-001',
  })
  @IsOptional()
  @IsString({ message: 'File number must be a string' })
  fileNumber?: string;

  @ApiPropertyOptional({
    description: 'Filter by phone number',
    example: '+27821234567',
  })
  @IsOptional()
  @IsString({ message: 'Phone number must be a string' })
  phoneNumber?: string;

  @ApiPropertyOptional({
    description: 'Filter by email address',
    example: 'john.doe@example.com',
  })
  @IsOptional()
  @IsString({ message: 'Email must be a string' })
  email?: string;

  @ApiPropertyOptional({
    description: 'Filter by city',
    example: 'Cape Town',
  })
  @IsOptional()
  @IsString({ message: 'City must be a string' })
  city?: string;

  @ApiPropertyOptional({
    description: 'Filter by gender',
    enum: Gender,
    example: Gender.MALE,
  })
  @IsOptional()
  @IsEnum(Gender, { message: 'Gender must be one of: MALE, FEMALE, OTHER, UNSPECIFIED' })
  gender?: Gender;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Is active must be a boolean' })
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filter patients with active appointments',
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Has active appointments must be a boolean' })
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  hasActiveAppointments?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by appointment status (can filter by multiple)',
    enum: AppointmentStatus,
    isArray: true,
    example: [AppointmentStatus.SCHEDULED, AppointmentStatus.IN_PROGRESS],
  })
  @IsOptional()
  @IsEnum(AppointmentStatus, {
    each: true,
    message: 'Each appointment status must be a valid status',
  })
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (value) return [value];
    return undefined;
  })
  appointmentStatus?: AppointmentStatus[];

  @ApiPropertyOptional({
    description: 'Filter by insurance migration status',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Insurance migrated must be a boolean' })
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  insuranceMigrated?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by age range',
    type: AgeRangeDto,
    example: { min: 18, max: 65 },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgeRangeDto)
  ageRange?: AgeRangeDto;

  // ===== PAGINATION =====
  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsPositive({ message: 'Page must be a positive number' })
  @Transform(({ value }) => parseInt(value, 10))
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsPositive({ message: 'Limit must be a positive number' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit cannot exceed 100' })
  @Transform(({ value }) => parseInt(value, 10))
  limit: number = 10;

  // ===== SORTING =====
  @ApiPropertyOptional({
    description: 'Field to sort by',
    enum: ['firstName', 'lastName', 'fileNumber', 'birthDate', 'createdAt', 'updatedAt'],
    default: 'createdAt',
    example: 'lastName',
  })
  @IsOptional()
  @IsString({ message: 'Sort by must be a string' })
  @IsEnum(
    ['firstName', 'lastName', 'fileNumber', 'birthDate', 'createdAt', 'updatedAt'],
    {
      message: 'Sort by must be one of: firstName, lastName, fileNumber, birthDate, createdAt, updatedAt',
    },
  )
  sortBy: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
    example: 'ASC',
  })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'], { message: 'Sort direction must be ASC or DESC' })
  sortOrder: 'ASC' | 'DESC' = 'DESC';
}
