import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO for cancelling a repeat prescription
 */
export class CancelRepeatPrescriptionDto {
  @ApiProperty({ description: 'Reason for cancellation', example: 'Patient request' })
  @IsString()
  @IsNotEmpty()
  cancellationReason!: string;
}
