import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsInt, IsString, IsEnum, IsBoolean, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PrescriptionStatus } from '../../../../common/enums';

/**
 * DTO for querying repeat prescriptions with filters
 */
export class RepeatPrescriptionQueryDto {
  @ApiProperty({ description: 'Patient ID', required: false })
  @IsUUID()
  @IsOptional()
  patientId?: string;

  @ApiProperty({ description: 'Doctor ID', required: false })
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @ApiProperty({
    description: 'Status',
    enum: PrescriptionStatus,
    required: false,
  })
  @IsEnum(PrescriptionStatus)
  @IsOptional()
  status?: PrescriptionStatus;

  @ApiProperty({ description: 'Filter for prescriptions due for refill', required: false })
  @IsBoolean()
  @Transform(({ obj, key }) => { const v = (obj as Record<string, unknown>)[key as string]; return v === true || v === 'true'; })
  @IsOptional()
  isDue?: boolean;

  @ApiProperty({ description: 'Filter for prescriptions requiring review', required: false })
  @IsBoolean()
  @Transform(({ obj, key }) => { const v = (obj as Record<string, unknown>)[key as string]; return v === true || v === 'true'; })
  @IsOptional()
  requiresReview?: boolean;

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
