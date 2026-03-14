import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Severity } from '../../../../common/enums';

export class UpdateAllergyDto {
  @ApiPropertyOptional({ description: 'Substance causing the allergy' })
  @IsString()
  @IsOptional()
  substance?: string;

  @ApiPropertyOptional({ description: 'Reaction to the allergen' })
  @IsString()
  @IsOptional()
  reaction?: string;

  @ApiPropertyOptional({ enum: Severity, description: 'Severity of the allergy' })
  @IsEnum(Severity)
  @IsOptional()
  severity?: Severity;
}
