import { PartialType } from '@nestjs/swagger';
import { CreateAppointmentDto } from './create-appointment.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for updating an existing appointment
 * All fields from CreateAppointmentDto are optional
 * Includes isActive field for soft delete/activation
 */
export class UpdateAppointmentDto extends PartialType(CreateAppointmentDto) {
  @ApiPropertyOptional({
    description: 'Active status of the appointment',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
