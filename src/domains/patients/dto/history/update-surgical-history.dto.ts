import { IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSurgicalHistoryDto {
  @ApiPropertyOptional({ description: 'Surgical procedure name' })
  @IsString()
  @IsOptional()
  procedure?: string;

  @ApiPropertyOptional({ description: 'Additional details about the procedure' })
  @IsString()
  @IsOptional()
  details?: string;

  @ApiPropertyOptional({ description: 'Date of the surgery' })
  @IsDateString()
  @IsOptional()
  date?: string;
}
