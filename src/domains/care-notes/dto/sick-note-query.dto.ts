import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsInt,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SickNoteStatus } from '../../../common/enums';

export class SickNoteQueryDto {
  @ApiPropertyOptional({ description: 'Filter by patient UUID' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'Filter by doctor UUID' })
  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @ApiPropertyOptional({ description: 'Filter by status', enum: SickNoteStatus })
  @IsOptional()
  @IsEnum(SickNoteStatus)
  status?: SickNoteStatus;

  @ApiPropertyOptional({ description: 'Only return ISSUED notes with endDate in the future' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ obj, key }) => {
    const v = (obj as Record<string, unknown>)[key as string];
    return v === true || v === 'true';
  })
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Filter by start date on or after (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter by end date on or before (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Results per page', minimum: 1, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;
}
