import {
  IsUUID,
  IsString,
  IsOptional,
  IsBoolean,
  MinLength,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateSickNoteDto {
  @ApiProperty({ description: 'Patient UUID' })
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({ description: 'Linked care note UUID' })
  @IsOptional()
  @IsUUID()
  noteId?: string;

  @ApiPropertyOptional({ description: 'Linked consultation UUID' })
  @IsOptional()
  @IsUUID()
  consultationId?: string;

  @ApiProperty({ description: 'Diagnosis (encrypted at rest)' })
  @IsString()
  @MinLength(1)
  diagnosis: string;

  @ApiPropertyOptional({ description: 'Clinical recommendations (encrypted at rest)' })
  @IsOptional()
  @IsString()
  recommendations?: string;

  @ApiPropertyOptional({ description: 'Issue date ISO 8601 — defaults to today' })
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiProperty({ description: 'Leave start date ISO 8601' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'Leave end date ISO 8601' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: 'Employer name the note is addressed to' })
  @IsOptional()
  @IsString()
  employerName?: string;

  @ApiPropertyOptional({ description: 'Employer address' })
  @IsOptional()
  @IsString()
  employerAddress?: string;

  @ApiPropertyOptional({ description: 'Patient is fit for light duties', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  isFitForLightDuties?: boolean;

  @ApiPropertyOptional({ description: 'Description of light duties (required when isFitForLightDuties is true)' })
  @IsOptional()
  @IsString()
  lightDutiesDescription?: string;

  @ApiPropertyOptional({ description: 'Pre-assigned certificate number (auto-generated on issue if omitted)' })
  @IsOptional()
  @IsString()
  certificateNumber?: string;
}
