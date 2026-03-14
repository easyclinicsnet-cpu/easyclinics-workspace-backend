import {
  IsOptional,
  IsPositive,
  IsString,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Assuming AppointmentStatus enum exists in appointments domain or common enums
// If it doesn't exist yet, we'll import it when available
enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  MISSED = 'MISSED',
  RESCHEDULED = 'RESCHEDULED',
}

export class QueryPatientsDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    default: 1,
  })
  @IsOptional()
  @IsPositive()
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 10 })
  @IsOptional()
  @IsPositive()
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Search by first name, last name, or file number',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by gender',
    enum: ['male', 'female', 'other'],
  })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ description: 'Filter by file number' })
  @IsOptional()
  @IsString()
  fileNumber?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by appointment status',
    enum: AppointmentStatus,
    isArray: true,
  })
  @IsOptional()
  @IsEnum(AppointmentStatus, { each: true })
  @Transform(({ value }) =>
    Array.isArray(value) ? value : value ? [value] : [],
  )
  appointmentStatus?: AppointmentStatus[];

  @ApiPropertyOptional({ description: 'Filter by city' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ description: 'Filter patients with active appointments' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  hasActiveAppointments?: boolean;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['firstName', 'lastName', 'fileNumber', 'createdAt', 'updatedAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsString()
  sortOrder: 'ASC' | 'DESC' = 'DESC';
}
