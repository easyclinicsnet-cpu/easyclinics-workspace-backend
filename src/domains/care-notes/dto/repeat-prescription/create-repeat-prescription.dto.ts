import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  IsEnum,
  IsBoolean,
  IsDate,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrescriptionStatus } from '../../../../common/enums';

/**
 * DTO for creating a repeat prescription
 */
export class CreateRepeatPrescriptionDto {
  @ApiProperty({ description: 'Patient ID' })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  @ApiProperty({ description: 'Medicine name', example: 'Lisinopril 10mg' })
  @IsString()
  @IsNotEmpty()
  medicine!: string;

  @ApiProperty({ description: 'Dosage', example: '10mg', required: false })
  @IsString()
  @IsOptional()
  dose?: string;

  @ApiProperty({ description: 'Route of administration', example: 'Oral', required: false })
  @IsString()
  @IsOptional()
  route?: string;

  @ApiProperty({ description: 'Frequency', example: 'Once daily', required: false })
  @IsString()
  @IsOptional()
  frequency?: string;

  @ApiProperty({ description: 'Start date' })
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  startDate!: Date;

  @ApiProperty({ description: 'End date', required: false })
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  endDate?: Date;

  @ApiProperty({ description: 'Days supply', example: 30, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  daysSupply?: number;

  @ApiProperty({ description: 'Repeat interval', example: 30, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  repeatInterval?: number;

  @ApiProperty({
    description: 'Repeat interval unit',
    example: 'days',
    enum: ['days', 'weeks', 'months', 'years'],
    required: false,
  })
  @IsEnum(['days', 'weeks', 'months', 'years'])
  @IsOptional()
  repeatIntervalUnit?: string;

  @ApiProperty({ description: 'Maximum number of repeats', example: 6, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxRepeats?: number;

  @ApiProperty({ description: 'Clinical indication', example: 'Hypertension', required: false })
  @IsString()
  @IsOptional()
  clinicalIndication?: string;

  @ApiProperty({ description: 'Special instructions', required: false })
  @IsString()
  @IsOptional()
  specialInstructions?: string;

  @ApiProperty({ description: 'Review date', required: false })
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  reviewDate?: Date;

  @ApiProperty({ description: 'Requires review', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  requiresReview?: boolean = false;

  @ApiProperty({ description: 'Original prescription ID', required: false })
  @IsUUID()
  @IsOptional()
  originalPrescriptionId?: string;
}
