import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMedicalHistoryDto {
  @ApiProperty({ description: 'Medical condition' })
  @IsString()
  @IsNotEmpty()
  condition!: string;

  @ApiPropertyOptional({ description: 'Additional details about the condition' })
  @IsString()
  @IsOptional()
  details?: string;

  @ApiProperty({ description: 'ID of the patient' })
  @IsUUID()
  @IsNotEmpty()
  patientId!: string;

  // workspaceId and userId will be injected by service from JWT context
}
