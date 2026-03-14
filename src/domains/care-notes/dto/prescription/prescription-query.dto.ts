import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsInt, IsString, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for querying prescriptions with filters
 */
export class PrescriptionQueryDto {
  @ApiProperty({ description: 'Patient ID', required: false })
  @IsUUID()
  @IsOptional()
  patientId?: string;

  @ApiProperty({ description: 'Doctor ID', required: false })
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @ApiProperty({ description: 'Appointment ID', required: false })
  @IsUUID()
  @IsOptional()
  appointmentId?: string;

  @ApiProperty({ description: 'Consultation ID', required: false })
  @IsUUID()
  @IsOptional()
  consultationId?: string;

  @ApiProperty({ description: 'Page number', required: false, default: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @ApiProperty({ description: 'Items per page', required: false, default: 10, minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  limit?: number = 10;

  @ApiProperty({ description: 'Sort by field', required: false, default: 'createdAt' })
  @IsString()
  @IsOptional()
  sortBy?: string = 'createdAt';

  @ApiProperty({ description: 'Sort order', required: false, default: 'DESC', enum: ['ASC', 'DESC'] })
  @IsEnum(['ASC', 'DESC'])
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
