import { IsOptional, IsPositive, IsString, IsEnum, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Severity } from '../../../../common/enums';

export class AllergyQueryDto {
  @ApiPropertyOptional({ description: 'Page number for pagination', default: 1 })
  @IsOptional()
  @IsPositive()
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 10 })
  @IsOptional()
  @IsPositive()
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Filter by patient ID' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Filter by substance name' })
  @IsOptional()
  @IsString()
  substance?: string;

  @ApiPropertyOptional({ enum: Severity, description: 'Filter by severity' })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional({ description: 'Sort field', enum: ['substance', 'severity', 'createdAt'], default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Sort direction', enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
