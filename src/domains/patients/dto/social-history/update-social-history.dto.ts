import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SmokingStatus, AlcoholUse, DrugUse } from '../../../../common/enums';

export class UpdateSocialHistoryDto {
  @ApiPropertyOptional({ enum: SmokingStatus, description: 'Smoking status' })
  @IsEnum(SmokingStatus)
  @IsOptional()
  smokingStatus?: SmokingStatus;

  @ApiPropertyOptional({ enum: AlcoholUse, description: 'Alcohol usage' })
  @IsEnum(AlcoholUse)
  @IsOptional()
  alcoholUse?: AlcoholUse;

  @ApiPropertyOptional({ enum: DrugUse, description: 'Drug usage' })
  @IsEnum(DrugUse)
  @IsOptional()
  drugUse?: DrugUse;

  @ApiPropertyOptional({ description: 'Patient occupation' })
  @IsString()
  @IsOptional()
  occupation?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsString()
  @IsOptional()
  additionalNotes?: string;
}
