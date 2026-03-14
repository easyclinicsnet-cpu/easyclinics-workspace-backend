import { IsOptional, IsPositive, IsEnum, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SmokingStatus, AlcoholUse, DrugUse } from '../../../../common/enums';

export class SocialHistoryQueryDto {
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

  @ApiPropertyOptional({ enum: SmokingStatus, description: 'Filter by smoking status' })
  @IsOptional()
  @IsEnum(SmokingStatus)
  smokingStatus?: SmokingStatus;

  @ApiPropertyOptional({ enum: AlcoholUse, description: 'Filter by alcohol use' })
  @IsOptional()
  @IsEnum(AlcoholUse)
  alcoholUse?: AlcoholUse;

  @ApiPropertyOptional({ enum: DrugUse, description: 'Filter by drug use' })
  @IsOptional()
  @IsEnum(DrugUse)
  drugUse?: DrugUse;
}
