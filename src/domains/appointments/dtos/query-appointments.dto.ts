import {
  IsOptional,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  Max,
  IsString,
  IsBoolean,
  ValidateIf,
  IsUUID,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, AppointmentType } from '../../../common/enums';

/**
 * DTO for querying appointments with pagination, filtering, and search
 */
export class QueryAppointmentsDto {
  @ApiPropertyOptional({
    description: 'Workspace ID for multi-tenancy',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    minimum: 1,
    default: 1,
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    minimum: 1,
    maximum: 100,
    default: 10,
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit: number = 10;

  @ApiPropertyOptional({
    enum: AppointmentStatus,
    description: 'Filter by appointment status',
    example: AppointmentStatus.SCHEDULED,
  })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    enum: AppointmentType,
    description: 'Filter by appointment type',
    example: AppointmentType.INITIAL,
  })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiPropertyOptional({
    description: 'Filter by specific date (YYYY-MM-DD format)',
    example: '2024-01-15',
  })
  @IsOptional()
  @IsDateString()
  date?: Date;

  @ApiPropertyOptional({
    description: 'Filter by date range (start date in YYYY-MM-DD format)',
    example: '2024-01-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by date range (end date in YYYY-MM-DD format)',
    example: '2024-01-31',
  })
  @ValidateIf((o) => o.startDate)
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by patient ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({
    description: 'Filter by practitioner ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  practitionerId?: string;

  @ApiPropertyOptional({
    description: 'Search term for patient name, notes, or appointment details',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Include cancelled appointments',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeCancelled?: boolean = false;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['date', 'time', 'createdAt', 'status'],
    default: 'date',
  })
  @IsOptional()
  @IsString()
  sortBy: string = 'date';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsString()
  sortOrder: 'ASC' | 'DESC' = 'DESC';

  @ApiPropertyOptional({
    description: 'Filter by active status (SCHEDULED + IN_PROGRESS only). Omit to return all statuses.',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;

  // Computed property for TypeORM's skip
  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  // Computed property for date range validation
  get hasDateRange(): boolean {
    return !!this.startDate && !!this.endDate;
  }

  // Helper to get today's date in YYYY-MM-DD format
  static getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
