import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO used when a staff member manually verifies a patient's insurance details.
 */
export class VerifyPatientInsuranceDto {
  @ApiProperty({ example: '2024-11-01', description: 'Date on which verification was performed (ISO 8601)' })
  @IsDateString()
  @IsNotEmpty()
  verifiedDate!: string;

  @ApiPropertyOptional({ description: 'Any notes recorded during the verification process' })
  @IsString()
  @IsOptional()
  verificationNotes?: string;
}
