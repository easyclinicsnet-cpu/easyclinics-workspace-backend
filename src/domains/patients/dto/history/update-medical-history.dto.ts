import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMedicalHistoryDto {
  @ApiPropertyOptional({ description: 'Medical condition' })
  @IsString()
  @IsOptional()
  condition?: string;

  @ApiPropertyOptional({ description: 'Additional details about the condition' })
  @IsString()
  @IsOptional()
  details?: string;
}
