import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ConsultationStatus } from '../../../common/enums';

/**
 * DTO for querying consultations with filters and pagination
 */
export class ConsultationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by patient ID' })
  @IsUUID()
  @IsOptional()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Filter by appointment ID' })
  @IsUUID()
  @IsOptional()
  appointmentId?: string;

  @ApiPropertyOptional({ description: 'Filter by doctor ID' })
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @ApiPropertyOptional({ enum: ConsultationStatus, description: 'Filter by status' })
  @IsEnum(ConsultationStatus)
  @IsOptional()
  status?: ConsultationStatus;

  @ApiPropertyOptional({ description: 'Filter by specific date (ISO format)' })
  @IsString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({ description: 'Filter from start date (ISO format)' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter to end date (ISO format)' })
  @IsString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Search term' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsString()
  @IsOptional()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsEnum(['ASC', 'DESC'])
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
