import { IsString, IsNotEmpty, IsOptional, IsUUID, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSurgicalHistoryDto {
  @ApiProperty({ description: 'Surgical procedure name' })
  @IsString()
  @IsNotEmpty()
  procedure!: string;

  @ApiPropertyOptional({ description: 'Additional details about the procedure' })
  @IsString()
  @IsOptional()
  details?: string;

  @ApiPropertyOptional({ description: 'Date of the surgery' })
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiProperty({ description: 'ID of the patient' })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  // workspaceId and userId will be injected by service from JWT context
}
