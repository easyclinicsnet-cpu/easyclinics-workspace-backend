import {
  IsString,
  IsOptional,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UpdateSickNoteDto {
  @ApiPropertyOptional({ description: 'Diagnosis (encrypted at rest)' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: 'Clinical recommendations (encrypted at rest)' })
  @IsOptional()
  @IsString()
  recommendations?: string;

  @ApiPropertyOptional({ description: 'Issue date ISO 8601' })
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiPropertyOptional({ description: 'Leave start date ISO 8601' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Leave end date ISO 8601' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Employer name' })
  @IsOptional()
  @IsString()
  employerName?: string;

  @ApiPropertyOptional({ description: 'Employer address' })
  @IsOptional()
  @IsString()
  employerAddress?: string;

  @ApiPropertyOptional({ description: 'Patient is fit for light duties' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  isFitForLightDuties?: boolean;

  @ApiPropertyOptional({ description: 'Light duties description' })
  @IsOptional()
  @IsString()
  lightDutiesDescription?: string;

  @ApiPropertyOptional({ description: 'Certificate number' })
  @IsOptional()
  @IsString()
  certificateNumber?: string;
}
