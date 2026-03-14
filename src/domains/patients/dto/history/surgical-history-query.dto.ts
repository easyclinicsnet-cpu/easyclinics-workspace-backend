import { IsOptional, IsPositive, IsString, IsUUID, IsBoolean, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SurgicalHistoryQueryDto {
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

  @ApiPropertyOptional({ description: 'Filter by procedure name' })
  @IsOptional()
  @IsString()
  procedure?: string;

  @ApiPropertyOptional({ description: 'Filter surgeries within recent days' })
  @IsOptional()
  @IsNumber()
  @Transform(({ value }) => parseInt(value))
  recentDays?: number;

  @ApiPropertyOptional({ description: 'Filter surgeries with complications', default: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  withComplications?: boolean;

  @ApiPropertyOptional({ description: 'Sort field', enum: ['procedure', 'date', 'createdAt'], default: 'date' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'date';

  @ApiPropertyOptional({ description: 'Sort direction', enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
