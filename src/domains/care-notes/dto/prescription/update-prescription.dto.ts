import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID } from 'class-validator';

/**
 * DTO for updating a prescription
 */
export class UpdatePrescriptionDto {
  @ApiProperty({ description: 'Medicine name', example: 'Amoxicillin 500mg', required: false })
  @IsString()
  @IsOptional()
  medicine?: string;

  @ApiProperty({ description: 'Dosage', example: '500mg', required: false })
  @IsString()
  @IsOptional()
  dose?: string;

  @ApiProperty({ description: 'Route of administration', example: 'Oral', required: false })
  @IsString()
  @IsOptional()
  route?: string;

  @ApiProperty({ description: 'Frequency', example: 'Three times daily', required: false })
  @IsString()
  @IsOptional()
  frequency?: string;

  @ApiProperty({ description: 'Number of days', example: '7 days', required: false })
  @IsString()
  @IsOptional()
  days?: string;

  @ApiProperty({ description: 'Appointment ID', required: false })
  @IsUUID()
  @IsOptional()
  appointmentId?: string;

  @ApiProperty({ description: 'Consultation ID', required: false })
  @IsUUID()
  @IsOptional()
  consultationId?: string;

  @ApiProperty({ description: 'Doctor ID', required: false })
  @IsUUID()
  @IsOptional()
  doctorId?: string;

  @ApiProperty({ description: 'Care note ID', required: false })
  @IsUUID()
  @IsOptional()
  noteId?: string;
}
