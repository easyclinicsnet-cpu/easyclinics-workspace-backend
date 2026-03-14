import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * DTO for issuing a repeat prescription refill
 */
export class IssueRepeatPrescriptionDto {
  @ApiProperty({ description: 'Appointment ID' })
  @IsUUID()
  @IsNotEmpty()
  appointmentId!: string;

  @ApiProperty({ description: 'Consultation ID' })
  @IsUUID()
  @IsNotEmpty()
  consultationId!: string;

  @ApiProperty({ description: 'Care note ID', required: false })
  @IsUUID()
  @IsOptional()
  noteId?: string;
}
